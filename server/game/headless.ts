/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { TOOL_TEXTS } from '../../src/apiErrors.js';
import { BaseTool } from '../../src/baseTool.js';
import type { BlockMap } from '../../src/blockMap';
import { GameMap } from '../../src/gameMap.js';
import { GameTools } from '../../src/gameTools.js';
import * as Messages from '../../src/messages';
import { Neighbours } from '../../src/neighbours.js';
import { Ordinances } from '../../src/ordinances.js';
import { Placements } from '../../src/placements.js';
import { Simulation } from '../../src/simulation.js';
import { BIT_MASK } from '../../src/tileFlags';
import { TileUtils } from '../../src/tileUtils.js';
import { LASTTINYEXP, TINYEXP } from '../../src/tileValues';

// A shared city, simulated by the server with the game's own code: a GameMap of 120x100 tiles, a Simulation and the
// tools, made from a save as the game makes them when it opens a city (see Game and SplashScreen). The game's own
// settings of the city (its name, the milestones it reached, the automatic bulldozer, the disasters, the day and night)
// are kept here, as the game keeps them; the global setting of the tools (BaseTool.load/save) is never touched, and
// the automatic bulldozer is set to the city's before anything acts on the city.
//
// The city is driven from outside (see the rooms): a step of the simulation at the speed's interval, the sprites moved
// 60 times a second, the explosions turned to rubble, and the players' commands. Nothing waits for a player: the
// yearly budget is confirmed at once with the city's current figures. The speed (1 to 3) is kept apart from the
// pause: a paused city neither steps nor moves its sprites, and its clock stands still. All of it is synchronous.
//
// Several cities can live in one process: each object has its own listeners (see EventEmitter). With options.random,
// the city draws its random numbers from its own generator: Math.random is that generator while the city acts.

export const CITY_WIDTH = 120;
export const CITY_HEIGHT = 100;

// The version of the saves this city writes, as the game does (see Storage)
export const SAVE_VERSION = 4;

// How often the sprites move: 60 times a second, as in the game (see Game)
export const SPRITE_STEP_MS = 1000 / 60;

// How long an explosion lasts before it leaves rubble, in milliseconds of the city's clock: as long as the game's
// animation of it (eight frames of 50 ms, see AnimationManager). The clock counts sprite moves: 24 of them.
export const EXPLOSION_MS = 400;
const EXPLOSION_MOVES = Math.round(EXPLOSION_MS * 60 / 1000);

// The most messages kept for the room between two calls of takeMessages: older ones go first
const MAX_MESSAGES = 200;

// The most loans the budget window takes at once (see Budget.MAX_DEBT)
export const MAX_LOANS = 5;

// The disasters a player can unleash, as the disaster window names them (see DisasterWindow)
export const DISASTER_KINDS = ['Monster', 'Fire', 'Flood', 'Crash', 'Meltdown', 'Tornado', 'Earthquake'] as const;
export type DisasterKind = typeof DISASTER_KINDS[number];

// The milestones of a city: whether it already became a town, a city... (the game congratulates the mayor once)
export const MILESTONE_KEYS = ['_reachedTown', '_reachedCity', '_reachedCapital', '_reachedMetropolis',
                               '_reachedMegalopolis'] as const;
export type MilestoneKey = typeof MILESTONE_KEYS[number];

const MILESTONE_OF: Readonly<Record<string, MilestoneKey>> = {
  [Messages.REACHED_TOWN]: '_reachedTown',
  [Messages.REACHED_CITY]: '_reachedCity',
  [Messages.REACHED_CAPITAL]: '_reachedCapital',
  [Messages.REACHED_METROPOLIS]: '_reachedMetropolis',
  [Messages.REACHED_MEGALOPOLIS]: '_reachedMegalopolis',
};

// Why a tool could not be applied everywhere it was dragged (the codes of src/apiErrors.js)
export type ToolReason = keyof typeof TOOL_TEXTS;

export interface Point {
  x: number;
  y: number;
}

// A save, as in a .kawacity file (see Game.getSaveData)
export type CitySave = Record<string, unknown>;

