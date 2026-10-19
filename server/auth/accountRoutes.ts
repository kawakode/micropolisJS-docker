/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { AppContext } from '../app';
import { publicUser } from '../coreRoutes';
import type { RequestContext, RequestSession, RequestUser } from '../http/request';
import { attachment, HttpError, json, noContent } from '../http/response';
import type { RateLimitRule } from '../http/router';
import { checkPassword } from './credentials';
import { createEmailChangeToken, deleteEmailTokens, EMAIL_CHANGE_HOURS } from './mailTokens';
import { isLocale, requestUser, UserRow } from './users';
import { emailField, invalidInput, newPasswordField, readEmpty, readFields, stringField } from './validate';

// The signed-in player's own account (a session is required):
//   GET  /api/account                                     200 {user}
//   POST /api/account/password {currentPassword, newPassword}  200 {user}: a new session (cookie), the others ended
//   POST /api/account/email {currentPassword, newEmail}   202: a confirmation link is mailed to the new address (10
//                                                         an hour per account)
//   POST /api/account/locale {locale}                     200 {user}: the language of the account's emails
//   POST /api/account/logout-all {}                       204: every session ended, this one included
//   GET  /api/account/export                              200: a JSON file of what the server keeps about the player
//   POST /api/account/delete {password}                   204: the account and everything it owns deleted
// Changing the password or the address, and deleting the account, ask for the password (a wrong one is 401
// invalid_credentials, counted by the login guard). What they change is changed only if the session and the password
// are still the ones checked: a password reset made meanwhile ended every session, and must not be undone (401).

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const ACCOUNT_LIMITS = {
  // The routes that check the password: per client, and per session, so that a session (a stolen one, say) cannot
  // use up the limit of the others (guessing the password is the login guard's to stop)
  checksPerIp: {name: 'account-ip', limit: 20, windowMs: 15 * MINUTE, per: 'ip'},
  changes: {name: 'account', limit: 10, windowMs: HOUR, per: 'session'},
  // Address changes per account too, counted once the password is right: each login is a new session, and each change
  // mails a link to an address the requester chose (one of the MAIL_MAX_PER_HOUR links)
  emailChanges: {name: 'account-email', limit: 10, windowMs: HOUR, per: 'user'},
  // The game sends the language whenever the player changes it
  locale: {name: 'account-locale', limit: 30, windowMs: HOUR, per: 'user'},
  exports: {name: 'account-export', limit: 10, windowMs: HOUR, per: 'user'},
} as const satisfies Record<string, RateLimitRule>;

const PASSWORD_FIELD = 1024;

const isoTime = (time: number | null) => time === null ? null : new Date(time).toISOString();

