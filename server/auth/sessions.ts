/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { ResolvedSession } from '../app';
import type { Clock } from '../clock';
import type { Database } from '../db/database';
import type { RequestSession } from '../http/request';
import type { Logger } from '../log';
import { randomToken, sha256Hex } from '../security/tokens';
import { requestUser, UserRow } from './users';

// Sessions: a random token (32 bytes, base64url) in an HttpOnly, SameSite=Strict cookie, __Host-kc_session (Secure)
// when PUBLIC_URL is https and kc_session otherwise. Only its SHA-256 is stored. A session ends after
// SESSION_IDLE_DAYS without use or SESSION_MAX_DAYS in any case (NIST 800-63B AAL1: a deliberate choice for a game,
// where changing the password or the email address and deleting the account always ask for the password again).
// A user has at most 20 sessions: a new one replaces the oldest.
//
// Ending sessions before their time (logout, password change, account deletion) is told to the listeners
// (onRevoked): the multiplayer server closes their live connections at once.

export const SESSION_COOKIE = 'kc_session';
export const SECURE_SESSION_COOKIE = '__Host-kc_session';

export const MAX_SESSIONS_PER_USER = 20;

// last_seen_at is written at most this often
export const TOUCH_INTERVAL = 5 * 60 * 1000;

const DAY = 24 * 60 * 60 * 1000;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const isSessionToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);

// Sessions ended before their time: one session (tokenHash), or every session of the user but `except`
export interface SessionRevocation {
  userId: number;
  tokenHash: string | null;
  except: string | null;
}

export type RevocationListener = (revocation: SessionRevocation) => void;

// Whether a revocation ends the session with that token hash, of that user
export function revokes(revocation: SessionRevocation, userId: number, tokenHash: string): boolean {
  if (revocation.userId !== userId)
    return false;
  return revocation.tokenHash !== null ? revocation.tokenHash === tokenHash : revocation.except !== tokenHash;
}

interface SessionRow {
  token_hash: string;
  user_id: number;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

// A session's columns, as read with its user's
interface SessionColumns {
  s_token_hash: string;
  s_user_id: number;
  s_created_at: number;
  s_last_seen_at: number;
  s_expires_at: number;
}

const toSession = (row: SessionRow): RequestSession => ({
  tokenHash: row.token_hash,
  userId: row.user_id,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  expiresAt: row.expires_at,
});

export interface SessionOptions {
  // PUBLIC_URL is https: the cookie is __Host- and Secure
  secure: boolean;
  idleDays: number;
  maxDays: number;
}

export class Sessions {
  readonly cookieName: string;
  readonly idleMs: number;
  readonly maxMs: number;
  private readonly secure: boolean;
  private readonly listeners = new Set<RevocationListener>();

  constructor(private readonly db: Database, private readonly clock: Clock, private readonly log: Logger,
              options: SessionOptions) {
    this.secure = options.secure;
    this.cookieName = options.secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
    this.idleMs = options.idleDays * DAY;
    this.maxMs = options.maxDays * DAY;
  }

  // A new session for the user (the oldest of theirs goes beyond 20). Call notifyRevoked with the result's
  // `replaced` once the transaction it may be in is committed.
  create(userId: number): {token: string; session: RequestSession; replaced: SessionRevocation[]} {
    const now = this.clock.now();
    const token = randomToken(32);
    const tokenHash = sha256Hex(token);

    const oldest = this.db.all<{token_hash: string}>(
      `SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?`,
      userId, MAX_SESSIONS_PER_USER - 1);
    for (const row of oldest)
      this.db.run('DELETE FROM sessions WHERE token_hash = ?', row.token_hash);

    this.db.run(`INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
                 VALUES (?, ?, ?, ?, ?)`, tokenHash, userId, now, now, now + this.maxMs);
    return {
      token,
      session: {tokenHash, userId, createdAt: now, lastSeenAt: now, expiresAt: now + this.maxMs},
      replaced: oldest.map(row => ({userId, tokenHash: row.token_hash, except: null})),
    };
  }

  // The session of a token hash and its user, if it is still valid (an expired one is deleted). Its last use is
  // recorded, at most every 5 minutes, unless touch is false.
  resolveHash(tokenHash: string, touch = true): ResolvedSession | null {
    const row = this.db.get<UserRow & SessionColumns>(
      `SELECT s.token_hash AS s_token_hash, s.user_id AS s_user_id, s.created_at AS s_created_at,
              s.last_seen_at AS s_last_seen_at, s.expires_at AS s_expires_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, tokenHash);
    if (!row)
      return null;

    const now = this.clock.now();
    if (row.s_expires_at <= now || row.s_last_seen_at + this.idleMs <= now) {
      this.db.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
      return null;
    }

    const session: RequestSession = {tokenHash, userId: row.s_user_id, createdAt: row.s_created_at,
                                     lastSeenAt: row.s_last_seen_at, expiresAt: row.s_expires_at};
    if (touch && now - row.s_last_seen_at >= TOUCH_INTERVAL) {
      this.db.run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', now, tokenHash);
      session.lastSeenAt = now;
    }
    return {user: requestUser(row), session};
  }

  // The session of a token, as sent in the cookie
  resolveToken(token: string | undefined, touch = true): ResolvedSession | null {
    return isSessionToken(token) ? this.resolveHash(sha256Hex(token), touch) : null;
  }

  // The session of a request's (or a WebSocket upgrade's) cookies
  resolve(cookies: ReadonlyMap<string, string>, touch = true): ResolvedSession | null {
    return this.resolveToken(cookies.get(this.cookieName), touch);
  }

  // The user's sessions, newest first
  forUser(userId: number): RequestSession[] {
    return this.db.all<SessionRow>('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC',
                                   userId).map(toSession);
  }

  // Ends one session (logout)
  revoke(session: RequestSession): void {
    this.db.run('DELETE FROM sessions WHERE token_hash = ?', session.tokenHash);
    this.notifyRevoked({userId: session.userId, tokenHash: session.tokenHash, except: null});
  }

  // Deletes the user's sessions, all of them or all but `except`, and returns the revocation to notify once the
  // transaction it is part of is committed
  deleteForUser(userId: number, except: string | null = null): SessionRevocation {
    if (except === null)
      this.db.run('DELETE FROM sessions WHERE user_id = ?', userId);
    else
      this.db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', userId, except);
    return {userId, tokenHash: null, except};
  }

  // Ends the user's sessions, all of them or all but `except` (logout everywhere)
  revokeAll(userId: number, except: string | null = null): void {
    this.notifyRevoked(this.deleteForUser(userId, except));
  }

  // Calls `listener` whenever sessions are ended before their time; returns the function that stops it
  onRevoked(listener: RevocationListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  notifyRevoked(...revocations: SessionRevocation[]): void {
    for (const revocation of revocations) {
      for (const listener of [...this.listeners]) {
        try {
          listener(revocation);
        } catch (error) {
          this.log.error('session.listener_error', {err: error});
        }
      }
    }
  }

  // The Set-Cookie header of a new session: kept until the session's longest life
  cookie(token: string): string {
    return `${this.cookieName}=${token}; Path=/; Max-Age=${Math.floor(this.maxMs / 1000)}; HttpOnly; ` +
           `SameSite=Strict${this.secure ? '; Secure' : ''}`;
  }

  // The Set-Cookie header that removes it
  clearCookie(): string {
    return `${this.cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${this.secure ? '; Secure' : ''}`;
  }
}