// What a city tells its players: a FRONT_END_MESSAGE of the simulation, its data's live sprite replaced by the
// sprite's id (spriteId)
export interface CityMessage {
  subject: string;
  data?: Record<string, number | boolean | string>;
}

export interface StepResult {
  // Whether the simulation stepped (not when paused)
  stepped: boolean;
  // Whether the yearly budget was confirmed for the mayor, as the city's automatic budget was off (or ran short)
  budgetApplied: boolean;
}

export interface ToolOutcome {
  // How many of the placements were applied, and how many not
  applied: number;
  failed: number;
  // Why some were not: the first failure, or no_money when the money ran out (which stops the drag); null if none
  reason: ToolReason | null;
  // What it cost
  cost: number;
  // Where the tool was applied, in order (see Placements)
  placements: Point[];
}

export interface BudgetValues {
  roadPercent: unknown;
  firePercent: unknown;
  policePercent: unknown;
  taxPercent: unknown;
}

export interface CitySettings {
  autoBudget?: unknown;
  autoBulldoze?: unknown;
  disasters?: unknown;
  level?: unknown;
}

export interface HeadlessCityOptions {
  // The city's own random numbers (between 0 and 1, as Math.random), for everything it does
  random?: () => number;
  // Whether the city starts paused (else as the save says: a save with a speed of 0 was paused)
  paused?: boolean;
}

// The edge of the city facing a neighbour, for the player's city beyond it (see Neighbours.edgeState)
export interface EdgeState {
  transport: boolean;
  power: boolean;
  powerOut: boolean;
  signed: Record<string, boolean>;
}

// What the city uses of the game's objects (they come from JavaScript modules)

export interface TileObject {
  getValue(): number;
  getRawValue(): number;
  set(value: number, flags: number): void;
}

export interface CityMap {
  readonly width: number;
  readonly height: number;
  _data: TileObject[];
  _roadClass: Uint8Array;
  getTile(x: number, y: number): TileObject;
  getTileValue(x: number, y: number): number;
  setTo(x: number, y: number, tile: TileObject): void;
  getRoadClass(x: number, y: number): number;
}

export interface SpriteObject {
  id: number;
  type: number;
  frame: number;
  x: number;
  y: number;
}

interface SpriteManagerObject {
  spriteList: SpriteObject[];
  moveObjects(simData: unknown): void;
  makeMonster(): void;
  makeTornado(): void;
}

export interface BudgetObject {
  [field: string]: unknown;
  totalFunds: number;
  autoBudget: boolean;
  awaitingValues: boolean;
  roadPercent: number;
  firePercent: number;
  policePercent: number;
  cityTax: number;
  setTax(tax: number): void;
  setAutoBudget(value: boolean): void;
  updateFundEffects(): void;
  doBudgetWindow(): void;
  borrow(count: number): number;
  repay(): boolean;
  setOrdinances(mask: number): void;
}

export interface EvaluationObject {
  [field: string]: unknown;
  cityPop: number;
  cityClass: string;
  cityClassLast: string;
  cityScore: number;
  problemVotes: {index: number; voteCount: number}[];
  problemOrder: (number | null)[];
  computePopulation(census: CensusObject): number;
  classify(population: number): string;
}

export interface CensusObject {
  [field: string]: unknown;
  resPop: number;
  comPop: number;
  indPop: number;
  totalPop: number;
}

interface ValvesObject {
  resValve: number;
  comValve: number;
  indValve: number;
}

interface DisasterManagerObject {
  disastersEnabled: boolean;
  makeFire(): void;
  makeFlood(): void;
  makeCrash(): void;
  makeMeltdown(): void;
  makeEarthquake(): void;
}

export interface NeighboursObject {
  _links: unknown;
  _random: () => number;
  setDeal(side: string, kind: string, signed: boolean): void;
  describe(): unknown[];
  edgeState(): Record<string, EdgeState>;
  setRemote(side: string, remote: unknown): void;
  getRemote(side: string): unknown;
  clearDeals(side: string): void;
  restoreDelivered(edges: unknown): void;
}

type Listener = (value: never) => void;

