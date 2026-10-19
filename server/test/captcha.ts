/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { createHash, createHmac } from 'node:crypto';
import { FakeClock } from '../clock';
import { Captcha, CAPTCHA_LIFETIME, CaptchaChallenge, ESCALATION_TIME, loadCaptchaKey } from '../security/captcha';
import { solveCaptcha, testDatabase } from '../testing';

const KEY = Buffer.from('a test key that is long enough for hmac');

const setUp = (maxNumber = 10) => {
  const db = testDatabase();
  const clock = new FakeClock();
  return {db, clock, captcha: new Captcha({db, clock, key: KEY, maxNumber})};
};

const solution = (challenge: CaptchaChallenge) => ({salt: challenge.salt, challenge: challenge.challenge,
                                                   maxnumber: challenge.maxnumber, number: solveCaptcha(challenge),
                                                   signature: challenge.signature});

describe('Captcha challenges', () => {
  test('Have the documented shape, and are signed', () => {
    const {captcha, clock} = setUp(1000);
    const challenge = captcha.issue('login', '203.0.113.1');
    expect(challenge.algorithm).toBe('SHA-256');
    expect(challenge.maxnumber).toBe(1000);
    expect(challenge.salt).toMatch(/^[0-9a-f]{32}\.[0-9]{13}\.login$/);
    expect(Number(challenge.salt.split('.')[1])).toBe(clock.now() + CAPTCHA_LIFETIME);
    expect(challenge.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.signature).toBe(createHmac('sha256', KEY)
      .update(`${challenge.salt}:${challenge.challenge}:${challenge.maxnumber}`).digest('hex'));

    const n = solveCaptcha(challenge);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(1000);
    expect(createHash('sha256').update(challenge.salt + String(n)).digest('hex')).toBe(challenge.challenge);
  });

  test('The secret number covers the whole range', () => {
    const {captcha} = setUp(3);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++)
      seen.add(solveCaptcha(captcha.issue('register', 'x')));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('Captcha solutions', () => {
  test('A good solution is accepted once', () => {
    const {captcha, db} = setUp();
    const good = solution(captcha.issue('register', 'c'));
    expect(() => captcha.verify(good, 'register', 'c')).not.toThrow();
    expect(db.get<{n: number}>('SELECT count(*) AS n FROM captcha_used')?.n).toBe(1);

    // Replayed
    expect(() => captcha.verify(good, 'register', 'c')).toThrow(expect.objectContaining({
      status: 400, code: 'captcha_failed', refusal: 'replay'}));
  });

  test('Refused: another action, a wrong number, a bad signature, a changed difficulty', () => {
    const {captcha} = setUp();
    const refusal = (value: unknown, action: 'register' | 'login' | 'forgot' = 'login') => {
      try {
        captcha.verify(value, action, 'c');
        return null;
      } catch (error) {
        return [(error as any).code, (error as any).refusal];
      }
    };

    const good = solution(captcha.issue('login', 'c'));
    expect(refusal(good, 'register')).toEqual(['captcha_failed', 'action']);
    expect(refusal({...good, number: (good.number + 1) % 11})).toEqual(['captcha_failed', 'number']);
    expect(refusal({...good, signature: 'f'.repeat(64)})).toEqual(['captcha_failed', 'signature']);
    expect(refusal({...good, maxnumber: 11})).toEqual(['captcha_failed', 'signature']);
    // A salt for another action, signed for login: the action of the salt is what counts
    expect(refusal({...good, salt: good.salt.replace('.login', '.forgot')}, 'forgot'))
      .toEqual(['captcha_failed', 'signature']);
    // None of these used it up
    expect(refusal(good)).toBeNull();
  });

  test('Refused: anything but exactly the five fields, of the right types', () => {
    const {captcha} = setUp();
    const good = solution(captcha.issue('forgot', 'c'));
    const shapes: unknown[] = [
      null, 'solution', 42, [good], {},
      {...good, extra: 1},
      {salt: good.salt, challenge: good.challenge, maxnumber: good.maxnumber, number: good.number},
      {...good, number: String(good.number)},
      {...good, number: 1.5},
      {...good, number: -1},
      {...good, number: 11},
      {...good, maxnumber: 0},
      {...good, maxnumber: 1e9},
      {...good, salt: good.salt.toUpperCase()},
      {...good, salt: good.salt + ' '},
      {...good, challenge: good.challenge.slice(1)},
      {...good, signature: good.signature.toUpperCase()},
    ];
    for (const shape of shapes) {
      expect(() => captcha.verify(shape, 'forgot', 'c')).toThrow(expect.objectContaining({
        code: 'captcha_failed', refusal: 'shape'}));
    }
    expect(() => captcha.verify(good, 'forgot', 'c')).not.toThrow();
  });

  test('Expired after 10 minutes', () => {
    const {captcha, clock} = setUp();
    const good = solution(captcha.issue('login', 'c'));
    clock.advance(CAPTCHA_LIFETIME);
    expect(() => captcha.verify(good, 'login', 'c')).toThrow(expect.objectContaining({
      status: 400, code: 'captcha_expired'}));
  });

  test('Another key does not accept it', () => {
    const {captcha, db, clock} = setUp();
    const good = solution(captcha.issue('login', 'c'));
    const other = new Captcha({db, clock, key: Buffer.from('another key, just as long as the first'), maxNumber: 10});
    expect(() => other.verify(good, 'login', 'c')).toThrow(expect.objectContaining({refusal: 'signature'}));
  });
});

describe('Captcha difficulty', () => {
  test('Four times harder for a client that failed recently, and only for it', () => {
    const {captcha, clock} = setUp(1000);
    // Fetching many challenges changes nothing
    for (let i = 0; i < 20; i++)
      expect(captcha.issue('login', 'a').maxnumber).toBe(1000);

    expect(() => captcha.verify({nonsense: true}, 'login', 'a')).toThrow();
    expect(captcha.issue('login', 'a').maxnumber).toBe(4000);
    expect(captcha.issue('register', 'a').maxnumber).toBe(4000);
    expect(captcha.issue('login', 'b').maxnumber).toBe(1000);

    // A harder challenge is solved and accepted like any other
    const hard = captcha.issue('login', 'a');
    expect(() => captcha.verify(solution(hard), 'login', 'a')).not.toThrow();

    // A failed login counts too (the routes call noteFailure)
    captcha.noteFailure('b');
    expect(captcha.issue('login', 'b').maxnumber).toBe(4000);

    clock.advance(ESCALATION_TIME);
    captcha.prune();
    expect(captcha.issue('login', 'a').maxnumber).toBe(1000);
    expect(captcha.issue('login', 'b').maxnumber).toBe(1000);
  });
});

describe('Captcha key', () => {
  test('CAPTCHA_SECRET_FILE\'s, or one generated once and kept in the database', () => {
    const db = testDatabase();
    expect(loadCaptchaKey(db, 'from the secret file, at least 32 characters').toString())
      .toBe('from the secret file, at least 32 characters');
    expect(db.get('SELECT * FROM settings WHERE key = ?', 'captcha_key')).toBeUndefined();

    const generated = loadCaptchaKey(db, null);
    expect(generated.length).toBe(32);
    expect(loadCaptchaKey(db, null).equals(generated)).toBe(true);
  });
});
