/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { CEILING, CEILING_WINDOW, LOCK_TIME, LoginGuard, LoginSubject, waitAfter } from '../auth/loginGuard';
import { loginLookup, Users } from '../auth/users';
import { FakeClock } from '../clock';
import { testDatabase } from '../testing';

const MINUTE = 60 * 1000;

const setUp = (maxEntries?: number) => {
  const db = testDatabase();
  const clock = new FakeClock();
  const guard = new LoginGuard({db, clock, maxEntries});
  const alice = new Users(db).create({username: 'Alice', usernameKey: 'alice', email: 'a@example.com',
                                      emailKey: 'a@example.com', passwordHash: '!', locale: 'en', now: 0,
                                      loggedIn: false});
  return {db, clock, guard, alice: {userId: alice.id} as LoginSubject};
};

// One failed attempt; the refusal if there was one
const fail = (guard: LoginGuard, subject: LoginSubject, client: string) => {
  const decision = guard.begin(subject, client);
  if (!decision.allowed)
    return decision;
  return decision.attempt.failed();
};

describe('Login guard', () => {
  test('The wait after each failure in a row: none for 4, then 1, 2, 4... minutes, at most an hour', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 10, 11, 20].map(n => waitAfter(n) / MINUTE))
      .toEqual([0, 0, 0, 0, 1, 2, 4, 32, 60, 60]);
  });

  test('Per subject and client: 5 failures, then waits that grow; other clients go on', () => {
    for (const subject of [setUp().alice, {unknownKey: 'nobody'}]) {
      const {clock, guard} = setUp();
      for (let i = 0; i < 5; i++)
        expect(fail(guard, subject, 'ip-1')).toEqual({locked: false});

      expect(guard.begin(subject, 'ip-1')).toEqual({allowed: false, reason: 'throttled', retryAfterMs: MINUTE});
      clock.advance(30 * 1000);
      expect(guard.begin(subject, 'ip-1')).toEqual({allowed: false, reason: 'throttled', retryAfterMs: 30 * 1000});

      // Another client is not held up
      const other = guard.begin(subject, 'ip-2');
      expect(other.allowed).toBe(true);
      if (other.allowed)
        other.attempt.succeeded();

      clock.advance(30 * 1000);
      expect(fail(guard, subject, 'ip-1')).toEqual({locked: false});
      expect(guard.begin(subject, 'ip-1')).toMatchObject({reason: 'throttled', retryAfterMs: 2 * MINUTE});

      // A success clears the pair
      clock.advance(2 * MINUTE);
      const right = guard.begin(subject, 'ip-1');
      expect(right.allowed).toBe(true);
      if (right.allowed)
        right.attempt.succeeded();
      for (let i = 0; i < 4; i++)
        expect(fail(guard, subject, 'ip-1')).toEqual({locked: false});
      expect(guard.begin(subject, 'ip-1').allowed).toBe(true);
    }
  });

  test('One check at a time per subject, counted before it starts', () => {
    const {db, guard, alice} = setUp();
    const first = guard.begin(alice, 'ip-1');
    expect(first.allowed).toBe(true);
    expect(db.get('SELECT failed_logins_day FROM users')).toEqual({failed_logins_day: 1});
    expect(guard.begin(alice, 'ip-2')).toEqual({allowed: false, reason: 'busy', retryAfterMs: 1000});
    // Another subject is not concerned
    const other = guard.begin({unknownKey: 'x'}, 'ip-2');
    expect(other.allowed).toBe(true);

    if (first.allowed)
      first.attempt.cancelled();
    // Not counted when it could not be checked
    expect(db.get('SELECT failed_logins_day FROM users')).toEqual({failed_logins_day: 0});
    const second = guard.begin(alice, 'ip-2');
    expect(second.allowed).toBe(true);
    if (second.allowed) {
      second.attempt.succeeded();
      expect(() => second.attempt.failed()).toThrow(/twice/);
    }
    expect(db.get('SELECT failed_logins_day FROM users')).toEqual({failed_logins_day: 0});
  });

  test('The username and the address of an account are throttled apart, the account as a whole', () => {
    const {db, guard, alice} = setUp();
    const userId = (alice as {userId: number}).userId;
    const byName = {userId, loginKey: loginLookup('alice').subjectKey};
    const byAddress = {userId, loginKey: loginLookup('a@example.com').subjectKey};

    // Failures with the username do not hold the address up: that it is the same account does not show
    for (let i = 0; i < 5; i++)
      expect(fail(guard, byName, 'ip-1')).toEqual({locked: false});
    expect(guard.begin(byName, 'ip-1')).toMatchObject({allowed: false, reason: 'throttled'});
    const address = guard.begin(byAddress, 'ip-1');
    expect(address.allowed).toBe(true);

    // Nor does a check under way
    const name = guard.begin(byName, 'ip-2');
    expect(name.allowed).toBe(true);
    expect(guard.begin(byName, 'ip-3')).toEqual({allowed: false, reason: 'busy', retryAfterMs: 1000});
    if (address.allowed)
      address.attempt.failed();
    if (name.allowed)
      name.attempt.failed();

    // The ceiling counts them all
    expect(db.get('SELECT failed_logins_day FROM users')).toEqual({failed_logins_day: 7});

    // A reset forgets the failures of the username and the address
    fail(guard, {userId, loginKey: loginLookup('A@EXAMPLE.com').subjectKey}, 'ip-4');
    guard.clearUser({id: userId, username: 'Alice', email: 'a@example.com'});
    expect(guard.size.pairs).toBe(0);
    expect(guard.begin(byName, 'ip-1').allowed).toBe(true);
  });

  test('100 failures in 24 hours lock an account for 24 hours, once, until a reset', () => {
    const {db, clock, guard, alice} = setUp();
    const locks: boolean[] = [];
    for (let i = 0; i < CEILING; i++) {
      const result = fail(guard, alice, `ip-${Math.floor(i / 5)}`);
      locks.push('locked' in result && result.locked);
      clock.advance(1000);
    }
    expect(locks.slice(0, CEILING - 1).every(locked => !locked)).toBe(true);
    expect(locks[CEILING - 1]).toBe(true);
    expect(db.get('SELECT failed_logins_day, locked_until FROM users')).toEqual(
      {failed_logins_day: 0, locked_until: clock.now() - 1000 + LOCK_TIME});

    // Every client is refused, without counting
    expect(guard.begin(alice, 'ip-new')).toEqual({allowed: false, reason: 'locked',
                                                   retryAfterMs: LOCK_TIME - 1000});

    // A reset lifts it
    guard.clearUser({id: (alice as {userId: number}).userId, username: 'Alice', email: 'a@example.com'});
    expect(guard.begin(alice, 'ip-new').allowed).toBe(true);
  });

  test('The lock ends by itself after 24 hours; failures older than 24 hours do not count', () => {
    const {clock, guard, alice} = setUp();
    for (let i = 0; i < CEILING; i++)
      fail(guard, alice, `ip-${i}`);
    clock.advance(LOCK_TIME);
    const after = guard.begin(alice, 'ip-x');
    expect(after.allowed).toBe(true);
    if (after.allowed)
      after.attempt.failed();

    const {clock: clock2, guard: guard2, alice: alice2} = setUp();
    for (let i = 0; i < CEILING - 1; i++)
      fail(guard2, alice2, `ip-${i}`);
    clock2.advance(CEILING_WINDOW);
    expect(fail(guard2, alice2, 'ip-late')).toEqual({locked: false});
  });

  test('Unknown subjects lock the same way, in memory', () => {
    const {guard} = setUp();
    const nobody = {unknownKey: 'nobody'};
    let locked = false;
    for (let i = 0; i < CEILING; i++) {
      const result = fail(guard, nobody, `ip-${i}`);
      locked = 'locked' in result && result.locked;
    }
    expect(locked).toBe(true);
    expect(guard.begin(nobody, 'ip-new')).toMatchObject({allowed: false, reason: 'locked'});
  });

  test('Memory is bounded, and what is refusing is kept', () => {
    const {clock, guard} = setUp(20);
    // A pair that is waiting is never forgotten
    for (let i = 0; i < 5; i++)
      fail(guard, {unknownKey: 'held'}, 'ip-held');
    for (let i = 0; i < 100; i++)
      fail(guard, {unknownKey: `k${i}`}, `ip-${i}`);
    expect(guard.size.pairs).toBeLessThanOrEqual(20);
    expect(guard.size.unknown).toBeLessThanOrEqual(20);
    expect(guard.begin({unknownKey: 'held'}, 'ip-held')).toMatchObject({allowed: false, reason: 'throttled'});

    clock.advance(CEILING_WINDOW + LOCK_TIME);
    guard.prune();
    expect(guard.size).toEqual({pairs: 0, unknown: 0});
  });
});
