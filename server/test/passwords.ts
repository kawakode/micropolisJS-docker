/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { commonPasswordCount, isCommonPassword } from '../security/commonPasswords';
import { PasswordHasher, passwordProblem, UNUSABLE_PASSWORD_HASH } from '../security/passwords';

describe('Password rules', () => {
  const owner = {username: 'Alice_99', email: 'wonder.land@example.com'};

  test('12 to 128 code points once normalised, spaces and any character allowed', () => {
    expect(passwordProblem('')).toBe('too_short');
    expect(passwordProblem('abcdefghijk')).toBe('too_short');
    expect(passwordProblem('blue tram 42')).toBeNull();
    expect(passwordProblem('abcdefghijkl')).toBe('common');
    expect(passwordProblem('tr0p hy bat!')).toBeNull();
    // Code points, not UTF-16 units: 11 emoji are too short however many units they take
    expect(passwordProblem('😀😁😂🤣😃😄😅😆😉😊😋')).toBe('too_short');
    expect(passwordProblem('😀😁😂🤣😃😄😅😆😉😊😋😎')).toBeNull();
    // NFC: e + combining acute counts as one
    expect(passwordProblem('cafécaféabc')).toBe('too_short');
    expect(passwordProblem('x'.repeat(64) + 'y'.repeat(32) + 'abcdefghijklmnopqrstuvwxyz012345')).toBeNull();
    expect(passwordProblem('a1b2c3d4'.repeat(16))).toBeNull();
    expect(passwordProblem('a1b2c3d4'.repeat(16) + 'z')).toBe('too_long');
  });

  test('Common passwords are refused, whatever their case', () => {
    expect(commonPasswordCount()).toBeGreaterThan(19000);
    expect(isCommonPassword('password1234')).toBe(true);
    expect(passwordProblem('Password1234')).toBe('common');
    expect(passwordProblem('QWERTYUIOP123')).toBe('common');
    expect(passwordProblem('1q2w3e4r5t6y')).toBe('common');
    expect(passwordProblem('correct horse battery staple')).toBeNull();
  });

  test('The list is the generated one, with its source and licence', () => {
    for (const part of ['commonPasswordList1.ts', 'commonPasswordList2.ts']) {
      const source = readFileSync(path.join(__dirname, '..', 'security', part), 'utf8');
      expect(source).toContain('https://github.com/danielmiessler/SecLists');
      expect(source).toContain('MIT License');
      expect(source).toContain('Copyright (c) 2018 Daniel Miessler');
    }
    expect(commonPasswordCount()).toBe(20000);
  });

  test('Not the username, nor the address\'s local part, when 4 characters or more', () => {
    expect(passwordProblem('my name is alice_99 ok', owner)).toBe('contains_username');
    expect(passwordProblem('MY NAME IS ALICE_99 OK', owner)).toBe('contains_username');
    expect(passwordProblem('I live in Wonder.Land!', owner)).toBe('contains_email');
    expect(passwordProblem('Joe is here, ok?', {username: 'Joe', email: 'joe@example.com'})).toBeNull();
    expect(passwordProblem('example.com is a domain', owner)).toBeNull();
  });

  test('At least 4 different characters', () => {
    expect(passwordProblem('abcabcabcabc')).toBe('too_simple');
    expect(passwordProblem('aAaAbBbBcCcC')).toBe('too_simple');
    expect(passwordProblem('abcdabcdabcd')).toBeNull();
  });
});

describe('Password hashes', () => {
  const hasher = new PasswordHasher({cost: 10});

  test('scrypt with its settings in the hash, checked in constant time', async () => {
    const hash = await hasher.hash('correct horse battery staple', null);
    expect(hash).toMatch(/^scrypt\$10\$8\$3\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{86}==$/);
    expect(await hasher.hash('correct horse battery staple', null)).not.toBe(hash);

    expect(await hasher.verify('correct horse battery staple', hash, 'a')).toBe(true);
    expect(await hasher.verify('correct horse battery stapl', hash, 'a')).toBe(false);
    expect(await hasher.verify('Correct horse battery staple', hash, 'a')).toBe(false);
  });

  test('Passwords are compared once normalised (NFC)', async () => {
    const hash = await hasher.hash('café au lait chaud', null);
    expect(await hasher.verify('café au lait chaud', hash, null)).toBe(true);
  });

  test('A password set with other settings is hashed again', async () => {
    const stronger = new PasswordHasher({cost: 11});
    const hash = await stronger.hash('correct horse battery staple', null);
    expect(hash.startsWith('scrypt$11$8$3$')).toBe(true);
    // Still checked with its own settings
    expect(await hasher.verify('correct horse battery staple', hash, null)).toBe(true);
    expect(hasher.needsRehash(hash)).toBe(true);
    expect(stronger.needsRehash(hash)).toBe(false);
    expect(hasher.needsRehash(UNUSABLE_PASSWORD_HASH)).toBe(false);
  });

  test('No password matches an unusable hash, and checking takes a hash all the same', async () => {
    const unusable = new PasswordHasher({cost: 10});
    for (const stored of [UNUSABLE_PASSWORD_HASH, '', 'scrypt$10$8$3$x$y', 'bcrypt$whatever'])
      expect(await unusable.verify('anything at all', stored, null)).toBe(false);
    expect(await unusable.verifyDummy('anything at all', null)).toBe(false);
  });

  test('One hash at a time per client, a bounded queue', async () => {
    const small = new PasswordHasher({cost: 10, concurrency: 1, queueLimit: 2});
    await small.prepare();

    const first = small.hash('first password!', 'client-1');
    // The same client again: refused at once
    await expect(small.hash('second password', 'client-1')).rejects.toMatchObject({status: 429, code: 'rate_limited'});
    await expect(small.verify('x', 'scrypt$10$8$3$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==', 'client-1'))
      .rejects.toMatchObject({status: 429});

    // Two others wait; a fourth finds the queue full
    const second = small.hash('second password', 'client-2');
    const third = small.hash('third password!', 'client-3');
    expect(small.load).toEqual({running: 1, waiting: 2});
    await expect(small.hash('fourth password', 'client-4')).rejects.toMatchObject({status: 503, code: 'server_busy'});

    await Promise.all([first, second, third]);
    expect(small.load).toEqual({running: 0, waiting: 0});
    // The client can hash again once its hash is done
    await expect(small.hash('first password!', 'client-1')).resolves.toMatch(/^scrypt\$/);
  });
});