export interface SimulationObject {
  budget: BudgetObject;
  evaluation: EvaluationObject;
  spriteManager: SpriteManagerObject;
  disasterManager: DisasterManagerObject;
  neighbours: NeighboursObject;
  blockMaps: Record<string, BlockMap>;
  _census: CensusObject;
  _valves: ValvesObject;
  _speed: number;
  _cityTime: number;
  step(): void;
  save(saveData: CitySave): void;
  setSpeed(speed: number): void;
  getStepInterval(): number;
  getLevel(): number;
  changeLevel(level: number): void;
  getCityTime(): number;
  getScenario(): {id: string; goal: string; scoreWait: number; ended?: boolean; won?: boolean} | null;
  getScenarioProgress(): {value: number; target: number; met: boolean} | null;
  getHistoryTime(): number;
  getCityStatus(): Record<string, unknown>;
  getDate(): {month: number; year: number};
  getPopulation(): number;
  _constructSimData(): unknown;
  addEventListener(event: string, listener: Listener): void;
}

interface ToolObject {
  result: number | null;
  TOOLRESULT_FAILED: number;
  TOOLRESULT_NO_MONEY: number;
  TOOLRESULT_NEEDS_BULLDOZE: number;
  doTool(x: number, y: number, blockMaps: unknown): void;
  modifyIfEnoughFunding(budget: unknown): boolean;
  clear(): void;
  startBatch?(count: number): void;
  endBatch?(): void;
}

// The game's modules, as the city uses them
const SimulationClass = Simulation as unknown as {
  new (map: CityMap, level: number, speed: number, save: CitySave | null): SimulationObject;
  SPEED_PAUSED: number;
  SPEED_SLOW: number;
  SPEED_MED: number;
  SPEED_FAST: number;
  LEVEL_EASY: number;
  LEVEL_MED: number;
  LEVEL_HARD: number;
};
const GameMapClass = GameMap as unknown as new (width: number, height: number) => CityMap;
const makeTools = GameTools as unknown as new (map: CityMap) => Record<string, ToolObject>;
const randomRubble = TileUtils.randomRubble as () => TileObject;
const SIDES = Neighbours.SIDES as readonly string[];
const KINDS = Neighbours.KINDS as readonly string[];

const SPEEDS: readonly number[] = [SimulationClass.SPEED_SLOW, SimulationClass.SPEED_MED, SimulationClass.SPEED_FAST];
const LEVELS: readonly number[] = [SimulationClass.LEVEL_EASY, SimulationClass.LEVEL_MED, SimulationClass.LEVEL_HARD];

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isIntegerIn = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

// The data of a message, sendable: its numbers, booleans and strings, and the id of its sprite instead of the sprite
const messageData = (data: unknown): Record<string, number | boolean | string> | undefined => {
  if (!isObject(data))
    return undefined;

  const result: Record<string, number | boolean | string> = {};
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (key === 'sprite') {
      if (isObject(value) && Number.isInteger(value.id))
        result.spriteId = value.id as number;
    } else if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean' ||
               typeof value === 'string') {
      result[key] = value;
    }
  }

  return result;
};

export class HeadlessCity {
  readonly map: CityMap;
  readonly simulation: SimulationObject;
  readonly tools: Record<string, ToolObject>;

  // The game's settings of the city (see Game): its name, the milestones, the automatic bulldozer, the day and night
  name: string;
  readonly milestones: Record<MilestoneKey, boolean>;
  autoBulldoze: boolean;
  dayNight: boolean;
  timeOfDay: number;

  // Whether the city is paused (its speed stays 1 to 3: see speed)
  paused: boolean;

  // The figures the game shows in its heads-up display, as their last events gave them (see InfoBar)
  readonly hud: {population: number; cityClass: string; score: number};

  private readonly random: (() => number) | null;
  private messages: CityMessage[] = [];
  // How many times the sprites moved: the city's clock
  private moves = 0;
  // The explosions on the map, by tile index: when they were first seen, by the city's clock (in moves)
  private explosions = new Map<number, number>();

