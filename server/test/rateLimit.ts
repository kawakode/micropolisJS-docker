/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { FakeClock } from '../clock';
import { IpRateLimiter, RateLimiter } from '../security/rateLimit';

const MINUTE = 60 * 1000;

// Clocks start on a window boundary, so that the counts are easy to follow
const clockAt = (windows: number) => new FakeClock(windows * MINUTE);

describe('Rate limiter', () => {
  test('Hits are allowed up to the limit, then refused with a retry delay', () => {
    const clock = clockAt(1000);
    const limiter = new RateLimiter({limit: 3, windowMs: MINUTE, clock});
    expect([1, 2, 3].map(() => limiter.hit('a').allowed)).toEqual([true, true, true]);

    const refused = limiter.hit('a');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
    expect(refused.retryAfterMs).toBeLessThanOrEqual(2 * MINUTE);

    // Other keys are counted apart
    expect(limiter.hit('b').allowed).toBe(true);
  });

  test('The window slides: the previous window fades out', () => {
    const clock = clockAt(1000);
    const limiter = new RateLimiter({limit: 10, windowMs: MINUTE, clock});
    for (let i = 0; i < 10; i++)
      expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);

    // A new window, but the last one still weighs 10 * (1 - 0) = 10
    clock.advance(MINUTE);
    expect(limiter.hit('a').allowed).toBe(false);

    // Half way: it weighs 5, so 5 more fit
    clock.advance(MINUTE / 2);
    expect([1, 2, 3, 4, 5].map(() => limiter.hit('a').allowed)).toEqual([true, true, true, true, true]);
    expect(limiter.hit('a').allowed).toBe(false);

    // Two windows later, everything has faded
    clock.advance(2 * MINUTE);
    expect(limiter.check('a').allowed).toBe(true);
  });

  test('The retry delay is when a hit fits again', () => {
    const clock = clockAt(1000);
    const limiter = new RateLimiter({limit: 10, windowMs: MINUTE, clock});
    for (let i = 0; i < 10; i++)
      limiter.hit('a');

    clock.advance(MINUTE / 4);
    const refused = limiter.hit('a');
    expect(refused.allowed).toBe(false);

    clock.advance(refused.retryAfterMs - 1);
    expect(limiter.check('a').allowed).toBe(false);
    clock.advance(1);
    expect(limiter.check('a').allowed).toBe(true);
  });

  test('Refused hits are not counted; costs count as several hits', () => {
    const clock = clockAt(1000);
    const limiter = new RateLimiter({limit: 5, windowMs: MINUTE, clock});
    expect(limiter.hit('a', 4).allowed).toBe(true);
    expect(limiter.hit('a', 2).allowed).toBe(false);
    expect(limiter.hit('a', 1).allowed).toBe(true);
    expect(limiter.hit('b', 6).allowed).toBe(false);
  });

  test('When full, keys that are not limited make room, oldest first; limited keys never do', () => {
    const clock = clockAt(1000);
    const limiter = new RateLimiter({limit: 2, windowMs: MINUTE, clock, maxKeys: 10});

    // Five limited keys, then five that are not
    for (let i = 0; i < 5; i++) {
      limiter.hit('limited' + i);
      limiter.hit('limited' + i);
    }
    for (let i = 0; i < 5; i++)
      limiter.hit('free' + i);
    expect(limiter.size).toBe(10);

    // A new key pushes out the oldest free keys, down to 90%
    expect(limiter.hit('new').allowed).toBe(true);
    expect(limiter.size).toBeLessThanOrEqual(10);
    for (let i = 0; i < 5; i++)
      expect(limiter.hit('limited' + i).allowed).toBe(false);
    expect(limiter.check('free4').allowed).toBe(true);
  });

  test('When every key is limited, a new key is refused rather than one forgotten', () => {
    const clock = clockAt(1000);
    const limiter = new RateLimiter({limit: 1, windowMs: MINUTE, clock, maxKeys: 3});
    ['a', 'b', 'c'].forEach(key => limiter.hit(key));
    expect(limiter.hit('d').allowed).toBe(false);
    ['a', 'b', 'c'].forEach(key => expect(limiter.hit(key).allowed).toBe(false));

    // Once their windows pass, there is room again
    clock.advance(2 * MINUTE);
    expect(limiter.hit('d').allowed).toBe(true);
  });

  test('prune forgets keys whose windows have passed', () => {
    const clock = clockAt(1000);
    const limiter = new RateLimiter({limit: 5, windowMs: MINUTE, clock});
    limiter.hit('a');
    clock.advance(MINUTE);
    limiter.hit('b');
    clock.advance(MINUTE * 1.5);
    limiter.prune();
    expect(limiter.size).toBe(1);
    clock.advance(MINUTE);
    limiter.prune();
    expect(limiter.size).toBe(0);
  });
});

describe('Rate limiter per IP', () => {
  test('IP_LIMIT_FACTOR multiplies the limit', () => {
    const limiter = new IpRateLimiter({limit: 2, windowMs: MINUTE, clock: clockAt(1000), factor: 3});
    const keys = {key: '192.0.2.1', aggregateKey: null};
    expect([1, 2, 3, 4, 5, 6, 7].map(() => limiter.hit(keys).allowed)).toEqual(
      [true, true, true, true, true, true, false]);
  });

  test('An IPv6 /48 is limited as a whole at ten times the limit', () => {
    const limiter = new IpRateLimiter({limit: 2, windowMs: MINUTE, clock: clockAt(1000)});
    let allowed = 0;
    for (let i = 0; i < 30; i++) {
      if (limiter.hit({key: `2001:db8:1:${i.toString(16)}::/64`, aggregateKey: '2001:db8:1::/48'}).allowed)
        allowed++;
    }
    expect(allowed).toBe(20);
    expect(limiter.hit({key: '2001:db8:2::/64', aggregateKey: '2001:db8:2::/48'}).allowed).toBe(true);
  });

  test('A refusal by the aggregate does not count against the key', () => {
    const limiter = new IpRateLimiter({limit: 1, windowMs: MINUTE, clock: clockAt(1000)});
    for (let i = 0; i < 10; i++)
      limiter.hit({key: `k${i}`, aggregateKey: 'agg'});
    expect(limiter.hit({key: 'k10', aggregateKey: 'agg'}).allowed).toBe(false);
    expect(limiter.perKey.check('k10').allowed).toBe(true);
  });
});
