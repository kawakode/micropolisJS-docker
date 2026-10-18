/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// The server's time, in Unix milliseconds. Everything that expires or is counted per period (sessions, tokens, rate
// limits, rooms) reads it from a Clock, so that tests can move time forward.
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

// A clock for tests: time only moves when told to
export class FakeClock implements Clock {
  private time: number;

  constructor(start = Date.UTC(2026, 0, 1)) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    this.time += ms;
  }

  set(time: number): void {
    this.time = time;
  }
}
