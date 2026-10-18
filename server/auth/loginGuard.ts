/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { Clock } from '../clock';
import type { Database } from '../db/database';

// Password guessing (OWASP ASVS V2.2, NIST SP 800-63B 5.2.2). A login is checked against its subject: the account it
// names, or, when it names none, the hash of the login string, tracked the same way in memory so that the answers do
// not tell whether an account exists.
//   (a) Per subject and client (IP key): after 5 failures in a row, that pair waits 2^(n-5) minutes (at most 60)
//       before each new try (429 too_many_attempts). Other clients are not affected; a success clears the pair.
//   (b) Per subject: 100 failures in 24 hours lock it for 24 hours, or until its password is reset; the account's
//       owner gets one mail about it. For accounts this is kept in the users table, for unknown subjects in memory.
// A subject has at most one password check under way (others get 429 rate_limited), and the failure is counted
// before the check starts, so that parallel requests cannot try more than the limits allow.
//
// The account routes that ask for the current password (change password or email, delete the account) go through
// the same guard.

export const FREE_FAILURES = 5;
export const MAX_WAIT = 60 * 60 * 1000;
export const CEILING = 100;
export const CEILING_WINDOW = 24 * 60 * 60 * 1000;
export const LOCK_TIME = 24 * 60 * 60 * 1000;

const MINUTE = 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100000;

// Who a login is for: an account (by its id), or the key of a login that names no account
export type LoginSubject = {userId: number} | {unknownKey: string};

const subjectId = (subject: LoginSubject) => 'userId' in subject ? `u${subject.userId}` : `k${subject.unknownKey}`;

// The subject id of a pair's key (subject id, NUL, client key)
const pairSubject = (pairKey: string) => pairKey.slice(0, pairKey.indexOf('\u0000'));

export interface LoginAttempt {
  // The password was right: the pair's failures are forgotten
  succeeded(): void;
  // The password was wrong. locked: this failure locked the subject (mail the account's owner).
  failed(): {locked: boolean};
  // The password could not be checked (the server was busy): nothing is counted
  cancelled(): void;
}

export type GuardDecision =
  {allowed: true; attempt: LoginAttempt} |
  // busy: another check of this subject is under way; throttled: (a); locked: (b)
  {allowed: false; reason: 'busy' | 'throttled' | 'locked'; retryAfterMs: number};

// How long a pair waits after its nth failure in a row
export const waitAfter = (failures: number) =>
  failures < FREE_FAILURES ? 0 : Math.min(2 ** (failures - FREE_FAILURES) * MINUTE, MAX_WAIT);

interface PairState {
  failures: number;
  // Refused until then (0: not refused)
  blockedUntil: number;
  // Forgotten after then
  keepUntil: number;
}

interface CeilingState {
  failures: number;
  windowStart: number | null;
  lockedUntil: number | null;
}

interface UserCeilingRow {
  failed_logins_day: number;
  failed_window_start: number | null;
  locked_until: number | null;
}

export interface LoginGuardOptions {
  db: Database;
  clock: Clock;
  // How many pairs, and how many unknown subjects, are kept in memory at most
  maxEntries?: number;
}

export class LoginGuard {
  private readonly db: Database;
  private readonly clock: Clock;
  private readonly maxEntries: number;
  // By subject id and client key; oldest first
  private readonly pairs = new Map<string, PairState>();
  // By unknown key; oldest first
  private readonly unknown = new Map<string, CeilingState>();
  private readonly checking = new Set<string>();

