/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { RemoteCity } from '../../src/remoteCity.js';
import type { CitySave, HeadlessCity } from './headless';

// What the players of a shared city are sent of it (DESIGN §5.4), worked out from the city the server simulates: the
// game's copy of the city applies the messages with src/remoteCity.js, which reads them with the same tables.
//
// The tiles, the road classes, the state and the maps are sent as changes: each is compared with a shadow, which holds
// what every player has been sent so far, and the shadow then takes the new values. The stats and the sprites are
// sent whole (the census histories only when they changed). A welcome gives a new player what the others have: the
// shadows for the parts sent as changes, the city as it is for the rest. The changes that follow then bring every
// player to the same city. A room flushes the changes to the players already there before a welcome (see flush): the
// shadows then equal the city, and so does the welcome.
//
// Shadows start as the city is when this object is made.

const MAP_NAMES = RemoteCity.MAP_NAMES as readonly string[];
const EVALUATION_FIELDS = RemoteCity.EVALUATION_FIELDS as readonly string[];
const BUDGET_FIELDS = RemoteCity.BUDGET_FIELDS as readonly string[];
const CENSUS_FIELDS = RemoteCity.CENSUS_FIELDS as readonly string[];
const HISTORY_FIELDS = RemoteCity.HISTORY_FIELDS as readonly string[];
const HISTORY_LENGTH = RemoteCity.HISTORY_LENGTH as number;

// The tiles and road classes that changed: [index, raw value, ...] and [index, road class, ...]
export interface TilesMessage {
  c: number[];
  r: number[];
}

// The figures that change often (see RemoteCity.applyState)
export interface CityScalars {
  funds: number;
  population: number;
  cityClass: string;
  score: number;
  date: {month: number; year: number};
  valves: {res: number; com: number; ind: number};
  speed: number;
  paused: boolean;
  autoBudget: boolean;
  autoBulldoze: boolean;
  disasters: boolean;
  level: number;
  cityTime: number;
}

export type StateMessage = Partial<CityScalars>;

export interface StatsMessage {
  evaluation: Record<string, unknown>;
  budget: Record<string, number>;
  census: Record<string, number | number[]>;
  historyTime: number;
  cityStatus: Record<string, unknown>;
  neighbours: unknown[];
}

// The overlays of the minimap, each one's values row by row
export type MapsMessage = Record<string, number[]>;

export type SpriteSample = [id: number, type: number, frame: number, x: number, y: number];

export interface WelcomeParts {
  save: CitySave;
  state: CityScalars;
  stats: StatsMessage;
  maps: MapsMessage;
  sprites: SpriteSample[];
}

export interface Flushed {
  tiles: TilesMessage | null;
  state: StateMessage | null;
  sprites: SpriteSample[] | null;
}

const STATE_KEYS = ['funds', 'population', 'cityClass', 'score', 'date', 'valves', 'speed', 'paused', 'autoBudget',
                    'autoBulldoze', 'disasters', 'level', 'cityTime'] as const;

const copyScalars = (state: CityScalars): CityScalars =>
  ({...state, date: {...state.date}, valves: {...state.valves}});

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
  }

  return a === b;
};

const sameValues = (a: Float64Array, b: Float64Array): boolean => {
  if (a.length !== b.length)
    return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i])
      return false;
  }

  return true;
};

export class CityState {
  private readonly city: HeadlessCity;
  private readonly tiles: Uint32Array;
  private readonly roads: Uint8Array;
  private lastState: CityScalars;
  private readonly lastMaps = new Map<string, Float64Array>();
  private readonly lastHistories: Float64Array;
  private spritesSent = false;

  constructor(city: HeadlessCity) {
    this.city = city;

    const data = city.map._data;
    this.tiles = new Uint32Array(data.length);
    for (let i = 0; i < data.length; i++)
      this.tiles[i] = data[i].getRawValue();
    this.roads = Uint8Array.from(city.map._roadClass);

    this.lastState = this.fullState();
    for (const name of MAP_NAMES)
      this.lastMaps.set(name, this.mapValues(name));
    this.lastHistories = this.histories();
  }

  // The tiles and road classes that changed since the last call (null if none)
  diffTiles(): TilesMessage | null {
    const data = this.city.map._data;
    const roadClass = this.city.map._roadClass;
    const tiles = this.tiles;
    const roads = this.roads;
    const c: number[] = [];
    const r: number[] = [];

    for (let i = 0, l = tiles.length; i < l; i++) {
      const raw = data[i].getRawValue();
      if (raw !== tiles[i]) {
        tiles[i] = raw;
        c.push(i, raw);
      }

      if (roadClass[i] !== roads[i]) {
        roads[i] = roadClass[i];
        r.push(i, roadClass[i]);
      }
    }

    return c.length > 0 || r.length > 0 ? {c, r} : null;
  }

  // Every figure of the state, as it is (the shadow is not changed)
  fullState(): CityScalars {
    const city = this.city;
    const simulation = city.simulation;
    const date = simulation.getDate();
    const valves = simulation._valves;

    return {
      funds: simulation.budget.totalFunds,
      population: city.hud.population,
      cityClass: city.hud.cityClass,
      score: city.hud.score,
      date: {month: date.month, year: date.year},
      valves: {res: valves.resValve, com: valves.comValve, ind: valves.indValve},
      speed: city.speed,
      paused: city.paused,
      autoBudget: simulation.budget.autoBudget,
      autoBulldoze: city.autoBulldoze,
      disasters: simulation.disasterManager.disastersEnabled,
      level: simulation.getLevel(),
      cityTime: simulation.getCityTime(),
    };
  }