  constructor(save: CitySave, options: HeadlessCityOptions = {}) {
    if (!isObject(save) || !Array.isArray(save.map) || save.map.length !== CITY_WIDTH * CITY_HEIGHT)
      throw new Error('not the save of a city');

    this.random = options.random ?? null;

    // The city's own copy, as the game makes when it opens a city: the census keeps the save's histories
    const copy = JSON.parse(JSON.stringify(save)) as CitySave;

    this.name = typeof copy.name === 'string' && copy.name !== '' ? copy.name : 'MyTown';
    this.milestones = {} as Record<MilestoneKey, boolean>;
    for (const key of MILESTONE_KEYS)
      this.milestones[key] = !!copy[key];
    this.autoBulldoze = typeof copy.autoBulldoze === 'boolean' ? copy.autoBulldoze : true;
    this.dayNight = typeof copy.dayNight === 'boolean' ? copy.dayNight : true;
    this.timeOfDay = typeof copy.timeOfDay === 'number' && Number.isFinite(copy.timeOfDay) ?
                     ((copy.timeOfDay % 1) + 1) % 1 : 0.2;

    // As the game opens a saved city: a map of 120x100 tiles, then the simulation, made at the save's level and the
    // medium speed, which loads the save
    const map = new GameMapClass(CITY_WIDTH, CITY_HEIGHT);
    const level = (copy._gameLevel || SimulationClass.LEVEL_EASY) as number;
    this.map = map;
    this.simulation = this.act(() => new SimulationClass(map, level, SimulationClass.SPEED_MED, copy));
    this.tools = new makeTools(map);

    const simulation = this.simulation;
    if (typeof copy.disastersEnabled === 'boolean')
      simulation.disasterManager.disastersEnabled = copy.disastersEnabled;

    // A city saved while paused (at speed 0) runs at the medium speed when it resumes
    const savedSpeed = simulation._speed;
    simulation.setSpeed(SPEEDS.includes(savedSpeed) ? savedSpeed : SimulationClass.SPEED_MED);
    this.paused = options.paused === undefined ? savedSpeed === SimulationClass.SPEED_PAUSED : !!options.paused;

    this.hud = {population: simulation.evaluation.cityPop, cityClass: simulation.evaluation.cityClass,
                score: simulation.evaluation.cityScore};
    simulation.addEventListener(Messages.POPULATION_UPDATED, (v: number) => { this.hud.population = v; });
    simulation.addEventListener(Messages.CLASSIFICATION_UPDATED, (v: string) => { this.hud.cityClass = v; });
    simulation.addEventListener(Messages.SCORE_UPDATED, (v: number) => { this.hud.score = v; });
    simulation.addEventListener(Messages.FRONT_END_MESSAGE, (m: unknown) => this.onMessage(m));
  }

  // Runs what acts on the city: with the city's automatic bulldozer, and its random numbers
  private act<T>(fn: () => T): T {
    BaseTool.setAutoBulldoze(this.autoBulldoze);
    if (this.random === null)
      return fn();

    const random = Math.random;
    Math.random = this.random;
    try {
      return fn();
    } finally {
      Math.random = random;
    }
  }

  private onMessage(message: unknown): void {
    if (!isObject(message) || typeof message.subject !== 'string')
      return;

    // Each milestone is told once in the city's life
    const subject = message.subject;
    if (Object.hasOwn(MILESTONE_OF, subject)) {
      const key = MILESTONE_OF[subject];
      if (this.milestones[key])
        return;
      this.milestones[key] = true;
    }

    const data = messageData(message.data);
    this.messages.push(data === undefined ? {subject} : {subject, data});
    if (this.messages.length > MAX_MESSAGES)
      this.messages.shift();
  }

  // The figures a save carries that its map decides: the population (the census's, and the evaluation's) and the
  // city's class. A save the server is given may claim anything there (and a claimed population would be taxed): they
  // are worked out again from the map, as the simulation counted it when the city opened (see Simulation.init), with
  // the game's formulas (see Valves.setValves and Evaluation.getPopulation).
  recount(): void {
    const {_census: census, evaluation} = this.simulation;
    census.totalPop = Math.round(census.resPop / 8 + census.comPop + census.indPop);
    evaluation.cityPop = evaluation.computePopulation(census);
    evaluation.cityClass = evaluation.cityClassLast = evaluation.classify(evaluation.cityPop);
    this.hud.population = evaluation.cityPop;
    this.hud.cityClass = evaluation.cityClass;
  }

