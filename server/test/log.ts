/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { FakeClock } from '../clock';
import { captureConsole, createLogger, LogLevel } from '../log';

const capture = (level: LogLevel = 'info') => {
  const clock = new FakeClock(Date.UTC(2026, 9, 18, 12, 0, 0));
  const lines: any[] = [];
  const log = createLogger({level, clock, write: line => lines.push(JSON.parse(line))});
  return {clock, lines, log};
};

describe('Log', () => {
  test('One JSON object per line, with the time, level and event first', () => {
    const {lines, log} = capture();
    log.info('server.start', {port: 8080, level: 'ignored', skipped: undefined});
    expect(lines).toEqual([{time: '2026-10-18T12:00:00.000Z', level: 'info', event: 'server.start', port: 8080}]);
  });

  test('Lines below the level are left out', () => {
    const {lines, log} = capture('warn');
    log.debug('a');
    log.info('b');
    log.warn('c');
    log.error('d');
    expect(lines.map(line => line.event)).toEqual(['c', 'd']);
    expect(log.enabled('info')).toBe(false);
  });

  test('Errors keep their message and stack', () => {
    const {lines, log} = capture();
    log.error('http.error', {err: new TypeError('boom'), big: BigInt(2) ** BigInt(70)});
    expect(lines[0].err.name).toBe('TypeError');
    expect(lines[0].err.message).toBe('boom');
    expect(lines[0].err.stack).toContain('boom');
    expect(lines[0].big).toBe('1180591620717411303424');
  });

  test('Security events are logged once per key per minute, then the count left out on a line of its own', () => {
    const {clock, lines, log} = capture();
    for (let i = 0; i < 5; i++)
      log.security('csrf.reject', 'https://evil.example', {requestId: 'r' + i, origin: 'https://evil.example'});
    log.security('csrf.reject', 'https://other.example');
    log.security('rate_limited', 'https://evil.example');
    expect(lines.length).toBe(3);
    expect(lines[0]).toMatchObject({level: 'warn', event: 'csrf.reject', origin: 'https://evil.example',
                                    requestId: 'r0'});
    expect(lines[0].suppressed).toBeUndefined();

    clock.advance(59 * 1000);
    log.security('csrf.reject', 'https://evil.example');
    expect(lines.length).toBe(3);

    // The minute is over: its count, with the first line's fields (not its request id) and time, then the new line
    clock.advance(1000);
    log.security('csrf.reject', 'https://evil.example', {requestId: 'r9', origin: 'https://evil.example'});
    expect(lines.slice(3)).toEqual([
      {time: '2026-10-18T12:01:00.000Z', level: 'warn', event: 'csrf.reject', origin: 'https://evil.example',
       suppressed: 5, windowStart: '2026-10-18T12:00:00.000Z'},
      {time: '2026-10-18T12:01:00.000Z', level: 'warn', event: 'csrf.reject', origin: 'https://evil.example',
       requestId: 'r9'},
    ]);
  });

  test('No count is lost: it is written once its minute is over, by any later event, hourly, or at shutdown', () => {
    const {clock, lines, log} = capture();
    // A guessing run that changes address every 5 tries
    for (let ip = 1; ip <= 4; ip++) {
      for (let i = 0; i < 5; i++)
        log.security('auth.login.fail', `198.51.100.${ip} user`, {ip: `198.51.100.${ip}`, user: 'user'});
    }
    expect(lines.length).toBe(4);

    clock.advance(10 * 60 * 1000);
    log.security('captcha.fail', 'another client');
    // A line is one failure, or the count of those left out
    const failures = lines.filter(line => line.event === 'auth.login.fail');
    expect(failures.reduce((total, line) => total + (line.suppressed ?? 1), 0)).toBe(20);
    expect(failures.filter(line => line.suppressed === 4).map(line => line.ip)).toEqual(
      ['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4']);

    // Still in its minute: flush() writes the count so far, and the minute goes on
    log.security('captcha.fail', 'another client');
    log.security('captcha.fail', 'another client');
    log.flush();
    expect(lines[lines.length - 1]).toMatchObject({event: 'captcha.fail', suppressed: 2});
    log.flush();
    log.security('captcha.fail', 'another client');
    expect(lines.filter(line => line.event === 'captcha.fail').length).toBe(2);

    // Other levels, for events that are not warnings
    log.security('http.aborted', 'client', {path: '/api/x'}, 'info');
    expect(lines[lines.length - 1]).toMatchObject({level: 'info', event: 'http.aborted'});
    const quiet = capture('warn');
    quiet.log.security('http.aborted', 'client', {}, 'info');
    expect(quiet.lines).toEqual([]);
  });

  test('A full table forgets its oldest key first, with its count, and at no more cost than a free one', () => {
    const {clock, lines, log} = capture();
    log.security('rate_limited', 'first');
    log.security('rate_limited', 'first');
    clock.advance(1);

    // Keys in their minute fill the table: each new one costs about the same as before it was full
    const time = (from: number, to: number) => {
      const start = process.hrtime.bigint();
      for (let i = from; i < to; i++)
        log.security('rate_limited', 'key ' + i);
      return Number(process.hrtime.bigint() - start) / 1e6;
    };
    const filling = time(0, 9000);
    expect(lines.some(line => line.suppressed !== undefined)).toBe(false);
    const full = time(9000, 19000);
    expect(full).toBeLessThan(5 * filling + 100);

    // The first key went first, and its count with it
    expect(lines.find(line => line.suppressed !== undefined)).toMatchObject({event: 'rate_limited', suppressed: 1,
                                                                             windowStart: '2026-10-18T12:00:00.000Z'});
    log.security('rate_limited', 'key 18999');
    expect(lines.length).toBe(1 + 19000 + 1);
  });

  test('The console goes to the log: the game\'s warnings, once a minute per message, never on stderr', () => {
    const {clock, lines, log} = capture();
    const target = {warn: (..._args: unknown[]) => { throw new Error('not captured'); },
                    error: (..._args: unknown[]) => { throw new Error('not captured'); }};
    captureConsole(log, target);
    for (let y = 0; y < 1000; y++)
      target.warn('getTile called with bad bounds', 5, y - 1);
    target.error('Unable to read saved game', new Error('bad'));
    expect(lines).toEqual([
      expect.objectContaining({level: 'warn', event: 'game.console', message: 'getTile called with bad bounds 5 -1'}),
      expect.objectContaining({level: 'error', event: 'game.console', message: 'Unable to read saved game bad'}),
    ]);
    clock.advance(61 * 1000);
    target.warn('getTile called with bad bounds', 1, 1);
    expect(lines.slice(2)).toEqual([
      expect.objectContaining({event: 'game.console', suppressed: 999}),
      expect.objectContaining({event: 'game.console', message: 'getTile called with bad bounds 1 1'}),
    ]);
  });
});
