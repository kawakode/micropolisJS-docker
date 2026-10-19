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
// Usernames are public: 3 to 20 characters once normalised (NFKC), letters, digits 0-9 and _ . -, starting and
// ending with a letter or a digit. The letters are those the languages written with Latin letters use: ASCII letters,
// with accents or not, and a few others (USERNAME_LETTERS: ß, æ, ø, ł...). Unicode's other Latin letters (phonetic
// letters, small capitals, letters with a hook...) are refused: many of them look like an ASCII letter or digit. Two
// usernames that differ only by case are the same (username_key), and so are two that look alike (username_skeleton,
// see usernameSkeleton): neither can be taken next to the other, nor next to a reserved name.
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

// Digits are ASCII only (NFKC already makes full-width and superscript digits ASCII): the digits of other scripts look
// like letters (U+3007, U+09E6 and U+0D66 like o) or are written right to left (NKo, Arabic-Indic)
const USERNAME = /^[\p{Script=Latin}0-9](?:[\p{Script=Latin}0-9_.-]{1,18})[\p{Script=Latin}0-9]$/u;

// The letters that are not an ASCII letter with accents, in lower and upper case: German, Danish and Norwegian, French,
// Polish, Croatian and Vietnamese, Icelandic, Maltese, Turkish and Azerbaijani, Sami. With accents too (ǿ, ǽ).
export const USERNAME_LETTERS = 'ßẞæÆœŒøØłŁđĐðÐþÞħĦıŋŊŧŦəƏ';

const OTHER_LETTERS: ReadonlySet<string> = new Set(USERNAME_LETTERS);

// A letter a username may hold: an ASCII letter or one of USERNAME_LETTERS, once accents are taken off
const isUsernameLetter = (c: string) => {
  const base = c.normalize('NFD').replace(/\p{M}/gu, '');
  return /^[A-Za-z]$/.test(base) || OTHER_LETTERS.has(base);
};

// The letters of USERNAME_LETTERS that look like ASCII letters, by what they look like, in lower case (Unicode's
// confusables, UTS #39: ø is o with a stroke, ı is i); 0 looks like o. Usernames are compared without case, and an
// upper case I looks like an l: i, l, 1 and their lookalikes are taken as one letter.
const LOOKALIKES: Readonly<Record<string, string>> = {
  ae: 'æ',
  d: 'ðđ',
  h: 'ħ',
  l: 'i1ıł',
  o: '0ø',
  oe: 'œ',
  t: 'ŧ',
};

const LOOKALIKE = new Map(Object.entries(LOOKALIKES).flatMap(([plain, letters]) =>
  [...letters].map(letter => [letter, plain] as const)));

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export const EMAIL_MAX_LENGTH = 254;

// ASCII characters a domain may hold before its conversion (domainToASCII would otherwise turn %41 into A, say)
const DOMAIN_ASCII = /^[A-Za-z0-9.-]$/;

export type Checked<T> = ({ok: true} & T) | {ok: false; reason: FieldReason};

const codePoints = (text: string) => [...text].length;

export const usernameKey = (username: string) => username.normalize('NFKC').toLowerCase();

// What a username looks like, for comparing usernames (after UTS #39's skeleton, for the letters a username may hold):
// accents taken off, lower case, lookalikes as the ASCII letters they look like (LOOKALIKES), and m and w as rn and
// vv. Two usernames with the same skeleton could be taken one for the other.
export function usernameSkeleton(username: string): string {
  const bare = username.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  return [...bare].map(c => LOOKALIKE.get(c) ?? c).join('').replace(/m/g, 'rn').replace(/w/g, 'vv');
}

const RESERVED_SKELETONS: ReadonlySet<string> = new Set([...RESERVED_USERNAMES].map(usernameSkeleton));

export function checkUsername(input: unknown): Checked<{username: string; key: string; skeleton: string}> {
  if (typeof input !== 'string')
    return {ok: false, reason: 'invalid'};

  const username = input.normalize('NFKC');
  if (username === '')
    return {ok: false, reason: 'required'};
  if (codePoints(username) < LIMITS.usernameMin)
    return {ok: false, reason: 'too_short'};
  if (codePoints(username) > LIMITS.usernameMax)
    return {ok: false, reason: 'too_long'};
  if (!USERNAME.test(username) || ![...username].every(c => /^[0-9_.-]$/.test(c) || isUsernameLetter(c)))
    return {ok: false, reason: 'invalid'};

  const key = usernameKey(username);
  const skeleton = usernameSkeleton(username);
  if (RESERVED_USERNAMES.has(key) || RESERVED_SKELETONS.has(skeleton))
    return {ok: false, reason: 'reserved'};
  return {ok: true, username, key, skeleton};
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
  username_skeleton: string;
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

  // The account whose username looks like that one (usernameSkeleton)
  byUsernameSkeleton(skeleton: string): UserRow | null {
    return this.db.get<UserRow>('SELECT * FROM users WHERE username_skeleton = ?', skeleton) ?? null;
  }

  // The account a new username could be taken for: the same but for case, or looking like it
  usernameHolder(checked: {key: string; skeleton: string}): UserRow | null {
    return this.byUsernameKey(checked.key) ?? this.byUsernameSkeleton(checked.skeleton);
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
      `INSERT INTO users (public_id, username, username_key, username_skeleton, email, email_key, password_hash, locale,
                          created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newPublicId(), user.username, user.usernameKey, usernameSkeleton(user.username), user.email, user.emailKey,
      user.passwordHash, user.locale, user.now, user.now, user.loggedIn ? user.now : null).lastInsertRowid;
    return this.byId(id) as UserRow;
  }

  setPasswordHash(id: number, passwordHash: string, now: number): void {
    this.db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', passwordHash, now, id);
  }

  // The same password hashed with today's settings: replaced only if the password was not changed meanwhile (true
  // when it was replaced)
  rehashPassword(id: number, oldHash: string, newHash: string): boolean {
    return this.db.run('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?', newHash, id,
                       oldHash).changes === 1;
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
