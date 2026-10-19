/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { Clock } from '../clock';

// Sliding-window rate limits, in memory. Each key counts its hits in the current fixed window and the previous one;
// the previous window's count fades out as the current one goes by, which approximates a true sliding window with two
// numbers per key. Refused hits are not counted.
//
// Memory is bounded: when the map is full, the least recently used keys that are not currently limited make room.
// A limited key is never forgotten early (that would lift its limit); if every key is limited, a new key is refused.

export interface RateLimitDecision {
  allowed: boolean;
  // When a refused hit would be allowed again (0 when allowed)
  retryAfterMs: number;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  clock: Clock;
  maxKeys?: number;
}

interface WindowState {
  index: number;
  previous: number;
  current: number;
}

const DEFAULT_MAX_KEYS = 100000;

const ALLOWED: RateLimitDecision = {allowed: true, retryAfterMs: 0};

export class RateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  private readonly clock: Clock;
  private readonly maxKeys: number;
  private readonly entries = new Map<string, WindowState>();

  constructor(options: RateLimiterOptions) {
    if (!(options.limit >= 1) || !(options.windowMs >= 1))
      throw new Error('a rate limit needs a limit and a window of at least 1');

    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.clock = options.clock;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  get size(): number {
    return this.entries.size;
  }

  // Counts `cost` hits for the key if they fit in its limit
  hit(key: string, cost = 1): RateLimitDecision {
    const decision = this.check(key, cost);
    if (decision.allowed)
      this.count(key, cost);
    return decision;
  }

  // Whether `cost` hits would fit, without counting them
  check(key: string, cost = 1): RateLimitDecision {
    const now = this.clock.now();
    const state = this.entries.get(key);
    if (!state) {
      if (cost > this.limit)
        return {allowed: false, retryAfterMs: this.windowMs};
      if (this.entries.size >= this.maxKeys && !this.makeRoom(now))
        return {allowed: false, retryAfterMs: this.windowMs};
      return ALLOWED;
    }

    const rolled = this.roll(state, now);
    if (this.estimate(rolled, now) + cost <= this.limit)
      return ALLOWED;

    return {allowed: false, retryAfterMs: this.retryAfter(rolled, now, cost)};
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  // Forgets the keys whose windows have passed
  prune(): void {
    const now = this.clock.now();
    for (const [key, state] of this.entries) {
      if (this.estimate(this.roll(state, now), now) === 0)
        this.entries.delete(key);
    }
  }

  private count(key: string, cost: number): void {
    const now = this.clock.now();
    const existing = this.entries.get(key);
    const state = existing ? this.roll(existing, now) : {index: this.windowIndex(now), previous: 0, current: 0};
    state.current += cost;

    // Most recently used last
    this.entries.delete(key);
    this.entries.set(key, state);
  }

  private windowIndex(now: number): number {
    return Math.floor(now / this.windowMs);
  }

  // The state moved to the current window
  private roll(state: WindowState, now: number): WindowState {
    const index = this.windowIndex(now);
    if (state.index === index)
      return state;

    state.previous = state.index === index - 1 ? state.current : 0;
    state.current = 0;
    state.index = index;
    return state;
  }

  private estimate(state: WindowState, now: number): number {
    const elapsed = (now - state.index * this.windowMs) / this.windowMs;
    return state.previous * (1 - elapsed) + state.current;
  }

  private retryAfter(state: WindowState, now: number, cost: number): number {
    const elapsedMs = now - state.index * this.windowMs;
    const remainingMs = this.windowMs - elapsedMs;
    const room = this.limit - cost - state.current;

    // Within this window, as the previous window's count fades
    if (room >= 0 && state.previous > 0) {
      const wait = this.windowMs * (1 - room / state.previous) - elapsedMs;
      if (wait < remainingMs)
        return Math.max(1, Math.ceil(wait));
    }

    // In the next window, as this window's count fades in turn
    const nextRoom = this.limit - cost;
    const wait = state.current > nextRoom ? this.windowMs * (1 - nextRoom / state.current) : 0;
    return Math.max(1, Math.ceil(remainingMs + wait));
  }

  private isLimited(state: WindowState, now: number): boolean {
    return this.estimate(this.roll(state, now), now) + 1 > this.limit;
  }

  // Forgets keys whose windows have passed, then the least recently used keys that are not limited, down to 90% of
  // the maximum. False when nothing could go.
  private makeRoom(now: number): boolean {
    const target = Math.floor(this.maxKeys * 0.9);
    for (const [key, state] of this.entries) {
      if (this.entries.size <= target)
        break;
      if (!this.isLimited(state, now))
        this.entries.delete(key);
    }
    return this.entries.size < this.maxKeys;
  }
}

// The keys of a client: see ClientAddress in http/request.ts
export interface IpKeys {
  key: string;
  aggregateKey: string | null;
}

export interface IpRateLimiterOptions extends RateLimiterOptions {
  // IP_LIMIT_FACTOR: every per-IP limit is multiplied by it, for players sharing one address (a school, an office)
  factor?: number;
}

// AGGREGATE_FACTOR times the limit for a whole IPv6 /48
export const AGGREGATE_FACTOR = 10;

// A limit per client IP key, and per IPv6 /48 at ten times the limit
export class IpRateLimiter {
  readonly perKey: RateLimiter;
  readonly aggregate: RateLimiter;

  constructor(options: IpRateLimiterOptions) {
    const limit = options.limit * (options.factor ?? 1);
    this.perKey = new RateLimiter({...options, limit});
    this.aggregate = new RateLimiter({...options, limit: limit * AGGREGATE_FACTOR});
  }

  hit(keys: IpKeys, cost = 1): RateLimitDecision {
    const decision = this.check(keys, cost);
    if (decision.allowed) {
      this.perKey.hit(keys.key, cost);
      if (keys.aggregateKey !== null)
        this.aggregate.hit(keys.aggregateKey, cost);
    }
    return decision;
  }

  check(keys: IpKeys, cost = 1): RateLimitDecision {
    const own = this.perKey.check(keys.key, cost);
    const wide = keys.aggregateKey !== null ? this.aggregate.check(keys.aggregateKey, cost) : ALLOWED;
    if (own.allowed && wide.allowed)
      return ALLOWED;

    return {allowed: false, retryAfterMs: Math.max(own.retryAfterMs, wide.retryAfterMs)};
  }

  prune(): void {
    this.perKey.prune();
    this.aggregate.prune();
  }
}