export function registerAccountRoutes(context: AppContext): void {
  const {auth, clock, db, log, router} = context;
  const {users, sessions, passwords, mail} = auth;

  const logFields = (ctx: RequestContext) => ({requestId: ctx.requestId, ip: ctx.ipKey, user: ctx.user?.publicId});

  // The signed-in user and session (the router made sure there is one)
  const signedIn = (ctx: RequestContext): {user: RequestUser; session: RequestSession} =>
    ({user: ctx.user as RequestUser, session: ctx.session as RequestSession});

  const row = (user: RequestUser): UserRow => {
    const found = users.byId(user.id);
    if (!found)
      throw new HttpError(401, 'unauthenticated');
    return found;
  };

  // The account as it is now, if the request's session still exists and the password is still the one checked (the
  // row read before checking it): called in the transaction that makes the change, so that a password reset or change
  // made while the password was checked is not undone. Else 401.
  const unchanged = (ctx: RequestContext, checked: UserRow): UserRow => {
    if (!sessions.resolveHash(signedIn(ctx).session.tokenHash, false))
      throw new HttpError(401, 'unauthenticated');
    const current = users.byId(checked.id);
    if (!current || current.password_hash !== checked.password_hash)
      throw new HttpError(401, 'invalid_credentials');
    return current;
  };

  const checking = {auth: 'required', limits: [ACCOUNT_LIMITS.checksPerIp, ACCOUNT_LIMITS.changes]} as const;

  router.get('/api/account', ctx => {
    json(ctx.res, 200, {user: publicUser(signedIn(ctx).user)});
  }, {auth: 'required'});

  router.post('/api/account/password', async ctx => {
    const user = row(signedIn(ctx).user);
    const body = readFields(ctx.body, ['currentPassword', 'newPassword']);
    const current = stringField(body.currentPassword, 'currentPassword', PASSWORD_FIELD);
    const password = newPasswordField(body.newPassword, 'newPassword', {username: user.username, email: user.email});

    await checkPassword(context, ctx, user, null, current);
    const passwordHash = await passwords.hash(password, ctx.ipKey);

    // Every session ends (other browsers are logged out); this one goes on with a new token
    const {revocation, session} = db.transaction(() => {
      unchanged(ctx, user);
      users.setPasswordHash(user.id, passwordHash, clock.now());
      deleteEmailTokens(db, user.id);
      return {revocation: sessions.deleteForUser(user.id), session: sessions.create(user.id)};
    });
    sessions.notifyRevoked(revocation, ...session.replaced);

    mail.send('passwordChanged', {email: user.email, emailKey: user.email_key}, user.locale, {username: user.username});
    log.info('auth.password.change', logFields(ctx));
    json(ctx.res, 200, {user: publicUser(requestUser(user))}, {'Set-Cookie': sessions.cookie(session.token)});
  }, checking);

  router.post('/api/account/email', async ctx => {
    if (!mail.enabled)
      throw new HttpError(404, 'not_found');
    const user = row(signedIn(ctx).user);
    const body = readFields(ctx.body, ['currentPassword', 'newEmail']);
    const current = stringField(body.currentPassword, 'currentPassword', PASSWORD_FIELD);
    const {email: newEmail, key: newEmailKey} = emailField(body.newEmail, 'newEmail');

    await checkPassword(context, ctx, user, null, current);
    context.limit(ctx, ACCOUNT_LIMITS.emailChanges);
    json(ctx.res, 202, {ok: true});

    // Whether the address is someone else's must not show, in the answer, in the requester's mailbox, nor in when
    // its mails go: the notice goes first to the account's address, then one mail to the new address under the same
    // limits either way (those of a link): the link if the address is free, else a word to the account that has it
    context.defer(() => {
      const outcome = db.transaction(() => {
        let fresh: UserRow;
        try {
          fresh = unchanged(ctx, user);
        } catch (error) {
          if (error instanceof HttpError)
            return null;
          throw error;
        }

        mail.send('emailChangeNotice', {email: fresh.email, emailKey: fresh.email_key}, fresh.locale,
                  {username: fresh.username});
        const holder = users.byEmailKey(newEmailKey);
        if (holder) {
          const sent = mail.send('emailChangeTaken', {email: holder.email, emailKey: holder.email_key}, holder.locale,
                                 {username: holder.username});
          return {inUse: true, sent};
        }
        const sent = mail.send('emailChangeConfirm', {email: newEmail, emailKey: newEmailKey}, fresh.locale, () => ({
          username: fresh.username,
          hours: EMAIL_CHANGE_HOURS,
          link: mail.link('email', createEmailChangeToken(db, fresh.id, newEmail, newEmailKey, clock.now())),
        }));
        return {inUse: false, sent};
      });
      // stale: the password was reset (or changed) while it was checked, and nothing was done
      log.info('auth.email.change_request', {...logFields(ctx), ...(outcome ?? {stale: true})});
    });
  }, checking);

  router.post('/api/account/locale', ctx => {
    const {user} = signedIn(ctx);
    const body = readFields(ctx.body, ['locale']);
    if (!isLocale(body.locale))
      throw invalidInput({locale: 'invalid'});

    users.setLocale(user.id, body.locale, clock.now());
    json(ctx.res, 200, {user: publicUser(requestUser(row(user)))});
  }, {auth: 'required', limits: [ACCOUNT_LIMITS.locale]});

  // No limit but the API's: it ends the session it is called with, and no other session may keep the owner from
  // ending them all
  router.post('/api/account/logout-all', ctx => {
    readEmpty(ctx.body);
    sessions.revokeAll(signedIn(ctx).user.id);
    log.info('auth.logout_all', logFields(ctx));
    noContent(ctx.res, {'Set-Cookie': sessions.clearCookie()});
  }, {auth: 'required'});

  // What the server keeps about the player (GDPR articles 15 and 20): never a password hash, nor a token or its hash
  router.get('/api/account/export', ctx => {
    const {user, session} = signedIn(ctx);
    const account = row(user);
    const emailChange = db.get<{new_email: string; created_at: number; expires_at: number}>(
      `SELECT new_email, created_at, expires_at FROM email_tokens
       WHERE user_id = ? AND purpose = 'email_change' AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
      account.id, clock.now());
    const data: Record<string, unknown> = {
      exportedAt: isoTime(clock.now()),
      account: {
        id: account.public_id,
        username: account.username,
        email: account.email,
        locale: account.locale,
        createdAt: isoTime(account.created_at),
        updatedAt: isoTime(account.updated_at),
        lastLoginAt: isoTime(account.last_login_at),
      },
      sessions: sessions.forUser(account.id).map(s => ({
        createdAt: isoTime(s.createdAt),
        lastSeenAt: isoTime(s.lastSeenAt),
        expiresAt: isoTime(s.expiresAt),
        current: s.tokenHash === session.tokenHash,
      })),
      // A new address waiting for its confirmation
      pendingEmailChange: emailChange ? {newEmail: emailChange.new_email, requestedAt: isoTime(emailChange.created_at),
                                         expiresAt: isoTime(emailChange.expires_at)} : null,
      // Failed logins (see loginGuard.ts)
      loginProtection: {failedLogins: account.failed_logins_day, windowStart: isoTime(account.failed_window_start),
                        lockedUntil: isoTime(account.locked_until)},
    };
    for (const [name, section] of auth.exportSections)
      data[name] = section(account.id);

    attachment(ctx.res, {name: `kawacity-${account.username}`, extension: 'json', fallbackName: 'kawacity-account',
                         contentType: 'application/json; charset=utf-8', body: JSON.stringify(data, null, 2) + '\n'});
  }, {auth: 'required', limits: [ACCOUNT_LIMITS.exports]});

  router.post('/api/account/delete', async ctx => {
    const user = row(signedIn(ctx).user);
    const body = readFields(ctx.body, ['password']);
    const password = stringField(body.password, 'password', PASSWORD_FIELD);

    await checkPassword(context, ctx, user, null, password);

    // The hooks (stage B: rooms of the cities going with the account) run before the rows go, in the same transaction
    const revocation = db.transaction(() => {
      unchanged(ctx, user);
      for (const hook of auth.deletionHooks)
        hook(user.id);
      const ended = sessions.deleteForUser(user.id);
      users.delete(user.id);
      db.run('DELETE FROM signup_tokens WHERE email_key = ?', user.email_key);
      return ended;
    });
    sessions.notifyRevoked(revocation);
    auth.loginGuard.clearUser(user);
    // Nothing of the account left in the write-ahead log either (the database file's copy was overwritten)
    db.checkpoint();

    log.info('account.delete', logFields(ctx));
    noContent(ctx.res, {'Set-Cookie': sessions.clearCookie()});
  }, checking);
}
