/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { AppContext } from '../app';
import type { RequestContext } from '../http/request';
import { HttpError } from '../http/response';
import { LOCK_TIME } from './loginGuard';
import type { UserRow } from './users';

// Checking a password through the login guard (loginGuard.ts): at login, and on the account routes that ask for the
// current password. An unknown login is checked against a dummy hash, so that it takes as long and answers the same.

const HOUR = 60 * 60 * 1000;

const retryAfter = (ms: number) => ({'Retry-After': String(Math.max(1, Math.ceil(ms / 1000)))});

// The account's user when the password is theirs. Otherwise throws 401 invalid_credentials (wrong password, or no
// such account), 429 too_many_attempts (too many failures: Retry-After says how long to wait), 429 rate_limited
// (a check of the same account is under way, or the client already has a hash running) or 503 server_busy.
export async function checkPassword(context: AppContext, ctx: RequestContext, user: UserRow | null, unknownKey: string,
                                    password: string): Promise<UserRow> {
  const {auth, log} = context;
  const shownUser = user?.public_id ?? 'unknown';
  const logKey = `${ctx.ipKey} ${shownUser}`;
  const fields = {requestId: ctx.requestId, ip: ctx.ipKey, user: shownUser, route: ctx.path};

  const decision = auth.loginGuard.begin(user ? {userId: user.id} : {unknownKey}, ctx.ipKey);
  if (!decision.allowed) {
    log.security('auth.login.fail', logKey, {...fields, reason: decision.reason});
    throw new HttpError(429, decision.reason === 'busy' ? 'rate_limited' : 'too_many_attempts', undefined,
                        retryAfter(decision.retryAfterMs));
  }

  let matches: boolean;
  try {
    matches = user ? await auth.passwords.verify(password, user.password_hash, ctx.ipKey) :
      await auth.passwords.verifyDummy(password, ctx.ipKey);
  } catch (error) {
    decision.attempt.cancelled();
    throw error;
  }

  if (user && matches) {
    decision.attempt.succeeded();
    return user;
  }

  const {locked} = decision.attempt.failed();
  auth.captcha.noteFailure(ctx.ipKey);
  log.security('auth.login.fail', logKey, {...fields, reason: 'password'});
  if (locked) {
    log.warn('auth.login.locked', {...fields, message: 'Too many failed logins: locked for 24 h, or until a ' +
                                                      'password reset'});
    if (user)
      auth.mail.send('accountLocked', {email: user.email, emailKey: user.email_key}, user.locale,
                     {username: user.username, hours: LOCK_TIME / HOUR});
  }
  throw new HttpError(401, 'invalid_credentials');
}
