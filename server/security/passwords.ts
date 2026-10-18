/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import { HttpError } from '../http/response';
import { LIMITS } from '../limits';
import { isCommonPassword } from './commonPasswords';

// Passwords: the rules a new password follows, and its hash.
//
// Rules (OWASP ASVS 4.0.3 V2.1, ASVS 5 V6.2, NIST SP 800-63B): 12 to 128 Unicode code points once normalised (NFC),
// spaces and any character allowed, no composition rules, never truncated. Refused if common, if it contains the
// username or the email address's local part (of 4 characters or more), or if it has fewer than 4 different characters.
//
// Hashes: scrypt with N = 2^cost (PASSWORD_HASH_COST, 15 by default), r = 8, p = 3 (an OWASP setting), a 16-byte salt
// and a 64-byte key, stored as scrypt$<log2 N>$<r>$<p>$<salt, base64>$<key, base64> so that the settings can change:
// a password hashed with other settings is hashed again at its next login.
//
// Hashing takes a quarter of a second of a CPU, on Node.js's thread pool, which file and network work share: a few
// hashes run at once (at most 2, and one CPU is left free), at most 16 more wait, and each client (IP key) may have
// only one hash running or waiting. Beyond: 429 rate_limited for the client, 503 server_busy when the queue is full.

// Why a password is refused (a field reason of src/apiErrors.js), in the order they are checked
export type PasswordProblem = 'too_short' | 'too_long' | 'common' | 'contains_username' | 'contains_email' |
                              'too_simple';

// The account a password is for: it must not contain its username or the local part of its email address
export interface PasswordOwner {
  username?: string | null;
  email?: string | null;
}

// Parts of the username or address shorter than this may appear in a password
const MIN_CONTAINED = 4;
const MIN_DISTINCT = 4;

const codePoints = (text: string) => [...text].length;

export function passwordProblem(password: string, owner: PasswordOwner = {}): PasswordProblem | null {
  const normal = password.normalize('NFC');
  const length = codePoints(normal);
  if (length < LIMITS.passwordMin)
    return 'too_short';
  if (length > LIMITS.passwordMax)
    return 'too_long';

  const lower = normal.toLowerCase();
  if (isCommonPassword(lower))
    return 'common';

  const username = (owner.username ?? '').normalize('NFC').toLowerCase();
  if (codePoints(username) >= MIN_CONTAINED && lower.includes(username))
    return 'contains_username';

  const email = owner.email ?? '';
  const local = email.slice(0, Math.max(0, email.lastIndexOf('@'))).normalize('NFC').toLowerCase();
  if (codePoints(local) >= MIN_CONTAINED && lower.includes(local))
    return 'contains_email';

  if (new Set(lower).size < MIN_DISTINCT)
    return 'too_simple';

  return null;
}

export interface ScryptParams {
  cost: number;
  r: number;
  p: number;
}

export const SCRYPT_R = 8;
export const SCRYPT_P = 3;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

// Node's default memory limit (32 MiB) is too small for N = 2^15 and r = 8; higher costs need more
const MIN_MAX_MEMORY = 64 * 1024 * 1024;
const maxMemory = (params: ScryptParams) => Math.max(MIN_MAX_MEMORY, 2 * 128 * params.r * 2 ** params.cost);

const HASH_FORMAT = /^scrypt\$(\d{1,2})\$(\d{1,2})\$(\d{1,2})\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

interface ParsedHash {
  params: ScryptParams;
  salt: Buffer;
  key: Buffer;
}

// The settings, salt and key of a stored hash; null when it is not one (an account without a usable password)
function parseHash(stored: string): ParsedHash | null {
  const match = HASH_FORMAT.exec(stored);
  if (!match)
    return null;

  const params = {cost: Number(match[1]), r: Number(match[2]), p: Number(match[3])};
  const salt = Buffer.from(match[4], 'base64');
  const key = Buffer.from(match[5], 'base64');
  if (params.cost < 1 || params.cost > 20 || params.r < 1 || params.r > 16 || params.p < 1 || params.p > 16 ||
      salt.length < SALT_BYTES || key.length < 32 || key.length > 128)
    return null;

  return {params, salt, key};
}

