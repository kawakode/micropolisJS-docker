/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { AppContext } from './app';
import type { Config } from './config';
import type { Database } from './db/database';
import type { RequestUser } from './http/request';
import { json } from './http/response';
import { LIMITS } from './limits';

// GET /api/health, for the container's health check, and GET /api/session, by which the game finds out whether this
// server offers accounts and multiplayer, and who is signed in.

export interface Features {
  // Mail can be sent: SMTP is configured, or MAIL_TRANSPORT=log
  mail: boolean;
  // New accounts can be created by players: mail, and REGISTRATION is not closed
  registration: boolean;
  // Logging in is offered: mail, or at least one account exists (made with the admin commands). A server without
  // mail and without accounts looks like the static game.
  accounts: boolean;
  // Shared cities and regions: not yet (stage B turns it on with accounts)
  multiplayer: boolean;
}

export function features(config: Config, db: Database): Features {
  const mail = config.mailTransport !== 'none';
  const accounts = mail || db.get<{present: number}>('SELECT EXISTS (SELECT 1 FROM users) AS present')?.present === 1;
  return {
    mail,
    registration: mail && config.registration === 'open',
    accounts,
    multiplayer: false,
  };
}

// A user as the game sees them (their own account): the public id, never the internal one
export function publicUser(user: RequestUser) {
  return {
    id: user.publicId,
    username: user.username,
    email: user.email,
    locale: user.locale,
    createdAt: user.createdAt,
  };
}

export function sessionInfo(context: AppContext, user: RequestUser | null) {
  const {config, db} = context;
  return {
    user: user ? publicUser(user) : null,
    features: features(config, db),
    publicUrl: config.publicOrigin,
    operator: config.operatorContact,
    build: config.buildId,
    limits: LIMITS,
  };
}

export function registerCoreRoutes(context: AppContext): void {
  const {config, db, log, router} = context;

  router.get('/api/health', ctx => {
    try {
      db.get('SELECT 1');
      json(ctx.res, 200, {ok: true, build: config.buildId});
    } catch (error) {
      log.error('health.fail', {requestId: ctx.requestId, err: error});
      json(ctx.res, 503, {ok: false, build: config.buildId});
    }
  });

  router.get('/api/session', ctx => json(ctx.res, 200, sessionInfo(context, ctx.user)), {auth: 'optional'});
}
