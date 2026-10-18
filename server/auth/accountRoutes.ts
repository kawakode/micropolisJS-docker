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
//   POST /api/account/email {currentPassword, newEmail}   202: a confirmation link is mailed to the new address
//   POST /api/account/locale {locale}                     200 {user}: the language of the account's emails
//   POST /api/account/logout-all {}                       204: every session ended, this one included
//   GET  /api/account/export                              200: a JSON file of what the server keeps about the player
//   POST /api/account/delete {password}                   204: the account and everything it owns deleted
// Changing the password or the address, and deleting the account, ask for the password (a wrong one is 401
// invalid_credentials, counted by the login guard).

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const ACCOUNT_LIMITS = {
  // The routes that check the password: per client, and per account
  checksPerIp: {name: 'account-ip', limit: 20, windowMs: 15 * MINUTE, per: 'ip'},
  changes: {name: 'account', limit: 10, windowMs: HOUR, per: 'user'},
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

  const checking = {auth: 'required', limits: [ACCOUNT_LIMITS.checksPerIp, ACCOUNT_LIMITS.changes]} as const;

  router.get('/api/account', ctx => {
    json(ctx.res, 200, {user: publicUser(signedIn(ctx).user)});
  }, {auth: 'required'});

  router.post('/api/account/password', async ctx => {
    const user = row(signedIn(ctx).user);
    const body = readFields(ctx.body, ['currentPassword', 'newPassword']);
    const current = stringField(body.currentPassword, 'currentPassword', PASSWORD_FIELD);
    const password = newPasswordField(body.newPassword, 'newPassword', {username: user.username, email: user.email});

    await checkPassword(context, ctx, user, '', current);
    const passwordHash = await passwords.hash(password, ctx.ipKey);

    // Every session ends (other browsers are logged out); this one goes on with a new token
    const {revocation, session} = db.transaction(() => {
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

    await checkPassword(context, ctx, user, '', current);
    json(ctx.res, 202, {ok: true});

    // Whether the address is someone else's must not show in the answer: nothing is sent then
    context.defer(() => {
      const fresh = users.byId(user.id);
      const inUse = users.byEmailKey(newEmailKey) !== null;
      let sent = false;
      if (fresh && !inUse) {
        sent = mail.send('emailChangeConfirm', {email: newEmail, emailKey: newEmailKey}, fresh.locale, () => ({
          username: fresh.username,
          hours: EMAIL_CHANGE_HOURS,
          link: mail.link('email', createEmailChangeToken(db, fresh.id, newEmail, newEmailKey, clock.now())),
        }));
        if (sent)
          mail.send('emailChangeNotice', {email: fresh.email, emailKey: fresh.email_key}, fresh.locale,
                    {username: fresh.username});
      }
      log.info('auth.email.change_request', {...logFields(ctx), inUse, sent});
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

  router.post('/api/account/logout-all', ctx => {
    readEmpty(ctx.body);
    sessions.revokeAll(signedIn(ctx).user.id);
    log.info('auth.logout_all', logFields(ctx));
    noContent(ctx.res, {'Set-Cookie': sessions.clearCookie()});
  }, {auth: 'required', limits: [ACCOUNT_LIMITS.changes]});

  // What the server keeps about the player (GDPR article 20): never a password hash, nor a token or its hash
  router.get('/api/account/export', ctx => {
    const {user, session} = signedIn(ctx);
    const account = row(user);
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

    await checkPassword(context, ctx, user, '', password);

    // The hooks (stage B: rooms of the cities going with the account) run before the rows go, in the same transaction
    const revocation = db.transaction(() => {
      for (const hook of auth.deletionHooks)
        hook(user.id);
      const ended = sessions.deleteForUser(user.id);
      users.delete(user.id);
      db.run('DELETE FROM signup_tokens WHERE email_key = ?', user.email_key);
      return ended;
    });
    sessions.notifyRevoked(revocation);
    auth.loginGuard.clearUser(user.id);

    log.info('account.delete', logFields(ctx));
    noContent(ctx.res, {'Set-Cookie': sessions.clearCookie()});
  }, checking);
}