  constructor(options: LoginGuardOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  // Sizes, for tests
  get size(): {pairs: number; unknown: number} {
    return {pairs: this.pairs.size, unknown: this.unknown.size};
  }

  private readCeiling(subject: LoginSubject): CeilingState | null {
    if ('userId' in subject) {
      const row = this.db.get<UserCeilingRow>(
        'SELECT failed_logins_day, failed_window_start, locked_until FROM users WHERE id = ?', subject.userId);
      return row ? {failures: row.failed_logins_day, windowStart: row.failed_window_start,
                    lockedUntil: row.locked_until} : null;
    }
    return this.unknown.get(subject.unknownKey) ?? null;
  }

  private writeCeiling(subject: LoginSubject, state: CeilingState): boolean {
    if ('userId' in subject) {
      this.db.run('UPDATE users SET failed_logins_day = ?, failed_window_start = ?, locked_until = ? WHERE id = ?',
                  state.failures, state.windowStart, state.lockedUntil, subject.userId);
      return true;
    }

    const key = subject.unknownKey;
    this.unknown.delete(key);
    if (this.unknown.size >= this.maxEntries &&
        !this.makeRoom(this.unknown, (k, s) => (s.lockedUntil ?? 0) > this.clock.now() || this.checking.has('k' + k)))
      return false;
    this.unknown.set(key, state);
    return true;
  }

  private ensurePair(key: string): PairState | null {
    const existing = this.pairs.get(key);
    if (existing) {
      this.pairs.delete(key);
      this.pairs.set(key, existing);
      return existing;
    }

    if (this.pairs.size >= this.maxEntries &&
        !this.makeRoom(this.pairs, (k, s) => s.blockedUntil > this.clock.now() || this.checking.has(pairSubject(k))))
      return null;
    const state = {failures: 0, blockedUntil: 0, keepUntil: 0};
    this.pairs.set(key, state);
    return state;
  }

  // Forgets the oldest entries that neither refuse anything nor have a check under way, down to 90% of the maximum;
  // false if none could go
  private makeRoom<T>(map: Map<string, T>, needed: (key: string, state: T) => boolean): boolean {
    const target = Math.floor(this.maxEntries * 0.9);
    for (const [key, state] of map) {
      if (map.size <= target)
        break;
      if (!needed(key, state))
        map.delete(key);
    }
    return map.size < this.maxEntries;
  }

  // Whether a password check may go ahead for that subject and client; if so, the failure is already counted, and
  // the attempt must be ended with succeeded(), failed() or cancelled()
  begin(subject: LoginSubject, clientKey: string): GuardDecision {
    const now = this.clock.now();
    const id = subjectId(subject);
    if (this.checking.has(id))
      return {allowed: false, reason: 'busy', retryAfterMs: 1000};

    const ceiling: CeilingState = this.readCeiling(subject) ?? {failures: 0, windowStart: null, lockedUntil: null};
    if (ceiling.lockedUntil !== null && ceiling.lockedUntil > now)
      return {allowed: false, reason: 'locked', retryAfterMs: ceiling.lockedUntil - now};

    const pairKey = id + '\u0000' + clientKey;
    const pair = this.pairs.get(pairKey);
    if (pair && pair.blockedUntil > now)
      return {allowed: false, reason: 'throttled', retryAfterMs: pair.blockedUntil - now};

    // Counted now, as a failure, before the check starts
    const counted = this.ensurePair(pairKey);
    if (!counted)
      return {allowed: false, reason: 'busy', retryAfterMs: 1000};
    counted.failures++;
    counted.keepUntil = now + CEILING_WINDOW;

    if (ceiling.windowStart === null || now - ceiling.windowStart >= CEILING_WINDOW) {
      ceiling.failures = 0;
      ceiling.windowStart = now;
    }
    ceiling.failures++;
    ceiling.lockedUntil = null;
    if (!this.writeCeiling(subject, ceiling)) {
      counted.failures--;
      return {allowed: false, reason: 'busy', retryAfterMs: 1000};
    }

    this.checking.add(id);
    let ended = false;
    const end = () => {
      if (ended)
        throw new Error('a login attempt was ended twice');
      ended = true;
      this.checking.delete(id);
    };

    // Takes back the failure counted in advance
    const uncount = () => {
      counted.failures = Math.max(0, counted.failures - 1);
      const state = this.readCeiling(subject);
      if (state && state.failures > 0 && state.windowStart === ceiling.windowStart) {
        state.failures--;
        this.writeCeiling(subject, state);
      }
    };

    return {
      allowed: true,
      attempt: {
        succeeded: () => {
          end();
          uncount();
          this.pairs.delete(pairKey);
        },
        failed: () => {
          end();
          const at = this.clock.now();
          counted.blockedUntil = counted.failures >= FREE_FAILURES ? at + waitAfter(counted.failures) : 0;
          counted.keepUntil = Math.max(counted.keepUntil, counted.blockedUntil);

          const state = this.readCeiling(subject);
          if (state && state.failures >= CEILING && (state.lockedUntil === null || state.lockedUntil <= at)) {
            this.writeCeiling(subject, {failures: 0, windowStart: null, lockedUntil: at + LOCK_TIME});
            return {locked: true};
          }
          return {locked: false};
        },
        cancelled: () => {
          end();
          uncount();
        },
      },
    };
  }

  // After a password reset: the account is unlocked, and its failures forgotten
  clearUser(userId: number): void {
    this.db.run('UPDATE users SET failed_logins_day = 0, failed_window_start = NULL, locked_until = NULL WHERE id = ?',
                userId);
    const prefix = `u${userId}\u0000`;
    for (const key of this.pairs.keys()) {
      if (key.startsWith(prefix))
        this.pairs.delete(key);
    }
  }

  // Forgets what no longer matters
  prune(): void {
    const now = this.clock.now();
    for (const [key, pair] of this.pairs) {
      if (pair.keepUntil <= now && !this.checking.has(pairSubject(key)))
        this.pairs.delete(key);
    }
    for (const [key, state] of this.unknown) {
      const windowOver = state.windowStart === null || now - state.windowStart >= CEILING_WINDOW;
      const unlocked = state.lockedUntil === null || state.lockedUntil <= now;
      if (windowOver && unlocked && !this.checking.has('k' + key))
        this.unknown.delete(key);
    }
  }
}
