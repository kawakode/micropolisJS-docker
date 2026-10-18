/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { Database } from './database';

// Deletes what has expired: sessions (past their absolute end, or unused for the idle time), the tokens of mailed
// links, and used captchas (kept only until their own expiry, to refuse a second use). Run every hour.

export interface PurgeCounts {
  sessions: number;
  signupTokens: number;
  emailTokens: number;
  captchas: number;
}

export function purgeExpired(db: Database, now: number, sessionIdleMs: number): PurgeCounts {
  return db.transaction(() => ({
    sessions: db.run('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?', now, now - sessionIdleMs).changes,
    signupTokens: db.run('DELETE FROM signup_tokens WHERE expires_at <= ?', now).changes,
    emailTokens: db.run('DELETE FROM email_tokens WHERE expires_at <= ?', now).changes,
    captchas: db.run('DELETE FROM captcha_used WHERE expires_at <= ?', now).changes,
  }));
}
