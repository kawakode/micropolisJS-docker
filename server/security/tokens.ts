/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Random tokens (sessions, links in mails), their hashes, and public ids.

// A random token, base64url: 32 bytes by default (256 bits)
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// Tokens are stored as their SHA-256 only, so that the database alone does not give them away
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// Compares two strings in a time that does not depend on where they differ (nor on their lengths: both are hashed)
export function timingSafeEqualStr(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a, 'utf8').digest();
  const hashB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(hashA, hashB);
}

// The ids of users, cities, regions and invitations shown to the game: 16 random bytes, 22 characters of base64url.
// Internal integer ids never leave the server.
const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;

export function newPublicId(): string {
  return randomBytes(16).toString('base64url');
}

// Checked before any lookup
export function isPublicId(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_ID.test(value);
}