  // The messages since the last call, oldest first
  takeMessages(): CityMessage[] {
    const messages = this.messages;
    this.messages = [];
    return messages;
  }

  // The speed the city runs at, 1 to 3 (also while paused)
  get speed(): number {
    return this.simulation._speed;
  }

  // How often the city steps at its speed, in milliseconds
  stepInterval(): number {
    return this.simulation.getStepInterval();
  }

  // The population as the game shows it (see hud)
  get population(): number {
    return this.hud.population;
  }

  // The score as the game shows it (see hud)
  get score(): number {
    return this.hud.score;
  }

  get cityTime(): number {
    return this.simulation.getCityTime();
  }

  // How long the city has run, unpaused, in milliseconds: SPRITE_STEP_MS for each move of the sprites
  get clock(): number {
    return this.moves * SPRITE_STEP_MS;
  }

  // One step of the simulation (nothing while paused). The yearly budget the mayor would be asked for is confirmed
  // at once, as it stands: the city never waits.
  step(): StepResult {
    if (this.paused)
      return {stepped: false, budgetApplied: false};

    return this.act(() => {
      const simulation = this.simulation;
      simulation.step();

      if (!simulation.budget.awaitingValues)
        return {stepped: true, budgetApplied: false};

      simulation.budget.doBudgetWindow();
      return {stepped: true, budgetApplied: true};
    });
  }

  // Moves the sprites, as many times as asked (nothing while paused); the city's clock goes on by as much
  moveSprites(moves = 1): void {
    const count = Number.isInteger(moves) && moves > 0 ? moves : 0;
    if (this.paused || count === 0)
      return;

    this.act(() => {
      const spriteManager = this.simulation.spriteManager;
      for (let i = 0; i < count; i++)
        spriteManager.moveObjects(this.simulation._constructSimData());
    });
    this.moves += count;
  }

  // Leaves rubble where explosions have lasted long enough: each explosion tile is noted when first seen, and becomes
  // rubble once EXPLOSION_MS of the city's clock have passed, if it is still an explosion then (as the game's animation
  // does it on screen). Returns how many tiles became rubble.
  updateExplosions(): number {
    const data = this.map._data;
    const seen = new Map<number, number>();
    const done: number[] = [];

    for (let i = 0, l = data.length; i < l; i++) {
      const value = data[i].getRawValue() & BIT_MASK;
      if (value < TINYEXP || value > LASTTINYEXP)
        continue;

      const since = this.explosions.get(i) ?? this.moves;
      if (this.moves - since >= EXPLOSION_MOVES)
        done.push(i);
      else
        seen.set(i, since);
    }

    this.explosions = seen;
    if (done.length > 0) {
      this.act(() => {
        for (const i of done)
          this.map.setTo(i % CITY_WIDTH, Math.floor(i / CITY_WIDTH), randomRubble());
      });
    }

    return done.length;
  }

  // Where a tool would act for a drag from one tile to another, or null when the tool is not one a player may use, or
  // a tile is not a tile of the map: checked before anything is worked out
  placementsFor(toolName: unknown, from: unknown, to: unknown): Point[] | null {
    const anchor = this.tileOf(from);
    const current = this.tileOf(to);
    if (!Placements.isApplicable(toolName) || anchor === null || current === null)
      return null;

    return Placements.computePlacements(toolName as string, anchor, current, {width: CITY_WIDTH, height: CITY_HEIGHT});
  }

  private tileOf(value: unknown): Point | null {
    if (!isObject(value) || !Object.hasOwn(value, 'x') || !Object.hasOwn(value, 'y'))
      return null;

    const {x, y} = value;
    return isIntegerIn(x, 0, CITY_WIDTH - 1) && isIntegerIn(y, 0, CITY_HEIGHT - 1) ? {x, y} : null;
  }

