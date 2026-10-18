/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { AppContext } from '../app';
import { features, publicUser } from '../coreRoutes';
import type { RequestContext } from '../http/request';
import { HttpError, json, noContent } from '../http/response';
import type { RateLimitRule } from '../http/router';
import { CaptchaAction, CaptchaError, isCaptchaAction } from '../security/captcha';
import { registerAccountRoutes } from './accountRoutes';
import { checkPassword } from './credentials';
import { consumeEmailToken, consumeSignupToken, createResetToken, createSignupToken, deleteEmailTokens,
         findEmailToken, findSignupToken, isMailToken, RESET_HOURS, SIGNUP_HOURS } from './mailTokens';
import { checkUsername, isLocale, loginLookup, requestUser } from './users';
import { emailField, invalidInput, newPasswordField, readEmpty, readFields, stringField } from './validate';

// The account routes that need no session (and /api/account/*, in accountRoutes.ts):
//   GET  /api/captcha?action=register|login|forgot  a captcha challenge
//   POST /api/auth/register {email, locale, captcha, website}         202: a link is mailed (see below)
//   POST /api/auth/complete-registration {token, username, password}  201 {user} and the session cookie
//   POST /api/auth/login {login, password, captcha}                   200 {user} and the session cookie
//   POST /api/auth/logout {}                                          204, the cookie removed
//   POST /api/auth/forgot-password {email, captcha, website}          202: a reset link is mailed if the account exists
//   POST /api/auth/reset-password {token, password}                   200 {ok: true}
//   POST /api/auth/confirm-email-change {token}                       200 {ok: true}
//
// Every route checks, in this order: its per-IP limit (in the router), the body, the captcha (used up even if a later
// check fails), the login guard, then hashes. Answers never tell whether an account exists: registering and asking
// for a reset always answer 202, and what depends on the account (the token, the mail) is done after the answer
// (context.defer); a login to an unknown account fails like a wrong password, after as long.
//
// Registration is email-first: the address gets either a link to finish creating the account (choosing a username
// and a password), or, if it already has an account, a reminder of its username with a password reset link. Nobody
// can create an account for an address they cannot read, nor learn whether an address has one.
//
// The honeypot field `website` (hidden in the form) is filled only by robots: the route then answers as usual and
// does nothing.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Per client IP key (times IP_LIMIT_FACTOR)
export const AUTH_LIMITS = {
  captcha: {name: 'captcha', limit: 60, windowMs: 10 * MINUTE, per: 'ip'},
  register: {name: 'register', limit: 5, windowMs: HOUR, per: 'ip'},
  // Links from mails: complete-registration, reset-password, confirm-email-change
  token: {name: 'token', limit: 20, windowMs: 15 * MINUTE, per: 'ip'},
  login: {name: 'login', limit: 20, windowMs: 15 * MINUTE, per: 'ip'},
  forgot: {name: 'forgot', limit: 5, windowMs: HOUR, per: 'ip'},
} as const satisfies Record<string, RateLimitRule>;

// Fields read as strings of at most this many UTF-16 units
const LOGIN_FIELD = 1024;
const PASSWORD_FIELD = 1024;
const WEBSITE_FIELD = 200;

const invalidToken = () => new HttpError(400, 'invalid_token');

const notFound = () => new HttpError(404, 'not_found');

