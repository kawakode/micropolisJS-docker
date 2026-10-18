/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { checkEmail, checkUsername, isLocale, loginLookup, Users } from '../auth/users';
import { testDatabase } from '../testing';

describe('Usernames', () => {
  test('3 to 20 Latin letters (accents allowed), digits, _ . -, starting and ending with a letter or digit', () => {
    for (const good of ['bob', 'Alice_99', 'jean-luc.picard', 'Zoë', 'Ångström', 'ŁÓDŹ1', 'a1b', 'x'.repeat(20)])
      expect(checkUsername(good)).toMatchObject({ok: true, username: good});

    const reasons: [unknown, string][] = [
      ['', 'required'], ['ab', 'too_short'], ['x'.repeat(21), 'too_long'], [42, 'invalid'], [null, 'invalid'],
      ['_bob', 'invalid'], ['bob.', 'invalid'], ['bo b', 'invalid'], ['bob!', 'invalid'], ['Миша', 'invalid'],
      ['東京都', 'invalid'], ['bo​b', 'invalid'], ['bob\n', 'invalid'], ['<b>', 'invalid'],
      ['Admin', 'reserved'], ['ROOT', 'reserved'], ['KawaCity', 'reserved'], ['undefined', 'reserved'],
    ];
    for (const [input, reason] of reasons)
      expect(checkUsername(input)).toEqual({ok: false, reason});
  });

  test('Normalised (NFKC), compared without case', () => {
    // Full-width letters become ASCII
    expect(checkUsername('ｂｏｂ')).toEqual({ok: true, username: 'bob', key: 'bob'});
    expect(checkUsername('Bob')).toEqual({ok: true, username: 'Bob', key: 'bob'});
    // A decomposed accent is composed
    expect(checkUsername('Zoë')).toEqual({ok: true, username: 'Zoë', key: 'zoë'});
    expect(checkUsername('ａｄｍｉｎ')).toEqual({ok: false, reason: 'reserved'});
  });
});

describe('Email addresses', () => {
  test('The grammar of an HTML email input, with a Unicode domain converted', () => {
    expect(checkEmail('  Alice.Smith+game@Example.COM ')).toEqual(
      {ok: true, email: 'Alice.Smith+game@example.com', key: 'alice.smith+game@example.com'});
    expect(checkEmail('jo@bücher.de')).toEqual({ok: true, email: 'jo@xn--bcher-kva.de', key: 'jo@xn--bcher-kva.de'});
    expect(checkEmail("o'brien!#$%&*/=?^_`{|}~-@sub.example.org")).toMatchObject({ok: true});
    expect(checkEmail('a@b.co')).toMatchObject({ok: true});
  });

  test('Nothing a mail library could read as another address, a name, a comment or a list', () => {
    // From DESIGN.md: each of these was delivered by nodemailer to another address than the one written
    for (const bad of ['x<v@e.com>', 'a,b@e.com', 'v@e.com,', 'n:v@e.com;', 'a@b.com(c)', '"a@b"c@d.com',
                       'Victim <v@e.com>', 'v@e.com v@f.com', 'v@e.com\nBcc: w@f.com', 'v@e%41.com',
                       'v@[127.0.0.1]', 'v@localhost', 'v@e..com', 'v@-e.com', 'v@e.com.', '@e.com', 'v@', 'v',
                       'v@@e.com', 'v@e.com\u0000', 'é@e.com', 'v@e_e.com'])
      expect(checkEmail(bad)).toMatchObject({ok: false});

    // Spaces around it are trimmed: the address stored and mailed is the bare one
    expect(checkEmail('v@e.com\r\n')).toEqual({ok: true, email: 'v@e.com', key: 'v@e.com'});
  });

  test('At most 254 characters, 64 before the @', () => {
    const domain = 'a'.repeat(60) + '.' + 'b'.repeat(60) + '.' + 'c'.repeat(50) + '.example.com';
    expect(checkEmail('x'.repeat(64) + '@' + domain)).toMatchObject({ok: true});
    expect(checkEmail('x'.repeat(65) + '@example.com')).toEqual({ok: false, reason: 'invalid'});
    expect(checkEmail('x'.repeat(64) + '@' + domain + '.' + 'd'.repeat(10))).toEqual({ok: false, reason: 'too_long'});
    expect(checkEmail('')).toEqual({ok: false, reason: 'required'});
    expect(checkEmail(['a@b.com'])).toEqual({ok: false, reason: 'invalid'});
  });
});

describe('Locales and logins', () => {
  test('en and fr', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(true);
    for (const bad of ['EN', 'de', '', null, ['en']])
      expect(isLocale(bad)).toBe(false);
  });

  test('A login is a username or an address, looked up without case', () => {
    const db = testDatabase();
    const users = new Users(db);
    const alice = users.create({username: 'Alice', usernameKey: 'alice', email: 'Alice@example.com',
                                emailKey: 'alice@example.com', passwordHash: '!', locale: 'fr', now: 1000,
                                loggedIn: false});
    expect(alice).toMatchObject({username: 'Alice', email: 'Alice@example.com', locale: 'fr', created_at: 1000,
                                 last_login_at: null});
    expect(alice.public_id).toMatch(/^[A-Za-z0-9_-]{22}$/);

    for (const login of ['alice', 'ALICE', ' Alice ', 'ａｌｉｃｅ', 'alice@example.com', 'ALICE@EXAMPLE.COM'])
      expect(users.byLogin(login)?.id).toBe(alice.id);
    for (const login of ['alic', 'alice@example.org', 'alice@'])
      expect(users.byLogin(login)).toBeNull();

    // Logins that name no account are counted by a key that does not depend on case
    expect(loginLookup('Nobody').subjectKey).toBe(loginLookup('nobody').subjectKey);
    expect(loginLookup('Nobody@Example.com').subjectKey).toBe(loginLookup('nobody@example.com').subjectKey);
    expect(loginLookup('nobody').subjectKey).not.toBe(loginLookup('nobody@example.com').subjectKey);
    expect(loginLookup('nobody').subjectKey).toMatch(/^[0-9a-f]{64}$/);
  });
});