  // Applies a tool for a drag from one tile to another, as the game does (see Game.handleTool): each placement in
  // turn, while there is money. null when the input is not valid (see placementsFor): nothing is done.
  applyTool(toolName: unknown, from: unknown, to: unknown): ToolOutcome | null {
    const placements = this.placementsFor(toolName, from, to);
    if (placements === null || !Object.hasOwn(this.tools, toolName as string))
      return null;

    const tool = this.tools[toolName as string];
    const budget = this.simulation.budget;
    const blockMaps = this.simulation.blockMaps;
    const fundsBefore = budget.totalFunds;
    let applied = 0;
    let failure: number | null = null;

    this.act(() => {
      try {
        tool.startBatch?.(placements.length);
        for (const p of placements) {
          tool.doTool(p.x, p.y, blockMaps);
          if (tool.modifyIfEnoughFunding(budget)) {
            applied++;
            continue;
          }

          if (tool.result === tool.TOOLRESULT_NO_MONEY) {
            failure = tool.result;
            break;
          }

          if (failure === null)
            failure = tool.result;
        }
      } finally {
        // Nothing half done is left for the next command, even if a placement went wrong
        tool.clear();
        tool.endBatch?.();
      }
    });

    let reason: ToolReason | null = null;
    if (failure === tool.TOOLRESULT_NO_MONEY)
      reason = 'no_money';
    else if (failure === tool.TOOLRESULT_NEEDS_BULLDOZE)
      reason = 'needs_bulldoze';
    else if (failure !== null)
      reason = 'failed';

    return {applied, failed: placements.length - applied, reason, cost: fundsBefore - budget.totalFunds, placements};
  }

  // The budget, as the budget window sets it (see Game.handleBudgetWindowClosure): the percents of the services' needs
  // funded, 0 to 100, and the tax, 0 to 20. Returns false, and changes nothing, unless all four are such integers.
  applyBudget(values: BudgetValues): boolean {
    if (!isObject(values))
      return false;

    const {roadPercent, firePercent, policePercent, taxPercent} = values;
    if (!isIntegerIn(roadPercent, 0, 100) || !isIntegerIn(firePercent, 0, 100) || !isIntegerIn(policePercent, 0, 100) ||
        !isIntegerIn(taxPercent, 0, 20))
      return false;

    const budget = this.simulation.budget;
    budget.roadPercent = roadPercent / 100;
    budget.firePercent = firePercent / 100;
    budget.policePercent = policePercent / 100;
    budget.setTax(taxPercent);
    budget.updateFundEffects();
    return true;
  }

  // Some of the city's settings, as the settings window sets them (see Game.handleSettingsWindowClosure): booleans,
  // and the level 0 to 2. Returns false, and changes nothing, if one is not valid.
  applySettings(settings: CitySettings): boolean {
    if (!isObject(settings))
      return false;

    const {autoBudget, autoBulldoze, disasters, level} = settings;
    const flag = (value: unknown) => value === undefined || typeof value === 'boolean';
    if (!flag(autoBudget) || !flag(autoBulldoze) || !flag(disasters) || (level !== undefined && !LEVELS.includes(level as number)))
      return false;

    const simulation = this.simulation;
    if (typeof autoBudget === 'boolean')
      simulation.budget.setAutoBudget(autoBudget);
    if (typeof autoBulldoze === 'boolean')
      this.autoBulldoze = autoBulldoze;
    if (typeof disasters === 'boolean')
      simulation.disasterManager.disastersEnabled = disasters;
    if (level !== undefined)
      simulation.changeLevel(level as number);
    return true;
  }

  // Runs the city at a speed, 1 to 3, and resumes it if it was paused
  applySpeed(speed: unknown): boolean {
    if (!SPEEDS.includes(speed as number))
      return false;

    this.simulation.setSpeed(speed as number);
    this.paused = false;
    return true;
  }

  applyPaused(paused: unknown): boolean {
    if (typeof paused !== 'boolean')
      return false;

    this.paused = paused;
    return true;
  }

