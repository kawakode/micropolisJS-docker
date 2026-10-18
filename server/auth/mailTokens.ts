/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { Database } from '../db/database';
import { randomToken, sha256Hex } from '../security/tokens';

// The tokens of the links in mails: 32 random bytes (base64url, 43 characters), stored as their SHA-256 only, each
// good once and for a limited time:
//   ${publicOrigin}/#/signup/<token>  finish creating an account (signup_tokens, 24 h)
//   ${publicOrigin}/#/reset/<token>   choose a new password (email_tokens 'reset', 1 h; 24 h when made by an admin)
//   ${publicOrigin}/#/email/<token>   confirm a new email address (email_tokens 'email_change', 24 h)
// A token is checked without being used up while the form is validated; it is used up (DELETE ... RETURNING) in the
// transaction that does what it allows, after any password hash was computed.

const HOUR = 60 * 60 * 1000;

export const SIGNUP_HOURS = 24;
export const RESET_HOURS = 1;
export const ADMIN_RESET_HOURS = 24;
export const EMAIL_CHANGE_HOURS = 24;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const isMailToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);

export type LinkKind = 'signup' | 'reset' | 'email';

export const linkTo = (publicOrigin: string, kind: LinkKind, token: string) => `${publicOrigin}/#/${kind}/${token}`;

export interface SignupToken {
  email: string;
  emailKey: string;
  locale: string;
}

// A sign-up token for an address: older ones for that address no longer work
export function createSignupToken(db: Database, signup: SignupToken, now: number): string {
  const token = randomToken(32);
  db.transaction(() => {
    db.run('DELETE FROM signup_tokens WHERE email_key = ?', signup.emailKey);
    db.run(`INSERT INTO signup_tokens (token_hash, email, email_key, locale, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)`, sha256Hex(token), signup.email, signup.emailKey, signup.locale, now,
           now + SIGNUP_HOURS * HOUR);
  });
  return token;
}

interface SignupRow {
  email: string;
  email_key: string;
  locale: string;
}

const toSignup = (row: SignupRow | undefined): SignupToken | null =>
  row ? {email: row.email, emailKey: row.email_key, locale: row.locale} : null;

export function findSignupToken(db: Database, token: string, now: number): SignupToken | null {
  return toSignup(db.get<SignupRow>(
    'SELECT email, email_key, locale FROM signup_tokens WHERE token_hash = ? AND expires_at > ?',
    sha256Hex(token), now));
}

// Uses the token up: null if it was not there (used meanwhile, or expired)
export function consumeSignupToken(db: Database, token: string, now: number): SignupToken | null {
  return toSignup(db.get<SignupRow>(
    'DELETE FROM signup_tokens WHERE token_hash = ? AND expires_at > ? RETURNING email, email_key, locale',
    sha256Hex(token), now));
}

export type EmailTokenPurpose = 'reset' | 'email_change';

export interface EmailToken {
  userId: number;
  newEmail: string | null;
  newEmailKey: string | null;
}

interface EmailTokenRow {
  user_id: number;
  new_email: string | null;
  new_email_key: string | null;
}

const toEmailToken = (row: EmailTokenRow | undefined): EmailToken | null =>
  row ? {userId: row.user_id, newEmail: row.new_email, newEmailKey: row.new_email_key} : null;

export function createResetToken(db: Database, userId: number, now: number, hours = RESET_HOURS): string {
  const token = randomToken(32);
  db.run(`INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at)
          VALUES (?, ?, 'reset', ?, ?)`, sha256Hex(token), userId, now, now + hours * HOUR);
  return token;
}

// A token confirming a new address: an earlier change asked for no longer works
export function createEmailChangeToken(db: Database, userId: number, newEmail: string, newEmailKey: string,
                                       now: number): string {
  const token = randomToken(32);
  db.transaction(() => {
    db.run("DELETE FROM email_tokens WHERE user_id = ? AND purpose = 'email_change'", userId);
    db.run(`INSERT INTO email_tokens (token_hash, user_id, purpose, new_email, new_email_key, created_at, expires_at)
            VALUES (?, ?, 'email_change', ?, ?, ?, ?)`, sha256Hex(token), userId, newEmail, newEmailKey, now,
           now + EMAIL_CHANGE_HOURS * HOUR);
  });
  return token;
}

export function findEmailToken(db: Database, token: string, purpose: EmailTokenPurpose,
                               now: number): EmailToken | null {
  return toEmailToken(db.get<EmailTokenRow>(
    `SELECT user_id, new_email, new_email_key FROM email_tokens
     WHERE token_hash = ? AND purpose = ? AND expires_at > ?`, sha256Hex(token), purpose, now));
}

export function consumeEmailToken(db: Database, token: string, purpose: EmailTokenPurpose,
                                  now: number): EmailToken | null {
  return toEmailToken(db.get<EmailTokenRow>(
    `DELETE FROM email_tokens WHERE token_hash = ? AND purpose = ? AND expires_at > ?
     RETURNING user_id, new_email, new_email_key`, sha256Hex(token), purpose, now));
}

// After a password change or reset, or an email change: every reset and email-change link of the user stops working
export function deleteEmailTokens(db: Database, userId: number): void {
  db.run('DELETE FROM email_tokens WHERE user_id = ?', userId);
}