  // The figures of the state that changed since the last call (null if none)
  diffState(): StateMessage | null {
    const state = this.fullState();
    const last = this.lastState;
    const changed: Record<string, unknown> = {};
    let any = false;

    for (const key of STATE_KEYS) {
      if (!sameValue(state[key], last[key])) {
        const value = state[key];
        changed[key] = typeof value === 'object' ? {...value} : value;
        any = true;
      }
    }

    this.lastState = state;
    return any ? changed as StateMessage : null;
  }

  // The census histories, one after the other
  private histories(): Float64Array {
    const census = this.city.simulation._census;
    const values = new Float64Array(HISTORY_FIELDS.length * HISTORY_LENGTH);
    HISTORY_FIELDS.forEach((field, k) => {
      const history = census[field] as number[];
      for (let i = 0; i < HISTORY_LENGTH; i++)
        values[k * HISTORY_LENGTH + i] = history[i];
    });
    return values;
  }

  // The evaluation, the budget, the census, the time of its histories, the city's status for the news, and the
  // neighbours. The census histories come only when they changed since they were last sent, or when asked for.
  stats(includeHistories = false): StatsMessage {
    const histories = this.histories();
    const send = includeHistories || !sameValues(histories, this.lastHistories);
    if (send)
      this.lastHistories.set(histories);

    return this.statsWith(send ? histories : null);
  }

  private statsWith(histories: Float64Array | null): StatsMessage {
    const simulation = this.city.simulation;
    const evaluation = simulation.evaluation;
    const budget = simulation.budget;
    const census = simulation._census;

    const evaluationStats: Record<string, unknown> = {};
    for (const field of EVALUATION_FIELDS)
      evaluationStats[field] = evaluation[field];
    evaluationStats.problemVotes = evaluation.problemVotes.map(vote => ({index: vote.index, voteCount: vote.voteCount}));
    evaluationStats.problemOrder = evaluation.problemOrder.slice();

    const budgetStats: Record<string, number> = {};
    for (const field of BUDGET_FIELDS)
      budgetStats[field] = budget[field] as number;

    const censusStats: Record<string, number | number[]> = {};
    for (const field of CENSUS_FIELDS)
      censusStats[field] = census[field] as number;
    if (histories !== null) {
      HISTORY_FIELDS.forEach((field, k) => {
        censusStats[field] = Array.from(histories.subarray(k * HISTORY_LENGTH, (k + 1) * HISTORY_LENGTH));
      });
    }

    return {
      evaluation: evaluationStats,
      budget: budgetStats,
      census: censusStats,
      historyTime: simulation.getHistoryTime(),
      cityStatus: this.city.cityStatus(),
      neighbours: this.city.describeNeighbours(),
    };
  }

  // A block map's values, row by row
  private mapValues(name: string): Float64Array {
    const blockMap = this.city.simulation.blockMaps[name];
    const values = new Float64Array(blockMap.width * blockMap.height);
    for (let y = 0; y < blockMap.height; y++) {
      for (let x = 0; x < blockMap.width; x++)
        values[y * blockMap.width + x] = blockMap.get(x, y);
    }
    return values;
  }

  // The overlays of the minimap that changed since they were last sent (all of them with onlyChanged false), or null
  maps(onlyChanged = true): MapsMessage | null {
    const result: MapsMessage = {};
    let any = false;

    for (const name of MAP_NAMES) {
      const values = this.mapValues(name);
      const last = this.lastMaps.get(name) as Float64Array;
      if (onlyChanged && sameValues(values, last))
        continue;

      last.set(values);
      result[name] = Array.from(values);
      any = true;
    }

    return any ? result : null;
  }

  // The sprites: [[id, type, frame, x, y], ...]
  sprites(): SpriteSample[] {
    return this.city.simulation.spriteManager.spriteList.filter(sprite => sprite.frame !== 0).map(sprite =>
      [sprite.id, sprite.type, sprite.frame, Math.round(sprite.x), Math.round(sprite.y)] as SpriteSample);
  }

  // The sprites to send: while there are some, and once more (empty) when they are gone; else null
  diffSprites(): SpriteSample[] | null {
    const sprites = this.sprites();
    if (sprites.length === 0 && !this.spritesSent)
      return null;

    this.spritesSent = sprites.length > 0;
    return sprites;
  }

  // The changes to send to the players: the tiles, the state and the sprites (each null when there is nothing)
  flush(): Flushed {
    return {tiles: this.diffTiles(), state: this.diffState(), sprites: this.diffSprites()};
  }

  // The parts of a welcome for a new player: the save, the state, the stats (with the histories), every map and the
  // sprites, as the other players have them (see above)
  welcome(): WelcomeParts {
    const save = this.city.save();
    save.map = Array.from(this.tiles, value => ({value}));
    save.roadClass = Array.from(this.roads).join('');

    const maps: MapsMessage = {};
    for (const name of MAP_NAMES)
      maps[name] = Array.from(this.lastMaps.get(name) as Float64Array);

    return {save, state: copyScalars(this.lastState), stats: this.statsWith(this.lastHistories), maps,
            sprites: this.sprites()};
  }
}