const formatHash = (params: ScryptParams, salt: Buffer, key: Buffer) =>
  `scrypt$${params.cost}$${params.r}$${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;

const derive = (password: string, salt: Buffer, params: ScryptParams, length: number) => new Promise<Buffer>(
  (resolve, reject) => {
    scrypt(Buffer.from(password.normalize('NFC'), 'utf8'), salt, length,
           {N: 2 ** params.cost, r: params.r, p: params.p, maxmem: maxMemory(params)},
           (error, key) => error ? reject(error) : resolve(key));
  });

// A stored hash that no password matches: accounts made by the admin commands have it until their first reset
export const UNUSABLE_PASSWORD_HASH = '!';

export const DEFAULT_HASH_CONCURRENCY = Math.max(1, Math.min(2, os.availableParallelism() - 1));
export const HASH_QUEUE_LIMIT = 16;

export interface PasswordHasherOptions {
  // log2 N
  cost: number;
  concurrency?: number;
  queueLimit?: number;
}

export class PasswordHasher {
  readonly params: ScryptParams;
  readonly concurrency: number;
  readonly queueLimit: number;
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  // The clients with a hash running or waiting
  private readonly clients = new Set<string>();
  private dummy: Promise<ParsedHash> | null = null;

  constructor(options: PasswordHasherOptions) {
    this.params = {cost: options.cost, r: SCRYPT_R, p: SCRYPT_P};
    this.concurrency = options.concurrency ?? DEFAULT_HASH_CONCURRENCY;
    this.queueLimit = options.queueLimit ?? HASH_QUEUE_LIMIT;
  }

  // Hashes running and waiting (for tests)
  get load(): {running: number; waiting: number} {
    return {running: this.running, waiting: this.waiting.length};
  }

  // Computes, once, the hash that logins to unknown accounts are checked against (done at startup, so that the
  // first such login takes no longer than the others)
  prepare(): Promise<void> {
    return this.dummyHash().then(() => undefined);
  }

  private dummyHash(): Promise<ParsedHash> {
    if (!this.dummy) {
      const dummy = (async () => {
        const salt = randomBytes(SALT_BYTES);
        const key = await this.schedule(null, () => derive(randomBytes(16).toString('hex'), salt, this.params,
                                                           KEY_BYTES));
        return {params: this.params, salt, key};
      })();
      // Tried again next time if it could not be computed (the server was busy)
      dummy.catch(() => {
        if (this.dummy === dummy)
          this.dummy = null;
      });
      this.dummy = dummy;
    }
    return this.dummy;
  }

  // The hash of a new password, to store. clientKey: the client's IP key (null for the server's own work).
  async hash(password: string, clientKey: string | null): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await this.schedule(clientKey, () => derive(password, salt, this.params, KEY_BYTES));
    return formatHash(this.params, salt, key);
  }

  // Whether a password matches a stored hash. A hash that is not one (an unusable password) takes the same time.
  async verify(password: string, stored: string, clientKey: string | null): Promise<boolean> {
    const parsed = parseHash(stored);
    if (!parsed) {
      await this.verifyDummy(password, clientKey);
      return false;
    }

    const key = await this.schedule(clientKey, () => derive(password, parsed.salt, parsed.params, parsed.key.length));
    return timingSafeEqual(key, parsed.key);
  }

  // Takes the time of a verification, for a login to an account that does not exist
  async verifyDummy(password: string, clientKey: string | null): Promise<false> {
    const dummy = await this.dummyHash();
    const key = await this.schedule(clientKey, () => derive(password, dummy.salt, dummy.params, dummy.key.length));
    timingSafeEqual(key, dummy.key);
    return false;
  }

  // Whether a stored hash was made with other settings than today's (it is then replaced at the next login)
  needsRehash(stored: string): boolean {
    const parsed = parseHash(stored);
    return parsed !== null && (parsed.params.cost !== this.params.cost || parsed.params.r !== this.params.r ||
                               parsed.params.p !== this.params.p || parsed.salt.length !== SALT_BYTES ||
                               parsed.key.length !== KEY_BYTES);
  }

  // Runs a hash when a slot is free, refusing it at once if its client already has one or the queue is full
  private async schedule<T>(clientKey: string | null, task: () => Promise<T>): Promise<T> {
    if (clientKey !== null && this.clients.has(clientKey))
      throw new HttpError(429, 'rate_limited', undefined, {'Retry-After': '1'});
    if (this.running >= this.concurrency && this.waiting.length >= this.queueLimit)
      throw new HttpError(503, 'server_busy', undefined, {'Retry-After': '5'});

    if (clientKey !== null)
      this.clients.add(clientKey);
    try {
      if (this.running < this.concurrency)
        this.running++;
      else
        await new Promise<void>(resolve => this.waiting.push(resolve));

      try {
        return await task();
      } finally {
        // The slot goes to the next one waiting, if any
        const next = this.waiting.shift();
        if (next)
          next();
        else
          this.running--;
      }
    } finally {
      if (clientKey !== null)
        this.clients.delete(clientKey);
    }
  }
}
