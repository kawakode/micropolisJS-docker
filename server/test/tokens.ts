/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { isPublicId, newPublicId, randomToken, sha256Hex, timingSafeEqualStr } from '../security/tokens';

describe('Tokens', () => {
  test('Random tokens are base64url, 32 bytes by default', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  test('SHA-256 in hex', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('Timing-safe comparison of strings of any length', () => {
    expect(timingSafeEqualStr('token', 'token')).toBe(true);
    expect(timingSafeEqualStr('token', 'tokeN')).toBe(false);
    expect(timingSafeEqualStr('token', 'token2')).toBe(false);
    expect(timingSafeEqualStr('', '')).toBe(true);
  });

  test('Public ids', () => {
    const id = newPublicId();
    expect(isPublicId(id)).toBe(true);
    expect(newPublicId()).not.toBe(id);
    for (const bad of [undefined, null, 42, '', 'short', id + 'x', id.slice(1) + '/', id.slice(1) + '.', {}])
      expect(isPublicId(bad)).toBe(false);
  });
});
