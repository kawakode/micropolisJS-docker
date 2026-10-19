/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { Budget } from '../../src/budget.js';
import { Evaluation } from '../../src/evaluation.js';
import { Neighbours } from '../../src/neighbours.js';
import { Ordinances } from '../../src/ordinances.js';
import { Scenarios } from '../../src/scenarios.js';
import { BIT_MASK, fromClassicValue, ZONEBIT } from '../../src/tileFlags';
import { AIRPORT, BIGPARK, BUSDEPOT, CHURCH, CHURCH1, CHURCH2, CHURCH3, CHURCH4, CHURCH5, CHURCH6, CHURCH7, FIREPOST,
         FIRESTATION, FULLSTADIUM, GASPLANT, HOSPITAL, KAWALAST, LIBRARY, NUCLEAR, POLICEPOST, POLICESTATION, PORT,
         POWERPLANT, RECYCLING, SCHOOL, SOLARPLANT, STADIUM, TOWER, TOWNHALL, UNIVERSITY, WATERWORKS,
         WINDTURBINE } from '../../src/tileValues';
import { ZoneUtils } from '../../src/zoneUtils.js';
import { CITY_HEIGHT, CITY_WIDTH, CitySave, createHeadlessCity, EdgeState, MILESTONE_KEYS,
         SAVE_VERSION } from './headless';
import { checkText, NEIGHBOUR_NAME_MAX } from './names';

// The save of a city a player uploads to share it (POST /api/cities), checked strictly before the server keeps and
// runs it. A save comes from the game, but anyone can send anything: each value is type-checked before anything looks
// inside it, nothing is walked generically (a value nested a million levels deep is refused at its first level), every
// number must be finite and in its range (1e400 reads as Infinity), every key must be known (__proto__ included), and
// the city is then made only of the values checked, copied into a fresh object. That save is finally opened as the
// server opens a city, and run for a step: whatever throws is refused too.
//
// Accepted: a save the game writes (Game.getSaveData, version 4, as in a .kawacity file), the content of an older
// .kawacity file (versions 1 to 3, brought to version 4 with the game's rules: see Storage.transitionOldSave), and a
// city file read by the game (CityFile.read: no version, isSavedGame). A save that went through
// Storage.parseSavedGame was already brought to the new tiles, but keeps its old version number: the game must send
// it with version 4.

// Why a save was refused, for the log and the tests (the player only gets invalid_input)
export class SaveError extends Error {
  constructor(readonly field: string) {
    super(`invalid save: ${field}`);
    this.name = 'SaveError';
  }
}

const INT32_MAX = 2 ** 31 - 1;
const INT32_MIN = -(2 ** 31);
const MAX_DEBT: number = Budget.MAX_DEBT;
const TILES = CITY_WIDTH * CITY_HEIGHT;
const HISTORY_LENGTH = 120;
// The longest name a save may carry: the city takes the name the player gives it
const SAVE_NAME_MAX = 1024;

const CITY_CLASSES: readonly string[] = ['CC_VILLAGE', 'CC_TOWN', 'CC_CITY', 'CC_CAPITAL', 'CC_METROPOLIS',
                                         'CC_MEGALOPOLIS'].map(key => (Evaluation as unknown as Record<string, string>)[key]);
const SIDES = Neighbours.SIDES as readonly string[];
const KINDS = Neighbours.KINDS as readonly string[];
const EVENTS = Neighbours.EVENTS as readonly string[];

// The save's scalar values, in the order the game writes them: their type and range, and whether a save may leave
// them out (the game then uses its own value, or the server sets it)
type Rule =
  {type: 'boolean'; optional?: boolean} |
  {type: 'integer' | 'number'; min: number; max: number; optional?: boolean} |
  {type: 'string'; max: number; optional?: boolean} |
  {type: 'class'};

