/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { FakeClock } from '../clock';
import { createLogger, LogLevel } from '../log';

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

  test('Security events are logged once per key per minute, then with the count left out', () => {
    const {clock, lines, log} = capture();
    for (let i = 0; i < 5; i++)
      log.security('csrf.reject', 'https://evil.example', {origin: 'https://evil.example'});
    log.security('csrf.reject', 'https://other.example');
    log.security('rate_limited', 'https://evil.example');
    expect(lines.length).toBe(3);
    expect(lines[0]).toMatchObject({level: 'warn', event: 'csrf.reject', origin: 'https://evil.example'});
    expect(lines[0].suppressed).toBeUndefined();

    clock.advance(59 * 1000);
    log.security('csrf.reject', 'https://evil.example');
    expect(lines.length).toBe(3);

    clock.advance(1000);
    log.security('csrf.reject', 'https://evil.example');
    expect(lines.length).toBe(4);
    expect(lines[3]).toMatchObject({event: 'csrf.reject', suppressed: 5});
  });
});
