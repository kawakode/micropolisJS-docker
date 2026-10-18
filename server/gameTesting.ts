/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CityFile } from '../src/cityFile.js';
import type { CitySave } from './game/headless';

// Helpers for the tests of the shared cities (server/test/): the game's sample cities, and predictable random numbers.
// Kept apart from testing.ts, so that the other tests do not load the game.

const CITIES_DIRECTORY = path.join(__dirname, '..', 'cities');

interface CityFileReader {
  read(buffer: ArrayBuffer, options: Record<string, unknown>): CitySave;
}

// A sample city (cities/<name>.cty), read as the game reads it when the player picks it (see Scenarios.loadCity), then
// made a save of its own as the game makes it (with JSON)
export function sampleCity(name: string, options: Record<string, unknown> = {}): CitySave {
  const file = readFileSync(path.join(CITIES_DIRECTORY, name + '.cty'));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  const save = (CityFile as unknown as CityFileReader).read(buffer, {name: name.charAt(0).toUpperCase() + name.slice(1),
                                                                     ...options});
  return JSON.parse(JSON.stringify(save)) as CitySave;
}

// Random numbers between 0 and 1 from a seed (mulberry32): the same seed gives the same numbers
export function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A short digest of anything that goes through JSON
export function digest(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
    .slice(0, 16);
}
