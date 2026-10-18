/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../clock';
import type { Database } from '../db/database';
import { HttpError } from '../http/response';

// The captcha: a proof of work made by the player's browser, with no third party. The server sends a challenge,
// the SHA-256 of a salt followed by a secret number n between 0 and maxnumber; the browser finds n by trying every
// number in turn (a second or two), and sends it back with the form. The challenge is signed with the server's key,
// so the server keeps nothing until a solution comes back:
//   salt       <32 lowercase hex>.<expiry, Unix ms, 13 digits>.<action>    (10 minutes)
//   challenge  hex(sha256(salt + String(n)))
//   signature  hex(hmac_sha256(key, salt + ':' + challenge + ':' + maxnumber))
// A solution is good for one attempt of the action it was asked for: its salt goes into captcha_used (until it
// expires) before the route checks anything else, so it cannot be sent twice.
//
// A client (IP key) that failed a captcha or a login recently gets challenges four times harder for a while; never
// because of how many challenges it fetched.

export const CAPTCHA_ACTIONS = ['register', 'login', 'forgot'] as const;

export type CaptchaAction = typeof CAPTCHA_ACTIONS[number];

export const CAPTCHA_LIFETIME = 10 * 60 * 1000;

export const ESCALATION_FACTOR = 4;

// How long a failure makes a client's challenges harder
export const ESCALATION_TIME = 60 * 60 * 1000;

const MAX_ESCALATED_CLIENTS = 100000;

const SALT = /^[0-9a-f]{32}\.[0-9]{13}\.(register|login|forgot)$/;
const HEX_DIGEST = /^[0-9a-f]{64}$/;
const SOLUTION_FIELDS = ['challenge', 'maxnumber', 'number', 'salt', 'signature'];

// The setting the key is generated into when no CAPTCHA_SECRET_FILE is given
const KEY_SETTING = 'captcha_key';

export interface CaptchaChallenge {
  algorithm: 'SHA-256';
  salt: string;
  challenge: string;
  maxnumber: number;
  signature: string;
}

export const isCaptchaAction = (value: unknown): value is CaptchaAction =>
  typeof value === 'string' && (CAPTCHA_ACTIONS as readonly string[]).includes(value);

// The signing key: CAPTCHA_SECRET_FILE's, or else one generated at the first start and kept in the database
export function loadCaptchaKey(db: Database, secret: string | null): Buffer {
  if (secret !== null)
    return Buffer.from(secret, 'utf8');

  db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', KEY_SETTING, randomBytes(32).toString('base64'));
  const row = db.get<{value: string}>('SELECT value FROM settings WHERE key = ?', KEY_SETTING);
  if (!row)
    throw new Error('the captcha key could not be stored');
  return Buffer.from(row.value, 'base64');
}

const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const sameHex = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Why a solution was refused (for the log; the player sees captcha_failed or captcha_expired)
export type CaptchaRefusal = 'shape' | 'action' | 'expired' | 'signature' | 'number' | 'replay';

export class CaptchaError extends HttpError {
  constructor(readonly refusal: CaptchaRefusal) {
    super(400, refusal === 'expired' ? 'captcha_expired' : 'captcha_failed');
  }
}

export interface CaptchaOptions {
  db: Database;
  clock: Clock;
  key: Buffer;
  // CAPTCHA_MAX_NUMBER: the difficulty (the median solving time is proportional to it)
  maxNumber: number;
}

export class Captcha {
  readonly maxNumber: number;
  private readonly db: Database;
  private readonly clock: Clock;
  private readonly key: Buffer;
  // The clients that failed recently, and when (oldest first)
  private readonly failures = new Map<string, number>();

  constructor(options: CaptchaOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.key = options.key;
    this.maxNumber = options.maxNumber;
  }

  private sign(salt: string, challenge: string, maxnumber: number): string {
    return createHmac('sha256', this.key).update(`${salt}:${challenge}:${maxnumber}`, 'utf8').digest('hex');
  }

  // Whether a client failed a captcha or a login recently
  isEscalated(clientKey: string): boolean {
    const time = this.failures.get(clientKey);
    return time !== undefined && this.clock.now() - time < ESCALATION_TIME;
  }

  // A failed captcha or login: the client's next challenges are harder
  noteFailure(clientKey: string): void {
    this.failures.delete(clientKey);
    if (this.failures.size >= MAX_ESCALATED_CLIENTS) {
      this.prune();
      // Still full: the oldest failures are forgotten
      for (const key of this.failures.keys()) {
        if (this.failures.size < MAX_ESCALATED_CLIENTS)
          break;
        this.failures.delete(key);
      }
    }
    this.failures.set(clientKey, this.clock.now());
  }

  prune(): void {
    const now = this.clock.now();
    for (const [key, time] of this.failures) {
      if (now - time < ESCALATION_TIME)
        break;
      this.failures.delete(key);
    }
  }

  issue(action: CaptchaAction, clientKey: string): CaptchaChallenge {
    const maxnumber = this.maxNumber * (this.isEscalated(clientKey) ? ESCALATION_FACTOR : 1);
    const expires = this.clock.now() + CAPTCHA_LIFETIME;
    const salt = `${randomBytes(16).toString('hex')}.${String(expires).padStart(13, '0')}.${action}`;
    const challenge = sha256Hex(salt + String(randomInt(0, maxnumber + 1)));
    return {algorithm: 'SHA-256', salt, challenge, maxnumber, signature: this.sign(salt, challenge, maxnumber)};
  }

  // Checks a solution sent with the form of `action`, and uses it up. Throws a CaptchaError (400 captcha_failed or
  // captcha_expired) and makes the client's next challenges harder when it is not good.
  verify(solution: unknown, action: CaptchaAction, clientKey: string): void {
    const refusal = this.check(solution, action);
    if (refusal) {
      this.noteFailure(clientKey);
      throw new CaptchaError(refusal);
    }
  }

  private check(solution: unknown, action: CaptchaAction): CaptchaRefusal | null {
    if (typeof solution !== 'object' || solution === null || Array.isArray(solution))
      return 'shape';

    const fields = Object.keys(solution).sort();
    if (fields.length !== SOLUTION_FIELDS.length || fields.some((field, i) => field !== SOLUTION_FIELDS[i]))
      return 'shape';

    const {salt, challenge, maxnumber, number, signature} = solution as Record<string, unknown>;
    if (typeof salt !== 'string' || !SALT.test(salt) || typeof challenge !== 'string' || !HEX_DIGEST.test(challenge) ||
        typeof signature !== 'string' || !HEX_DIGEST.test(signature) ||
        !Number.isSafeInteger(maxnumber) || (maxnumber as number) < 1 ||
        (maxnumber as number) > this.maxNumber * ESCALATION_FACTOR ||
        !Number.isSafeInteger(number) || (number as number) < 0 || (number as number) > (maxnumber as number))
      return 'shape';

    const [, expiresText, saltAction] = salt.split('.');
    if (saltAction !== action)
      return 'action';

    const expires = Number(expiresText);
    if (expires <= this.clock.now())
      return 'expired';
    if (expires > this.clock.now() + CAPTCHA_LIFETIME)
      return 'signature';

    if (!sameHex(this.sign(salt, challenge, maxnumber as number), signature))
      return 'signature';
    if (!sameHex(sha256Hex(salt + String(number)), challenge))
      return 'number';

    // One solution, one attempt
    if (this.db.run('INSERT OR IGNORE INTO captcha_used (salt, expires_at) VALUES (?, ?)', salt, expires).changes === 0)
      return 'replay';

    return null;
  }
}