export function registerAuthRoutes(context: AppContext): void {
  const {auth, clock, config, db, log, router} = context;
  const {users, sessions, passwords, captcha, mail} = auth;

  const logFields = (ctx: RequestContext, user?: string | null) =>
    ({requestId: ctx.requestId, ip: ctx.ipKey, user: user ?? undefined});

  // Uses up the captcha sent with a form; a refused one is logged (once a minute per client)
  const verifyCaptcha = (ctx: RequestContext, solution: unknown, action: CaptchaAction) => {
    try {
      captcha.verify(solution, action, ctx.ipKey);
    } catch (error) {
      if (error instanceof CaptchaError)
        log.security('captcha.fail', ctx.ipKey, {...logFields(ctx), action, reason: error.refusal});
      throw error;
    }
  };

  // The honeypot of a form: '' unless a robot filled it
  const honeypot = (value: unknown) => value === undefined ? '' : stringField(value, 'website', WEBSITE_FIELD, true);

  const registrationOpen = () => {
    if (!features(config, db).registration)
      throw new HttpError(403, 'registration_closed');
  };

  router.get('/api/captcha', ctx => {
    const action = ctx.query.get('action');
    if (!isCaptchaAction(action))
      throw invalidInput({action: 'invalid'});

    const offered = features(config, db);
    if (action === 'register' && !offered.registration)
      throw new HttpError(403, 'registration_closed');
    if ((action === 'login' && !offered.accounts) || (action === 'forgot' && !offered.mail))
      throw notFound();

    json(ctx.res, 200, captcha.issue(action, ctx.ipKey));
  }, {limits: [AUTH_LIMITS.captcha]});

  router.post('/api/auth/register', ctx => {
    registrationOpen();
    const body = readFields(ctx.body, ['email', 'locale', 'captcha'], ['website']);
    const {email, key: emailKey} = emailField(body.email, 'email');
    if (!isLocale(body.locale))
      throw invalidInput({locale: 'invalid'});
    const locale = body.locale;
    const website = honeypot(body.website);
    verifyCaptcha(ctx, body.captcha, 'register');

    json(ctx.res, 202, {ok: true});
    if (website !== '') {
      log.info('auth.honeypot', {...logFields(ctx), route: ctx.path});
      return;
    }

    context.defer(() => {
      const existing = users.byEmailKey(emailKey);
      if (existing) {
        // Already an account: its username, and a link to reset its password
        mail.send('alreadyRegistered', {email: existing.email, emailKey: existing.email_key}, locale, () => ({
          username: existing.username,
          hours: RESET_HOURS,
          link: mail.link('reset', createResetToken(db, existing.id, clock.now())),
        }));
      } else {
        mail.send('signup', {email, emailKey}, locale, () => ({
          hours: SIGNUP_HOURS,
          link: mail.link('signup', createSignupToken(db, {email, emailKey, locale}, clock.now())),
        }));
      }
      log.info('auth.register_request', {...logFields(ctx, existing?.public_id), existing: existing !== null});
    });
  }, {limits: [AUTH_LIMITS.register]});

  router.post('/api/auth/complete-registration', async ctx => {
    registrationOpen();
    const body = readFields(ctx.body, ['token', 'username', 'password']);
    const token = body.token;
    if (!isMailToken(token))
      throw invalidToken();
    const signup = findSignupToken(db, token, clock.now());
    if (!signup)
      throw invalidToken();

    // Told only to the holder of the link. A username is taken when another differs from it by case, or looks like it.
    const username = checkUsername(body.username);
    if (!username.ok)
      throw invalidInput({username: username.reason});
    if (users.usernameHolder(username))
      throw new HttpError(409, 'username_taken');
    const password = newPasswordField(body.password, 'password', {username: username.username, email: signup.email});

    const passwordHash = await passwords.hash(password, ctx.ipKey);

    const created = db.transaction(() => {
      const now = clock.now();
      const used = consumeSignupToken(db, token, now);
      if (!used || users.byEmailKey(used.emailKey))
        throw invalidToken();
      if (users.usernameHolder(username))
        throw new HttpError(409, 'username_taken');

      db.run('DELETE FROM signup_tokens WHERE email_key = ?', used.emailKey);
      const user = users.create({username: username.username, usernameKey: username.key, email: used.email,
                                 emailKey: used.emailKey, passwordHash, now, loggedIn: true,
                                 locale: isLocale(used.locale) ? used.locale : 'en'});
      return {user, session: sessions.create(user.id)};
    });

    log.info('auth.register', logFields(ctx, created.user.public_id));
    json(ctx.res, 201, {user: publicUser(requestUser(created.user))},
         {'Set-Cookie': sessions.cookie(created.session.token)});
  }, {limits: [AUTH_LIMITS.token]});

  router.post('/api/auth/login', async ctx => {
    if (!features(config, db).accounts)
      throw notFound();
    const body = readFields(ctx.body, ['login', 'password', 'captcha']);
    const login = stringField(body.login, 'login', LOGIN_FIELD);
    const password = stringField(body.password, 'password', PASSWORD_FIELD);
    verifyCaptcha(ctx, body.captcha, 'login');

    const user = await checkPassword(context, ctx, users.byLogin(login), loginLookup(login).subjectKey, password);
    // The hash the password was checked against (or the same password hashed again)
    let checkedHash = user.password_hash;

    // Hashed again with today's settings
    if (passwords.needsRehash(user.password_hash)) {
      try {
        const rehashed = await passwords.hash(password, ctx.ipKey);
        if (users.rehashPassword(user.id, user.password_hash, rehashed))
          checkedHash = rehashed;
      } catch (error) {
        log.warn('auth.rehash_failed', {...logFields(ctx, user.public_id), err: error});
      }
    }

    const session = db.transaction(() => {
      // A password reset or change that was made while the password was checked ended every session: the password
      // checked is no longer the account's, and no session is made with it
      if (users.byId(user.id)?.password_hash !== checkedHash)
        throw new HttpError(401, 'invalid_credentials');
      users.noteLogin(user.id, clock.now());
      // This browser's previous session ends: a login always starts a new one
      if (ctx.session)
        db.run('DELETE FROM sessions WHERE token_hash = ?', ctx.session.tokenHash);
      return sessions.create(user.id);
    });
    if (ctx.session)
      sessions.notifyRevoked({userId: ctx.session.userId, tokenHash: ctx.session.tokenHash, except: null});
    sessions.notifyRevoked(...session.replaced);

    log.info('auth.login.ok', logFields(ctx, user.public_id));
    json(ctx.res, 200, {user: publicUser(requestUser(user))}, {'Set-Cookie': sessions.cookie(session.token)});
  }, {auth: 'optional', limits: [AUTH_LIMITS.login]});

  router.post('/api/auth/logout', ctx => {
    readEmpty(ctx.body);
    const session = ctx.session as NonNullable<RequestContext['session']>;
    sessions.revoke(session);
    log.info('auth.logout', logFields(ctx, ctx.user?.publicId));
    noContent(ctx.res, {'Set-Cookie': sessions.clearCookie()});
  }, {auth: 'required'});

  router.post('/api/auth/forgot-password', ctx => {
    if (!mail.enabled)
      throw notFound();
    const body = readFields(ctx.body, ['email', 'captcha'], ['website']);
    const {key: emailKey} = emailField(body.email, 'email');
    const website = honeypot(body.website);
    verifyCaptcha(ctx, body.captcha, 'forgot');

    json(ctx.res, 202, {ok: true});
    if (website !== '') {
      log.info('auth.honeypot', {...logFields(ctx), route: ctx.path});
      return;
    }

    context.defer(() => {
      const user = users.byEmailKey(emailKey);
      if (user) {
        mail.send('reset', {email: user.email, emailKey: user.email_key}, user.locale, () => ({
          username: user.username,
          hours: RESET_HOURS,
          link: mail.link('reset', createResetToken(db, user.id, clock.now())),
        }));
      }
      log.info('auth.password.reset_request', logFields(ctx, user?.public_id ?? 'unknown'));
    });
  }, {limits: [AUTH_LIMITS.forgot]});

  router.post('/api/auth/reset-password', async ctx => {
    const body = readFields(ctx.body, ['token', 'password']);
    const token = body.token;
    if (!isMailToken(token))
      throw invalidToken();
    const found = findEmailToken(db, token, 'reset', clock.now());
    const owner = found ? users.byId(found.userId) : null;
    if (!owner)
      throw invalidToken();
    const password = newPasswordField(body.password, 'password', {username: owner.username, email: owner.email});

    const passwordHash = await passwords.hash(password, ctx.ipKey);

    const {user, revocation} = db.transaction(() => {
      const now = clock.now();
      const used = consumeEmailToken(db, token, 'reset', now);
      const current = used ? users.byId(used.userId) : null;
      if (!current)
        throw invalidToken();

      users.setPasswordHash(current.id, passwordHash, now);
      deleteEmailTokens(db, current.id);
      auth.loginGuard.clearUser(current);
      return {user: current, revocation: sessions.deleteForUser(current.id)};
    });
    sessions.notifyRevoked(revocation);

    mail.send('passwordChanged', {email: user.email, emailKey: user.email_key}, user.locale, {username: user.username});
    log.info('auth.password.reset', logFields(ctx, user.public_id));
    json(ctx.res, 200, {ok: true});
  }, {limits: [AUTH_LIMITS.token]});

  router.post('/api/auth/confirm-email-change', ctx => {
    const body = readFields(ctx.body, ['token']);
    const token = body.token;
    if (!isMailToken(token))
      throw invalidToken();

    // The token is used up even when the address was taken meanwhile
    const changed = db.transaction(() => {
      const now = clock.now();
      const used = consumeEmailToken(db, token, 'email_change', now);
      const user = used ? users.byId(used.userId) : null;
      if (!used || !user || used.newEmail === null || used.newEmailKey === null)
        return null;
      const holder = users.byEmailKey(used.newEmailKey);
      if (holder && holder.id !== user.id)
        return null;

      users.setEmail(user.id, used.newEmail, used.newEmailKey, now);
      deleteEmailTokens(db, user.id);
      db.run('DELETE FROM signup_tokens WHERE email_key = ?', used.newEmailKey);
      return user;
    });
    if (!changed)
      throw invalidToken();

    // The notice goes to the address the account had
    mail.send('emailChanged', {email: changed.email, emailKey: changed.email_key}, changed.locale,
              {username: changed.username});
    log.info('auth.email.change', logFields(ctx, changed.public_id));
    json(ctx.res, 200, {ok: true});
  }, {limits: [AUTH_LIMITS.token]});

  registerAccountRoutes(context);
}
