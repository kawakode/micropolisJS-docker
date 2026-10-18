/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { domainToASCII } from 'node:url';
import type { Database } from '../db/database';
import type { RequestUser } from '../http/request';
import type { FieldReason } from '../http/response';
import { LIMITS } from '../limits';
import { newPublicId, sha256Hex } from '../security/tokens';

// Accounts: the rules for usernames, email addresses and languages, and the users table.
//
// Usernames are public: 3 to 20 characters once normalised (NFKC), Latin letters (accents allowed), digits and _ . -,
// starting and ending with a letter or a digit. Two usernames that differ only by case are the same (username_key).
//
// Email addresses follow the grammar of an HTML email input (WHATWG), a Unicode domain being converted to ASCII
// first: nothing a mail library could read as a name, a comment or a list of addresses gets through, so the address
// mailed is always the one stored. email_key is the address in lower case.

export type Locale = 'en' | 'fr';

export const LOCALES: readonly Locale[] = ['en', 'fr'];

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin', 'administrator', 'root', 'system', 'kawacity', 'moderator', 'support', 'staff', 'server', 'null',
  'undefined', 'operator',
]);

const USERNAME = /^[\p{Script=Latin}\p{N}](?:[\p{Script=Latin}\p{N}_.-]{1,18})[\p{Script=Latin}\p{N}]$/u;

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export const EMAIL_MAX_LENGTH = 254;

// ASCII characters a domain may hold before its conversion (domainToASCII would otherwise turn %41 into A, say)
const DOMAIN_ASCII = /^[A-Za-z0-9.-]$/;

export type Checked<T> = ({ok: true} & T) | {ok: false; reason: FieldReason};

const codePoints = (text: string) => [...text].length;

export const usernameKey = (username: string) => username.normalize('NFKC').toLowerCase();

export function checkUsername(input: unknown): Checked<{username: string; key: string}> {
  if (typeof input !== 'string')
    return {ok: false, reason: 'invalid'};

  const username = input.normalize('NFKC');
  if (username === '')
    return {ok: false, reason: 'required'};
  if (codePoints(username) < LIMITS.usernameMin)
    return {ok: false, reason: 'too_short'};
  if (codePoints(username) > LIMITS.usernameMax)
    return {ok: false, reason: 'too_long'};
  if (!USERNAME.test(username))
    return {ok: false, reason: 'invalid'};

  const key = usernameKey(username);
  if (RESERVED_USERNAMES.has(key))
    return {ok: false, reason: 'reserved'};
  return {ok: true, username, key};
}

export function checkEmail(input: unknown): Checked<{email: string; key: string}> {
  if (typeof input !== 'string')
    return {ok: false, reason: 'invalid'};

  const trimmed = input.trim();
  if (trimmed === '')
    return {ok: false, reason: 'required'};
  if (trimmed.length > EMAIL_MAX_LENGTH * 4)
    return {ok: false, reason: 'too_long'};

  const at = trimmed.lastIndexOf('@');
  const domain = at === -1 ? '' : trimmed.slice(at + 1);
  if (at === -1 || [...domain].some(c => c < '\u0080' && !DOMAIN_ASCII.test(c)))
    return {ok: false, reason: 'invalid'};

  const email = trimmed.slice(0, at) + '@' + domainToASCII(domain);
  if (email.length > EMAIL_MAX_LENGTH)
    return {ok: false, reason: 'too_long'};
  if (!EMAIL.test(email))
    return {ok: false, reason: 'invalid'};

  return {ok: true, email, key: email.toLowerCase()};
}

// What a login (a username or an email address) is looked up by, and the key failed logins to an account that does
// not exist are counted by
export function loginLookup(login: string): {by: 'email' | 'username'; key: string; subjectKey: string} {
  if (login.includes('@')) {
    const checked = checkEmail(login);
    const key = checked.ok ? checked.key : login.trim().toLowerCase();
    return {by: 'email', key, subjectKey: sha256Hex('email:' + key)};
  }

  const key = usernameKey(login.trim());
  return {by: 'username', key, subjectKey: sha256Hex('username:' + key)};
}

export interface UserRow {
  id: number;
  public_id: string;
  username: string;
  username_key: string;
  email: string;
  email_key: string;
  password_hash: string;
  locale: string;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
  failed_logins_day: number;
  failed_window_start: number | null;
  locked_until: number | null;
}

// A user as the request handlers see them
export function requestUser(row: UserRow): RequestUser {
  return {
    id: row.id,
    publicId: row.public_id,
    username: row.username,
    email: row.email,
    locale: row.locale,
    createdAt: row.created_at,
  };
}

export interface NewUser {
  username: string;
  usernameKey: string;
  email: string;
  emailKey: string;
  passwordHash: string;
  locale: Locale;
  now: number;
  // Logged in at once (an account made by its owner, rather than by the admin commands)
  loggedIn: boolean;
}

export class Users {
  constructor(private readonly db: Database) {}

  byId(id: number): UserRow | null {
    return this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id) ?? null;
  }

  byPublicId(publicId: string): UserRow | null {
    return this.db.get<UserRow>('SELECT * FROM users WHERE public_id = ?', publicId) ?? null;
  }

  byUsernameKey(key: string): UserRow | null {
    return this.db.get<UserRow>('SELECT * FROM users WHERE username_key = ?', key) ?? null;
  }

  byEmailKey(key: string): UserRow | null {
    return this.db.get<UserRow>('SELECT * FROM users WHERE email_key = ?', key) ?? null;
  }

  // The account a login names (username or email address), if any
  byLogin(login: string): UserRow | null {
    const lookup = loginLookup(login);
    return lookup.by === 'email' ? this.byEmailKey(lookup.key) : this.byUsernameKey(lookup.key);
  }

  create(user: NewUser): UserRow {
    const id = this.db.run(
      `INSERT INTO users (public_id, username, username_key, email, email_key, password_hash, locale, created_at,
                          updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newPublicId(), user.username, user.usernameKey, user.email, user.emailKey, user.passwordHash, user.locale,
      user.now, user.now, user.loggedIn ? user.now : null).lastInsertRowid;
    return this.byId(id) as UserRow;
  }

  setPasswordHash(id: number, passwordHash: string, now: number): void {
    this.db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', passwordHash, now, id);
  }

  // The same password hashed with today's settings: replaced only if the password was not changed meanwhile
  rehashPassword(id: number, oldHash: string, newHash: string): void {
    this.db.run('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?', newHash, id, oldHash);
  }

  setEmail(id: number, email: string, emailKey: string, now: number): void {
    this.db.run('UPDATE users SET email = ?, email_key = ?, updated_at = ? WHERE id = ?', email, emailKey, now, id);
  }

  setLocale(id: number, locale: Locale, now: number): void {
    this.db.run('UPDATE users SET locale = ?, updated_at = ? WHERE id = ?', locale, now, id);
  }

  noteLogin(id: number, now: number): void {
    this.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', now, id);
  }

  // Deletes the account: its sessions and links go with it (ON DELETE CASCADE), and so will its cities
  delete(id: number): boolean {
    return this.db.run('DELETE FROM users WHERE id = ?', id).changes === 1;
  }

  list(): UserRow[] {
    return this.db.all<UserRow>('SELECT * FROM users ORDER BY username_key');
  }
}