const RULES: Readonly<Record<string, Rule>> = {
  // The game's own settings of the city (see Game.getSaveData)
  name: {type: 'string', max: SAVE_NAME_MAX, optional: true},
  ...Object.fromEntries(MILESTONE_KEYS.map(key => [key, {type: 'boolean', optional: true}])),
  dayNight: {type: 'boolean', optional: true},
  disastersEnabled: {type: 'boolean', optional: true},
  timeOfDay: {type: 'number', min: 0, max: 1, optional: true},
  autoBulldoze: {type: 'boolean', optional: true},

  // Simulation
  _cityTime: {type: 'integer', min: 0, max: INT32_MAX},
  _speed: {type: 'integer', min: 0, max: 3},
  _gameLevel: {type: 'integer', min: 0, max: 2, optional: true},
  achievements: {type: 'integer', min: 0, max: INT32_MAX, optional: true},
  weatherSnow: {type: 'boolean', optional: true},
  weatherWind: {type: 'integer', min: 0, max: 2, optional: true},
  snowMonths: {type: 'integer', min: 0, max: 12, optional: true},

  // GameMap (the tiles are checked apart)
  cityCentreX: {type: 'integer', min: 0, max: CITY_WIDTH - 1},
  cityCentreY: {type: 'integer', min: 0, max: CITY_HEIGHT - 1},
  pollutionMaxX: {type: 'integer', min: 0, max: CITY_WIDTH - 1},
  pollutionMaxY: {type: 'integer', min: 0, max: CITY_HEIGHT - 1},
  width: {type: 'integer', min: CITY_WIDTH, max: CITY_WIDTH},
  height: {type: 'integer', min: CITY_HEIGHT, max: CITY_HEIGHT},

  // Evaluation
  cityClass: {type: 'class'},
  cityScore: {type: 'integer', min: 0, max: 1000},
  cityPop: {type: 'integer', min: 0, max: INT32_MAX, optional: true},

  // Valves (see Valves.setValves)
  resValve: {type: 'integer', min: -2000, max: 2000},
  comValve: {type: 'integer', min: -1500, max: 1500},
  indValve: {type: 'integer', min: -1500, max: 1500},

  // Budget
  autoBudget: {type: 'boolean'},
  totalFunds: {type: 'integer', min: 0, max: INT32_MAX},
  policePercent: {type: 'number', min: 0, max: 1},
  roadPercent: {type: 'number', min: 0, max: 1},
  firePercent: {type: 'number', min: 0, max: 1},
  roadSpend: {type: 'integer', min: 0, max: INT32_MAX},
  policeSpend: {type: 'integer', min: 0, max: INT32_MAX},
  fireSpend: {type: 'integer', min: 0, max: INT32_MAX},
  roadMaintenanceBudget: {type: 'integer', min: 0, max: INT32_MAX},
  policeMaintenanceBudget: {type: 'integer', min: 0, max: INT32_MAX},
  fireMaintenanceBudget: {type: 'integer', min: 0, max: INT32_MAX},
  cityTax: {type: 'integer', min: 0, max: 20},
  roadEffect: {type: 'integer', min: 0, max: 32},
  policeEffect: {type: 'integer', min: 0, max: 1000},
  fireEffect: {type: 'integer', min: 0, max: 1000},
  dealsFund: {type: 'integer', min: INT32_MIN, max: INT32_MAX, optional: true},
  upkeepFund: {type: 'integer', min: INT32_MIN, max: 0, optional: true},
  debt: {type: 'integer', min: 0, max: MAX_DEBT, optional: true},
  debtPayment: {type: 'integer', min: 0, max: MAX_DEBT, optional: true},
  loanFund: {type: 'integer', min: -MAX_DEBT, max: 0, optional: true},
  ordinances: {type: 'integer', min: 0, max: Ordinances.ALL, optional: true},
  ordinanceFund: {type: 'integer', min: INT32_MIN, max: 0, optional: true},

  // Census (the histories are checked apart)
  resPop: {type: 'integer', min: 0, max: INT32_MAX},
  comPop: {type: 'integer', min: 0, max: INT32_MAX},
  indPop: {type: 'integer', min: 0, max: INT32_MAX},
  crimeRamp: {type: 'integer', min: 0, max: INT32_MAX},
  pollutionRamp: {type: 'integer', min: 0, max: INT32_MAX},
  landValueAverage: {type: 'integer', min: 0, max: INT32_MAX},
  pollutionAverage: {type: 'integer', min: 0, max: INT32_MAX},
  crimeAverage: {type: 'integer', min: 0, max: INT32_MAX},
  totalPop: {type: 'integer', min: 0, max: INT32_MAX},
};