  // A disaster, as the disaster window unleashes it (see Game.handleDisasterWindowClosure)
  applyDisaster(kind: unknown): boolean {
    if (!DISASTER_KINDS.includes(kind as DisasterKind))
      return false;

    const simulation = this.simulation;
    this.act(() => {
      switch (kind as DisasterKind) {
        case 'Monster':
          simulation.spriteManager.makeMonster();
          break;

        case 'Fire':
          simulation.disasterManager.makeFire();
          break;

        case 'Flood':
          simulation.disasterManager.makeFlood();
          break;

        case 'Crash':
          simulation.disasterManager.makeCrash();
          break;

        case 'Meltdown':
          simulation.disasterManager.makeMeltdown();
          break;

        case 'Tornado':
          simulation.spriteManager.makeTornado();
          break;

        case 'Earthquake':
          simulation.disasterManager.makeEarthquake();
          break;
      }
    });
    return true;
  }

  // Signs or ends a deal with a neighbour (see Neighbours.setDeal)
  // The loans of the budget window (see Budget.borrow and Budget.repay): the whole debt repaid, then count loans taken.
  // Returns false, and changes nothing, if the values are not valid or the debt can't be repaid.
  applyLoan(borrow: unknown, repay: unknown): boolean {
    if (!isIntegerIn(borrow, 0, MAX_LOANS) || typeof repay !== 'boolean')
      return false;

    const budget = this.simulation.budget;
    if (repay && !budget.repay())
      return false;

    budget.borrow(borrow as number);
    return true;
  }

  // The ordinances in force, as the budget window sets them (see Ordinances): a mask of known ones only
  applyOrdinances(mask: unknown): boolean {
    if (!isIntegerIn(mask, 0, Ordinances.ALL) || (mask & Ordinances.ALL) !== mask)
      return false;

    this.simulation.budget.setOrdinances(mask);
    return true;
  }

  applyDeal(side: unknown, kind: unknown, signed: unknown): boolean {
    if (!SIDES.includes(side as string) || !KINDS.includes(kind as string) || typeof signed !== 'boolean')
      return false;

    this.simulation.neighbours.setDeal(side as string, kind as string, signed);
    return true;
  }

  // Calls a function of the neighbours that looks at the edges again, without the simulation seeing it: it goes on
  // with the links it found at its last scan of the power grid (the game's window of the neighbours does the same
  // when it opens; here it is only looked at, to tell the players)
  private lookAtNeighbours<T>(fn: (neighbours: NeighboursObject) => T): T {
    const neighbours = this.simulation.neighbours;
    const links = neighbours._links;
    try {
      return fn(neighbours);
    } finally {
      neighbours._links = links;
    }
  }

  // The neighbours, as the game's window shows them (see Neighbours.describe)
  describeNeighbours(): unknown[] {
    return this.lookAtNeighbours(neighbours => neighbours.describe());
  }

  // Takes back the power delivered at each edge from the edges stored with the save (see Neighbours.restoreDelivered)
  restoreEdges(edges: unknown): void {
    this.simulation.neighbours.restoreDelivered(edges);
  }

  // What the city has at each of its edges, for the players' cities beyond them (see Neighbours.edgeState)
  edgeState(): Record<string, EdgeState> {
    return this.lookAtNeighbours(neighbours => neighbours.edgeState());
  }

  // How the city is doing, for the news (see Simulation.getCityStatus), as an object of its own
  cityStatus(): Record<string, unknown> {
    return this.lookAtNeighbours(() => JSON.parse(JSON.stringify(this.simulation.getCityStatus())));
  }

  // The city's save, as the game writes it in a .kawacity file (see Game.getSaveData and Storage.exportGame), as text
  saveText(): string {
    const data: CitySave = {name: this.name};
    for (const key of MILESTONE_KEYS)
      data[key] = this.milestones[key];
    data.dayNight = this.dayNight;
    data.disastersEnabled = this.simulation.disasterManager.disastersEnabled;
    data.timeOfDay = this.timeOfDay;
    data.autoBulldoze = this.autoBulldoze;
    this.simulation.save(data);
    data.version = SAVE_VERSION;
    return JSON.stringify(data);
  }

  // The same save, as an object of its own
  save(): CitySave {
    return JSON.parse(this.saveText()) as CitySave;
  }
}

// A city made from a save (see HeadlessCity)
export function createHeadlessCity(save: CitySave, options: HeadlessCityOptions = {}): HeadlessCity {
  return new HeadlessCity(save, options);
}
