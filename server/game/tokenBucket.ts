/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// A token bucket: up to `burst` tokens, refilled at `perSecond` tokens a second (by the clock given to each call).
// The live connections to the shared cities count their messages with them, and the tool commands in placements.
export class TokenBucket {
  private tokens: number;
  private last: number | null = null;

  constructor(readonly burst: number, readonly perSecond: number) {
    this.tokens = burst;
  }

  private refill(now: number): void {
    if (this.last !== null && now > this.last)
      this.tokens = Math.min(this.burst, this.tokens + (now - this.last) * this.perSecond / 1000);
    if (this.last === null || now > this.last)
      this.last = now;
  }

  // Whether `count` tokens are there (none are taken)
  has(count: number, now: number): boolean {
    this.refill(now);
    return this.tokens >= count;
  }

  // Takes `count` tokens if they are there
  take(count: number, now: number): boolean {
    if (!this.has(count, now))
      return false;
    this.tokens -= count;
    return true;
  }

  // Whether the bucket is full again (nothing would be lost by forgetting it)
  isFull(now: number): boolean {
    this.refill(now);
    return this.tokens >= this.burst;
  }
}

// Takes `count` tokens from each bucket if every one of them has them; else takes none
export function takeFromAll(buckets: readonly TokenBucket[], count: number, now: number): boolean {
  if (!buckets.every(bucket => bucket.has(count, now)))
    return false;
  for (const bucket of buckets)
    bucket.take(count, now);
  return true;
}