// The census histories: 120 values each. The money's are 0 to 255 (128 is a balanced budget): some of the original
// city files hold larger ones, which are brought to 255.
const HISTORIES: readonly string[] = ['res', 'com', 'ind', 'crime', 'money', 'pollution'].flatMap(name =>
  ['10', '120'].map(period => name + 'Hist' + period));
const MONEY_HISTORY_MAX = 255;

// The saves of versions 1 and 2 had no centre for the city nor its pollution (Storage.transitionOldSave sets them)
const CENTRES = ['cityCentreX', 'cityCentreY', 'pollutionMaxX', 'pollutionMaxY'];

// Keys of a save that the city does not keep: the version (always the current one once read), the flag the game sets
// on a save it opened, and a flag of version 1
const DROPPED = ['version', 'isSavedGame', 'everClicked'];

const SPECIAL = ['map', 'roadClass', 'neighbours', 'scenario'];

const KNOWN_KEYS: ReadonlySet<string> = new Set([...Object.keys(RULES), ...HISTORIES, ...DROPPED, ...SPECIAL]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isIntegerIn = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

const isNumberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

// An object holding exactly the keys given (some of them optional), and no others
const hasOnlyKeys = (object: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(object).every(key => keys.includes(key));

const check = (ok: boolean, field: string): void => {
  if (!ok)
    throw new SaveError(field);
};

function checkScalar(field: string, value: unknown, rule: Rule): unknown {
  switch (rule.type) {
    case 'boolean':
      check(typeof value === 'boolean', field);
      return value;

    case 'integer':
      check(isIntegerIn(value, rule.min, rule.max), field);
      return value;

    case 'number':
      check(isNumberIn(value, rule.min, rule.max), field);
      return value;

    case 'string':
      check(typeof value === 'string' && value.length <= rule.max, field);
      return value;

    case 'class':
      check(typeof value === 'string' && CITY_CLASSES.includes(value), field);
      return value;
  }
}

const zoneSize = (ZoneUtils as unknown as {getZoneSize(tile: number): number}).getZoneSize;

// Whether the zone (or building) whose centre is the tile at index i lies on the map: the zone's code looks at every
// tile of it (from one tile above and left of the centre, see GameMap.putZone), and fails off the map. The game's
// tools never place one across the edge; a tile marked as a zone's centre must also be one.
function zoneFits(i: number, raw: number): boolean {
  const size = zoneSize(raw & BIT_MASK);
  if (size === 0)
    return false;
  if (size === 1)
    return true;

  const x = i % CITY_WIDTH;
  const y = Math.floor(i / CITY_WIDTH);
  return x >= 1 && y >= 1 && x - 1 + size <= CITY_WIDTH && y - 1 + size <= CITY_HEIGHT;
}

// The centres of the buildings that the simulation acts on by their value alone, whether the tile is marked as a zone's
// centre or not (the values given to MapScanner.addAction and RepairManager.addAction): a stadium starts its game, a
// nuclear plant may melt down, an airport turns its radar... over its whole building, which must then be on the map.
const BUILDING_CENTRES: ReadonlySet<number> = new Set([
  HOSPITAL, CHURCH, CHURCH1, CHURCH2, CHURCH3, CHURCH4, CHURCH5, CHURCH6, CHURCH7, PORT, AIRPORT, POWERPLANT,
  FIRESTATION, POLICESTATION, STADIUM, FULLSTADIUM, NUCLEAR, WINDTURBINE, GASPLANT, SOLARPLANT, SCHOOL, UNIVERSITY,
  BIGPARK, LIBRARY, POLICEPOST, FIREPOST, TOWNHALL, TOWER, RECYCLING, WATERWORKS,
  BUSDEPOT]);

// The tiles: 12000 objects {value}, each value a tile of the game (its number, and the flags it may have), each zone
// and building whole on the map. Saves of versions 1 to 3 have the tiles of the original game, brought to the new ones.
function checkMap(value: unknown, classic: boolean): {value: number}[] {
  check(Array.isArray(value) && value.length === TILES, 'map');
  const tiles = value as unknown[];
  const result = new Array<{value: number}>(TILES);

  for (let i = 0; i < TILES; i++) {
    const tile = tiles[i];
    check(isPlainObject(tile) && Object.hasOwn(tile, 'value') && Object.keys(tile).length === 1, 'map');
    let raw = (tile as Record<string, unknown>).value;
    check(isIntegerIn(raw, 0, classic ? 0xFFFF : 0x1FFFF), 'map');
    if (classic)
      raw = fromClassicValue(raw as number);
    check(((raw as number) & BIT_MASK) <= KAWALAST, 'map');
    const centre = ((raw as number) & ZONEBIT) !== 0 || BUILDING_CENTRES.has((raw as number) & BIT_MASK);
    check(!centre || zoneFits(i, raw as number), 'map');
    result[i] = {value: raw as number};
  }

  return result;
}

function checkHistory(field: string, value: unknown): number[] {
  check(Array.isArray(value) && value.length === HISTORY_LENGTH, field);
  const values = value as unknown[];
  const max = field.startsWith('money') ? MONEY_HISTORY_MAX : INT32_MAX;
  const result = new Array<number>(HISTORY_LENGTH);
  for (let i = 0; i < HISTORY_LENGTH; i++) {
    check(isIntegerIn(values[i], 0, INT32_MAX), field);
    result[i] = Math.min(values[i] as number, max);
  }
  return result;
}

// The deals with a neighbour (or the months they were in force this year): known kinds only
function checkKinds(field: string, value: unknown, valid: (v: unknown) => boolean): Record<string, unknown> {
  check(isPlainObject(value), field);
  const kinds = value as Record<string, unknown>;
  check(hasOnlyKeys(kinds, KINDS), field);

  const result: Record<string, unknown> = {};
  for (const kind of KINDS) {
    if (Object.hasOwn(kinds, kind)) {
      check(valid(kinds[kind]), field);
      result[kind] = kinds[kind];
    }
  }
  return result;
}

// The cities beyond the edges (see Neighbours.save): one per side, in order. Their names follow the server's rule for
// names.
function checkNeighbours(value: unknown): Record<string, unknown>[] {
  check(Array.isArray(value) && value.length === SIDES.length, 'neighbours');
  const list = value as unknown[];

  return SIDES.map((side, i) => {
    const neighbour = list[i];
    const field = `neighbours.${side}`;
    check(isPlainObject(neighbour), field);
    const n = neighbour as Record<string, unknown>;
    check(hasOnlyKeys(n, ['side', 'name', 'population', 'deals', 'months', 'event']), field);
    check(n.side === side, field);

    const name = checkText(n.name, NEIGHBOUR_NAME_MAX);
    check(name.ok, field + '.name');
    check(isIntegerIn(n.population, 0, INT32_MAX), field + '.population');

    const result: Record<string, unknown> = {side, name: name.ok ? name.text : '', population: n.population};
    if (Object.hasOwn(n, 'deals'))
      result.deals = checkKinds(field + '.deals', n.deals, v => typeof v === 'boolean');
    if (Object.hasOwn(n, 'months'))
      result.months = checkKinds(field + '.months', n.months, v => isIntegerIn(v, 0, 12));
    if (Object.hasOwn(n, 'event') && n.event !== null) {
      const event = n.event as Record<string, unknown>;
      check(isPlainObject(event) && hasOnlyKeys(event, ['kind', 'months']) && EVENTS.includes(event.kind as string) &&
            isIntegerIn(event.months, 1, Neighbours.EVENT_MONTHS), field + '.event');
      result.event = {kind: event.kind, months: event.months};
    }
    return result;
  });
}

// The save, checked and rebuilt from the values checked only. Throws SaveError.
export function validateSave(input: unknown): CitySave {
  check(isPlainObject(input), 'save');
  const save = input as Record<string, unknown>;

  for (const key of Object.keys(save))
    check(KNOWN_KEYS.has(key), key);

  const has = (key: string) => Object.hasOwn(save, key);

  let version = SAVE_VERSION;
  if (has('version')) {
    check(isIntegerIn(save.version, 1, SAVE_VERSION), 'version');
    version = save.version as number;
  }
  if (has('isSavedGame'))
    check(save.isSavedGame === true, 'isSavedGame');
  if (has('everClicked'))
    check(typeof save.everClicked === 'boolean', 'everClicked');
  // The scenario the city plays, checked against the game's (see Scenarios.clean)
  let scenario: Record<string, unknown> | null = null;
  if (has('scenario') && save.scenario !== null) {
    scenario = Scenarios.clean(save.scenario);
    check(scenario !== null, 'scenario');
  }

  const clean: CitySave = {};
  for (const [key, rule] of Object.entries(RULES)) {
    const optional = ('optional' in rule && rule.optional === true) || (version <= 2 && CENTRES.includes(key));
    if (!has(key)) {
      check(optional, key);
      continue;
    }
    clean[key] = checkScalar(key, save[key], rule);
  }

  // Versions 1 and 2: the centres are those the game gives such a save
  if (version <= 2) {
    clean.cityCentreX = clean.pollutionMaxX = Math.floor(CITY_WIDTH / 2);
    clean.cityCentreY = clean.pollutionMaxY = Math.floor(CITY_HEIGHT / 2);
  }

  check(has('map'), 'map');
  clean.map = checkMap(save.map, version < SAVE_VERSION);

  if (has('roadClass')) {
    const roadClass = save.roadClass;
    check(typeof roadClass === 'string' && roadClass.length === TILES && /^[0-3]*$/.test(roadClass), 'roadClass');
    clean.roadClass = roadClass;
  } else {
    clean.roadClass = '0'.repeat(TILES);
  }

  for (const field of HISTORIES) {
    check(has(field), field);
    clean[field] = checkHistory(field, save[field]);
  }

  if (has('neighbours'))
    clean.neighbours = checkNeighbours(save.neighbours);

  clean.scenario = scenario;
  clean.version = SAVE_VERSION;
  return clean;
}

// A city ready to be kept: the text of its save, and the figures the cities table keeps beside it
export interface PreparedCity {
  saveText: string;
  population: number;
  score: number;
  cityTime: number;
  paused: boolean;
  edgeState: Record<string, EdgeState>;
}

export interface PrepareOptions {
  // The name the player gives the city (already checked), and its level
  name: string;
  level: number;
}

// Checks a save (see validateSave), names the city, sets its level, then opens it as the server opens a city and keeps
// the save that city writes (the game fills in what the save left out, as when it opens a city), its population
// counted from its map (see HeadlessCity.recount). That save is opened again and run for one step: a save the
// simulation cannot run is refused. Throws SaveError.
export function prepareCity(input: unknown, options: PrepareOptions): PreparedCity {
  const save = validateSave(input);
  save.name = options.name;
  save._gameLevel = options.level;

  try {
    const city = createHeadlessCity(save);
    city.recount();
    const saveText = city.saveText();
    const prepared = {saveText, population: city.population, score: city.score, cityTime: city.cityTime,
                      paused: city.paused,
                      edgeState: city.edgeState()};

    const trial = createHeadlessCity(JSON.parse(saveText) as CitySave, {paused: false});
    trial.step();
    trial.moveSprites(1);
    trial.updateExplosions();
    trial.saveText();
    return prepared;
  } catch (error) {
    throw new SaveError('simulation');
  }
}
