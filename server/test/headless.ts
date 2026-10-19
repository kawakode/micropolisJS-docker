/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { BaseTool } from '../../src/baseTool.js';
import { DisasterWindow } from '../../src/disasterWindow.js';
import { GameMap } from '../../src/gameMap.js';
import { GameTools } from '../../src/gameTools.js';
import * as Messages from '../../src/messages';
import { Placements } from '../../src/placements.js';
import { Simulation } from '../../src/simulation.js';
import { SPRITE_AIRPLANE, SPRITE_MONSTER, SPRITE_TORNADO } from '../../src/spriteConstants';
import { Storage } from '../../src/storage.js';
import { Tile } from '../../src/tile';
import { ALLBITS, ANIMBIT, BIT_MASK, BULLBIT } from '../../src/tileFlags';
import * as TileValues from '../../src/tileValues';
import {
  CitySave, CityMessage, createHeadlessCity, DISASTER_KINDS, EXPLOSION_MS, HeadlessCity, MILESTONE_KEYS, Point,
  SPRITE_STEP_MS,
} from '../game/headless';
import { digest, sampleCity, seededRandom } from '../gameTesting';

// The tests of a shared city as the server runs it: made from a save as the game opens a city, stepped as the game
// steps it, and acted on by the players' commands.

const SimulationClass = Simulation as any;
const BaseToolObject = BaseTool as any;

// An untouched landscape, as the game starts one (see Scenarios.loadCity)
const emptyLand = (): CitySave => sampleCity('finnigan', {cityTime: 0, funds: 20000});

// The game, alone in its page with the city, as it opens a save (see Game and SplashScreen.launch) and runs it: a step
// at each tick, the yearly budget confirmed as soon as the window asks for it, and the sprites moved by the frame loop
const referenceGame = (save: CitySave, random: () => number) => {
  const act = <T>(fn: () => T): T => {
    const saved = Math.random;
    Math.random = random;
    try {
      return fn();
    } finally {
      Math.random = saved;
    }
  };

  const copy = JSON.parse(JSON.stringify(save));
  const map = new (GameMap as any)(120, 100);
  const simulation = act(() => new SimulationClass(map, copy._gameLevel || SimulationClass.LEVEL_EASY,
                                                    SimulationClass.SPEED_MED, copy));
  const name = copy.name || 'MyTown';
  const milestones = MILESTONE_KEYS.map(key => !!copy[key]);
  const previous = BaseToolObject.getAutoBulldoze();
  BaseToolObject.load(copy);
  const autoBulldoze = BaseToolObject.getAutoBulldoze();
  BaseToolObject.setAutoBulldoze(previous);
  if (simulation.isPaused())
    simulation.setSpeed(SimulationClass.SPEED_MED);
  if (typeof copy.disastersEnabled === 'boolean')
    simulation.disasterManager.disastersEnabled = copy.disastersEnabled;
  const tools = new (GameTools as any)(map);

  return {
    map,
    simulation,
    step(): void {
      act(() => {
        simulation.step();
        if (simulation.budget.awaitingValues)
          simulation.budget.doBudgetWindow();
      });
    },
    moveSprites(count: number): void {
      act(() => {
        for (let i = 0; i < count; i++)
          simulation.spriteManager.moveObjects(simulation._constructSimData());
      });
    },
    // As Game.handleTool, for the placements InputStatus gives
    applyTool(toolName: string, from: Point, to: Point): void {
      const tool = tools[toolName];
      const placements = Placements.computePlacements(toolName, from, to, map);
      BaseToolObject.setAutoBulldoze(autoBulldoze);
      act(() => {
        if (tool.startBatch)
          tool.startBatch();
        for (const p of placements) {
          tool.doTool(p.x, p.y, simulation.blockMaps);
          if (tool.modifyIfEnoughFunding(simulation.budget))
            continue;
          if (tool.result === tool.TOOLRESULT_NO_MONEY)
            break;
        }
        if (tool.endBatch)
          tool.endBatch();
      });
    },
    // As Game.getSaveData, then Storage.exportGame
    saveText(): string {
      const saveData: any = {name};
      MILESTONE_KEYS.forEach((key, i) => { saveData[key] = milestones[i]; });
      saveData.dayNight = typeof copy.dayNight === 'boolean' ? copy.dayNight : true;
      saveData.disastersEnabled = simulation.disasterManager.disastersEnabled;
      saveData.timeOfDay = typeof copy.timeOfDay === 'number' ? ((copy.timeOfDay % 1) + 1) % 1 : 0.2;
      const global = BaseToolObject.getAutoBulldoze();
      BaseToolObject.setAutoBulldoze(autoBulldoze);
      BaseToolObject.save(saveData);
      BaseToolObject.setAutoBulldoze(global);
      simulation.save(saveData);
      return (Storage as any).exportGame(saveData);
    },
  };
};

const tileValue = (city: HeadlessCity, x: number, y: number): number => city.map.getTileValue(x, y);

const rawTiles = (city: {map: {_data: {getRawValue(): number}[]}}): number[] =>
  city.map._data.map(tile => tile.getRawValue());

// The top left of a rectangle of bare land
const findDirt = (city: HeadlessCity, width: number, height: number): Point => {
  for (let y = 2; y + height < 98; y++) {
    for (let x = 2; x + width < 118; x++) {
      let bare = true;
      for (let dy = 0; dy < height && bare; dy++) {
        for (let dx = 0; dx < width && bare; dx++)
          bare = city.map._data[(x + dx) + (y + dy) * 120].getRawValue() === TileValues.DIRT;
      }
      if (bare)
        return {x, y};
    }
  }
  throw new Error('no bare land');
};

const subjects = (messages: CityMessage[]): string[] => messages.map(message => message.subject);

const isRoad = (value: number) => value >= TileValues.ROADBASE && value <= TileValues.LASTROAD;

let autoBulldoze: boolean;

beforeEach(() => {
  autoBulldoze = BaseToolObject.getAutoBulldoze();
});

afterEach(() => {
  BaseToolObject.setAutoBulldoze(autoBulldoze);
  jest.restoreAllMocks();
});


describe('A headless city', () => {
  test('opens a save and runs it exactly as the game does', () => {
    // At the medium speed, and at the fast one (the scans run at other intervals)
    for (const [name, speed] of [['kowloon', 2], ['haight', 3]] as const) {
      const save = sampleCity(name);
      const city = createHeadlessCity(save, {random: seededRandom(5)});
      const game = referenceGame(save, seededRandom(5));
      expect(city.saveText()).toBe(game.saveText());

      expect(city.applySpeed(speed)).toBe(true);
      game.simulation.setSpeed(speed);

      // Without the automatic budget, the mayor confirms the budget each year
      expect(city.applySettings({autoBudget: false})).toBe(true);
      game.simulation.budget.setAutoBudget(false);

      let budgets = 0;
      for (let i = 0; i < 16 * 60; i++) {
        if (i === 100) {
          city.applyTool('bulldozer5', {x: 40, y: 40}, {x: 50, y: 44});
          game.applyTool('bulldozer5', {x: 40, y: 40}, {x: 50, y: 44});
        }

        if (city.step().budgetApplied)
          budgets++;
        city.moveSprites(2);
        game.step();
        game.moveSprites(2);
      }

      expect(budgets).toBeGreaterThanOrEqual(1);
      expect(city.simulation.budget.awaitingValues).toBe(false);
      expect(city.saveText()).toBe(game.saveText());
    }
  });

  test('keeps the settings the game keeps for a city', () => {
    const save = {...emptyLand(), name: 'Lyon', _reachedTown: true, _reachedCity: 1, _reachedCapital: false,
                  autoBulldoze: false, disastersEnabled: false, dayNight: false, timeOfDay: 1.25};
    const city = createHeadlessCity(save);
    expect(city.name).toBe('Lyon');
    expect(city.milestones).toEqual({_reachedTown: true, _reachedCity: true, _reachedCapital: false,
                                     _reachedMetropolis: false, _reachedMegalopolis: false});
    expect(city.autoBulldoze).toBe(false);
    expect(city.simulation.disasterManager.disastersEnabled).toBe(false);
    expect(city.dayNight).toBe(false);
    expect(city.timeOfDay).toBe(0.25);

    const saved = city.save();
    expect(saved).toMatchObject({name: 'Lyon', _reachedTown: true, _reachedCity: true, _reachedCapital: false,
                                 autoBulldoze: false, disastersEnabled: false, dayNight: false, timeOfDay: 0.25,
                                 version: 4});

    // The game's defaults, for a city file of the original game
    const plain = createHeadlessCity({...sampleCity('kowloon'), name: ''});
    expect([plain.name, plain.dayNight, plain.timeOfDay, plain.simulation.disasterManager.disastersEnabled])
      .toEqual(['MyTown', true, 0.2, true]);
  });

  test('never reads or writes the tools\' global setting through BaseTool.load or save', () => {
    const load = jest.spyOn(BaseToolObject, 'load');
    const save = jest.spyOn(BaseToolObject, 'save');

    BaseToolObject.setAutoBulldoze(true);
    const city = createHeadlessCity({...emptyLand(), autoBulldoze: false});
    expect(BaseToolObject.getAutoBulldoze()).toBe(false);
    BaseToolObject.setAutoBulldoze(true);
    city.step();
    expect(BaseToolObject.getAutoBulldoze()).toBe(false);
    city.saveText();

    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  test('refuses what is not a save', () => {
    for (const bad of [null, [], {}, {map: []}, {map: new Array(11999).fill({value: 0})}, 'save'])
      expect(() => createHeadlessCity(bad as any)).toThrow('not the save of a city');
  });

  test('keeps its speed apart from the pause', () => {
    const city = createHeadlessCity({...emptyLand(), _speed: 0});
    expect(city.paused).toBe(true);
    expect(city.speed).toBe(SimulationClass.SPEED_MED);
    expect(city.stepInterval()).toBe(50);

    const time = city.cityTime;
    for (let i = 0; i < 40; i++)
      expect(city.step()).toEqual({stepped: false, budgetApplied: false});
    city.moveSprites(10);
    expect([city.cityTime, city.clock]).toEqual([time, 0]);

    expect(city.applySpeed(SimulationClass.SPEED_FAST)).toBe(true);
    expect([city.paused, city.speed, city.stepInterval()]).toEqual([false, 3, 10]);
    for (let i = 0; i < 16; i++)
      expect(city.step().stepped).toBe(true);
    expect(city.cityTime).toBe(time + 1);
    city.moveSprites(3);
    expect(city.clock).toBeCloseTo(3 * SPRITE_STEP_MS);

    expect(city.applyPaused(true)).toBe(true);
    expect([city.paused, city.speed]).toEqual([true, 3]);
    // Saved with its speed: the pause is kept apart (in the database)
    expect(city.save()._speed).toBe(3);

    for (const bad of [0, 4, 1.5, '2', null, undefined, NaN])
      expect(city.applySpeed(bad)).toBe(false);
    for (const bad of [0, 1, 'true', null, undefined])
      expect(city.applyPaused(bad)).toBe(false);
    expect([city.paused, city.speed]).toEqual([true, 3]);

    expect(city.applySpeed(1)).toBe(true);
    expect([city.paused, city.speed, city.stepInterval()]).toEqual([false, 1, 100]);

    // A city saved running, started paused (as the database says), and the other way round
    expect(createHeadlessCity(emptyLand(), {paused: true}).paused).toBe(true);
    expect(createHeadlessCity({...emptyLand(), _speed: 0}, {paused: false}).paused).toBe(false);
    expect(createHeadlessCity({...emptyLand(), _speed: 3}).speed).toBe(3);
    // As a database column holds it
    expect(createHeadlessCity(emptyLand(), {paused: 1 as any}).paused).toBe(true);
    expect(createHeadlessCity({...emptyLand(), _speed: 0}, {paused: 0 as any}).paused).toBe(false);
  });
});


describe('The tools of a headless city', () => {
  test('lay what a drag lays, at its cost', () => {
    const city = createHeadlessCity(emptyLand(), {random: seededRandom(2)});
    const at = findDirt(city, 12, 3);
    const from = {x: at.x, y: at.y + 1};
    const to = {x: at.x + 9, y: at.y + 1};

    const outcome = city.applyTool('road', from, to);
    expect(outcome).toEqual({applied: 10, failed: 0, reason: null, cost: 100,
                             placements: Array.from({length: 10}, (_, i) => ({x: at.x + i, y: at.y + 1}))});
    for (let i = 0; i < 10; i++)
      expect(isRoad(tileValue(city, at.x + i, at.y + 1))).toBe(true);
    expect(city.simulation.budget.totalFunds).toBe(20000 - 100);

    // The same road again: nothing to do
    expect(city.applyTool('road', from, to)).toMatchObject({applied: 0, failed: 10, reason: 'failed', cost: 0});

    // An avenue over the road changes its class
    expect(city.applyTool('avenue', from, to)).toMatchObject({applied: 10, reason: null, cost: 250});
    expect(city.map.getRoadClass(at.x, at.y + 1)).toBe((GameMap as any).ROAD_AVENUE);
  });

  test('act as the game\'s tools do, random numbers included', () => {
    const save = sampleCity('kowloon');
    const city = createHeadlessCity(save, {random: seededRandom(9)});
    const game = referenceGame(save, seededRandom(9));
    const commands: [string, Point, Point][] = [
      ['bulldozer7', {x: 30, y: 30}, {x: 52, y: 41}], ['park', {x: 30, y: 30}, {x: 40, y: 35}],
      ['road', {x: 30, y: 36}, {x: 52, y: 40}], ['residential', {x: 41, y: 31}, {x: 50, y: 34}],
      ['wire', {x: 0, y: 50}, {x: 119, y: 99}], ['trees', {x: 60, y: 0}, {x: 119, y: 70}],
    ];
    for (const [tool, from, to] of commands) {
      city.applyTool(tool, from, to);
      game.applyTool(tool, from, to);
      expect(rawTiles(city)).toEqual(rawTiles(game));
      expect(city.simulation.budget.totalFunds).toBe(game.simulation.budget.totalFunds);
    }
    expect(city.saveText()).toBe(game.saveText());
  });

  test('check the tool and the tiles before working anything out', () => {
    const city = createHeadlessCity(emptyLand());
    const before = digest(city.saveText());
    const compute = jest.spyOn(Placements, 'computePlacements');
    const good = {x: 10, y: 10};
    const notTools = ['query', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'addEventListener',
                      '_emitEvent', 'bulldozer9', 'Road', '', 7, null, undefined, {}, ['road']];
    const inherited = Object.create({x: 3, y: 4});
    const notTiles = [null, undefined, 7, 'a', [3, 4], {x: 3}, {y: 4}, {x: 1.5, y: 2}, {x: -1, y: 0}, {x: 120, y: 0},
                      {x: 0, y: 100}, {x: '5', y: 5}, {x: NaN, y: 5}, {x: Infinity, y: 5}, {x: 1e15, y: 5},
                      {x: 5, y: -1e15}, inherited];

    for (const tool of notTools) {
      expect(city.applyTool(tool, good, good)).toBeNull();
      expect(city.placementsFor(tool, good, good)).toBeNull();
    }
    for (const tile of notTiles) {
      expect(city.applyTool('bulldozer', tile, good)).toBeNull();
      expect(city.applyTool('road', good, tile)).toBeNull();
    }

    expect(compute).not.toHaveBeenCalled();
    expect(digest(city.saveText())).toBe(before);
  });

  test('are those of the allow-list: every tool of the game that changes the map', () => {
    const city = createHeadlessCity(emptyLand());
    const names = Object.keys(city.tools).filter(name => typeof city.tools[name].doTool === 'function');
    expect(Placements.TOOL_NAMES).toEqual(names.filter(name => name !== 'query').sort());

    for (const name of Placements.TOOL_NAMES)
      expect(city.applyTool(name, {x: 60, y: 50}, {x: 61, y: 51})).not.toBeNull();
  });

  test('stop when the money runs out', () => {
    const city = createHeadlessCity(emptyLand());
    const at = findDirt(city, 10, 1);
    city.simulation.budget.totalFunds = 25;

    expect(city.applyTool('road', at, {x: at.x + 9, y: at.y}))
      .toMatchObject({applied: 2, failed: 8, reason: 'no_money', cost: 20});
    expect(city.simulation.budget.totalFunds).toBe(5);
    expect(isRoad(tileValue(city, at.x + 2, at.y))).toBe(false);
  });

  test('bulldoze automatically as the city\'s setting says, whatever the global setting was', () => {
    const city = createHeadlessCity({...emptyLand(), autoBulldoze: false});
    let tree: Point | null = null;
    for (let i = 0; i < 12000 && tree === null; i++) {
      const tile = city.map._data[i];
      const value = tile.getValue();
      if (value >= TileValues.WOODS_LOW && value <= TileValues.WOODS_HIGH && (tile.getRawValue() & BULLBIT))
        tree = {x: i % 120, y: Math.floor(i / 120)};
    }
    if (tree === null)
      throw new Error('no tree');

    BaseToolObject.setAutoBulldoze(true);
    expect(city.applyTool('road', tree, tree)).toMatchObject({applied: 0, failed: 1, reason: 'needs_bulldoze'});
    expect(BaseToolObject.getAutoBulldoze()).toBe(false);

    expect(city.applySettings({autoBulldoze: true})).toBe(true);
    BaseToolObject.setAutoBulldoze(false);
    // A dollar to clear the tree, ten for the road
    expect(city.applyTool('road', tree, tree)).toMatchObject({applied: 1, failed: 0, reason: null, cost: 11});
    expect(isRoad(tileValue(city, tree.x, tree.y))).toBe(true);
  });

  test('leave nothing half done when a placement goes wrong', () => {
    const city = createHeadlessCity(sampleCity('kowloon'));
    const bulldozer = city.tools.bulldozer as any;
    const doTool = bulldozer.doTool;
    let calls = 0;
    jest.spyOn(bulldozer, 'doTool').mockImplementation(function(this: any, ...args: any[]) {
      if (++calls === 3)
        throw new Error('boom');
      return doTool.apply(this, args);
    });

    expect(() => city.applyTool('bulldozer', {x: 40, y: 40}, {x: 50, y: 40})).toThrow('boom');
    expect(bulldozer._applicationCost).toBe(0);
    expect(Object.keys(bulldozer._worldEffects._data)).toEqual([]);
    expect(bulldozer._demolished).toBeNull();
  });

  test('give at most a drag\'s worth of placements', () => {
    const city = createHeadlessCity(emptyLand());
    expect(city.applyTool('bulldozer7', {x: 10, y: 10}, {x: 119, y: 99})?.placements.length).toBe(4096);
    expect(city.applyTool('residential', {x: 1, y: 1}, {x: 119, y: 99})?.placements.length).toBe(100);
    expect(city.applyTool('rail', {x: 0, y: 0}, {x: 119, y: 99})?.placements.length).toBe(219);
  });
});


describe('The commands of a headless city', () => {
  test('set the budget as the budget window does', () => {
    const city = createHeadlessCity(sampleCity('kowloon'));
    const budget = city.simulation.budget;
    budget.roadMaintenanceBudget = 1000;
    budget.fireMaintenanceBudget = 400;
    budget.policeMaintenanceBudget = 300;

    expect(city.applyBudget({roadPercent: 50, firePercent: 100, policePercent: 0, taxPercent: 9})).toBe(true);
    expect([budget.roadPercent, budget.firePercent, budget.policePercent, budget.cityTax]).toEqual([0.5, 1, 0, 9]);
    expect([budget.roadSpend, budget.fireSpend, budget.policeSpend]).toEqual([500, 400, 0]);
    expect([budget.roadEffect, budget.fireEffect, budget.policeEffect]).toEqual([16, 1000, 0]);

    const before = JSON.stringify(budget);
    const valid = {roadPercent: 10, firePercent: 10, policePercent: 10, taxPercent: 10};
    for (const [key, value] of [['roadPercent', 101], ['firePercent', -1], ['policePercent', 1.5],
                                ['taxPercent', 21], ['taxPercent', '7'], ['roadPercent', undefined],
                                ['firePercent', null], ['taxPercent', NaN]] as const)
      expect(city.applyBudget({...valid, [key]: value})).toBe(false);
    expect(city.applyBudget(null as any)).toBe(false);
    expect(JSON.stringify(budget)).toBe(before);
  });

  test('take loans and pay off the debt, as the budget window does', () => {
    const city = createHeadlessCity(sampleCity('kowloon'));
    const budget = city.simulation.budget;
    budget.totalFunds = 1000;

    expect(city.applyLoan(2, false)).toBe(true);
    expect([budget.totalFunds, budget.debt, budget.debtPayment]).toEqual([21000, 24000, 2400]);
    // Not enough money to pay off the debt: nothing changes
    expect(city.applyLoan(1, true)).toBe(false);
    expect(budget.debt).toBe(24000);

    for (const [borrow, repay] of [[6, false], [-1, false], [1.5, false], ['1', false], [1, 'yes']] as const)
      expect(city.applyLoan(borrow, repay)).toBe(false);

    budget.totalFunds = 30000;
    expect(city.applyLoan(0, true)).toBe(true);
    expect([budget.totalFunds, budget.debt, budget.debtPayment]).toEqual([6000, 0, 0]);
  });

  test('set the ordinances in force, known ones only', () => {
    const city = createHeadlessCity(sampleCity('kowloon'));
    expect(city.applyOrdinances(5)).toBe(true);
    expect(city.save().ordinances).toBe(5);
    for (const bad of [1 << 20, -1, 1.5, '1', null])
      expect(city.applyOrdinances(bad)).toBe(false);
    expect(city.simulation.budget.ordinances).toBe(5);
  });

  test('change the settings, all or none', () => {
    const city = createHeadlessCity(sampleCity('kowloon'));
    expect(city.applySettings({autoBudget: false, autoBulldoze: false, disasters: false, level: 2})).toBe(true);
    const simulation = city.simulation;
    expect([simulation.budget.autoBudget, city.autoBulldoze, simulation.disasterManager.disastersEnabled,
            simulation.getLevel(), simulation.evaluation.gameLevel]).toEqual([false, false, false, 2, '2']);
    expect(city.applySettings({})).toBe(true);

    for (const bad of [{autoBudget: 1}, {autoBulldoze: 'no'}, {disasters: null}, {level: 3}, {level: '1'},
                       {level: 1, disasters: 'yes'}])
      expect(city.applySettings(bad)).toBe(false);
    expect(city.applySettings(null as any)).toBe(false);
    expect(simulation.getLevel()).toBe(2);
    expect(simulation.disasterManager.disastersEnabled).toBe(false);
  });

  test('sign and end deals with the neighbours', () => {
    const city = createHeadlessCity(sampleCity('kowloon'));
    expect(city.applyDeal('north', 'trade', true)).toBe(true);
    expect(city.applyDeal('east', 'buyPower', true)).toBe(true);
    expect(city.applyDeal('east', 'sellPower', true)).toBe(true);
    const deals = (city.save().neighbours as any[]).map(n => n.deals);
    expect(deals[0].trade).toBe(true);
    expect([deals[1].buyPower, deals[1].sellPower]).toEqual([false, true]);

    expect(city.applyDeal('north', 'trade', false)).toBe(true);
    for (const [side, kind, signed] of [['up', 'trade', true], ['north', 'gift', true], ['north', 'trade', 'yes'],
                                        ['__proto__', 'trade', true], ['north', 'toString', true]])
      expect(city.applyDeal(side, kind, signed)).toBe(false);
    expect((city.save().neighbours as any[])[0].deals.trade).toBe(false);
  });

  test('look at the neighbours without changing the links the simulation goes on with', () => {
    const city = createHeadlessCity(sampleCity('kowloon'));
    const links = city.simulation.neighbours._links;
    expect(city.describeNeighbours()).toHaveLength(4);
    expect(Object.keys(city.edgeState())).toEqual(['north', 'east', 'south', 'west']);
    expect(city.simulation.neighbours._links).toBe(links);
  });

  test('unleash the disasters of the disaster window', () => {
    const names = Object.getOwnPropertyNames(DisasterWindow).filter(key => key.startsWith('DISASTER_') && key !== 'DISASTER_NONE');
    expect([...DISASTER_KINDS].sort()).toEqual(names.map(key => (DisasterWindow as any)[key]).sort());

    const city = createHeadlessCity(sampleCity('kowloon'), {random: seededRandom(4)});
    city.takeMessages();
    const spriteOf = (type: number) => city.simulation.spriteManager.spriteList.find(s => s.type === type);

    expect(city.applyDisaster('Monster')).toBe(true);
    const monster = spriteOf(SPRITE_MONSTER);
    expect(city.takeMessages()).toEqual([{subject: Messages.MONSTER_SIGHTED,
                                          data: {trackable: true, x: expect.any(Number), y: expect.any(Number),
                                                 spriteId: monster?.id}}]);

    expect(city.applyDisaster('Tornado')).toBe(true);
    const tornado = spriteOf(SPRITE_TORNADO);
    expect(city.takeMessages()[0]).toMatchObject({subject: Messages.TORNADO_SIGHTED, data: {spriteId: tornado?.id}});
    expect(tornado?.id).not.toBe(monster?.id);

    expect(city.applyDisaster('Earthquake')).toBe(true);
    expect(city.takeMessages()[0]).toMatchObject({subject: Messages.EARTHQUAKE,
                                                  data: {showable: true, strength: expect.any(Number)}});

    expect(city.applyDisaster('Fire')).toBe(true);
    expect(subjects(city.takeMessages())).toContain(Messages.FIRE_REPORTED);

    expect(city.applyDisaster('Crash')).toBe(true);
    expect(subjects(city.takeMessages())).toContain(Messages.PLANE_CRASHED);
    expect(spriteOf(SPRITE_AIRPLANE)?.frame ?? 0).toBe(0);

    for (const bad of ['None', 'monster', '', null, 'makeMonster'])
      expect(city.applyDisaster(bad)).toBe(false);

    // A flood starts on a shore (300 tries at random places)
    const land = createHeadlessCity(emptyLand(), {random: seededRandom(4)});
    land.takeMessages();
    expect(land.applyDisaster('Flood')).toBe(true);
    expect(subjects(land.takeMessages())).toEqual([Messages.FLOODING_REPORTED]);
    expect(land.map._data.some(tile => tile.getValue() === TileValues.FLOOD)).toBe(true);

    // A meltdown needs a nuclear power plant
    expect(land.applyDisaster('Meltdown')).toBe(true);
    expect(subjects(land.takeMessages())).not.toContain(Messages.NUCLEAR_MELTDOWN);
    const at = findDirt(land, 4, 4);
    expect(land.applyTool('nuclear', {x: at.x + 1, y: at.y + 1}, {x: at.x + 1, y: at.y + 1})?.applied).toBe(1);
    expect(land.applyDisaster('Meltdown')).toBe(true);
    expect(subjects(land.takeMessages())).toContain(Messages.NUCLEAR_MELTDOWN);
  });
});


describe('The messages of a headless city', () => {
  test('tell each milestone once in the city\'s life', () => {
    const city = createHeadlessCity({...emptyLand(), _reachedCity: true});
    const simulation = city.simulation as any;
    city.takeMessages();

    simulation._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.REACHED_TOWN});
    simulation._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.REACHED_TOWN});
    simulation._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.REACHED_CITY});
    simulation._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.HIGH_CRIME});
    simulation._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.HIGH_CRIME});

    expect(subjects(city.takeMessages())).toEqual([Messages.REACHED_TOWN, Messages.HIGH_CRIME, Messages.HIGH_CRIME]);
    expect(city.takeMessages()).toEqual([]);
    expect(city.milestones._reachedTown).toBe(true);
    expect(city.save()._reachedTown).toBe(true);
  });

  test('carry only what can be sent: a sprite by its id', () => {
    const city = createHeadlessCity(emptyLand());
    const simulation = city.simulation as any;
    city.takeMessages();

    simulation._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.MONSTER_SIGHTED,
      data: {trackable: true, x: 3, y: 4, sprite: {id: 12, map: {}}, label: 'a', bad: NaN, f: () => 1, o: {a: 1}}});
    simulation._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.NO_MONEY, data: null});
    simulation._emitEvent(Messages.FRONT_END_MESSAGE, {subject: 12});

    expect(city.takeMessages()).toEqual([
      {subject: Messages.MONSTER_SIGHTED, data: {trackable: true, x: 3, y: 4, spriteId: 12, label: 'a'}},
      {subject: Messages.NO_MONEY},
    ]);
  });

  test('keep only the latest messages when nobody takes them', () => {
    const city = createHeadlessCity(emptyLand());
    city.takeMessages();
    for (let i = 0; i < 250; i++)
      (city.simulation as any)._emitEvent(Messages.FRONT_END_MESSAGE, {subject: 'm' + i});
    const messages = city.takeMessages();
    expect(messages).toHaveLength(200);
    expect(messages[0].subject).toBe('m50');
  });
});


describe('The explosions of a headless city', () => {
  // A residential zone, bulldozed: nine tiles of explosion
  const explode = () => {
    const city = createHeadlessCity(emptyLand(), {random: seededRandom(3)});
    const at = findDirt(city, 3, 3);
    const centre = {x: at.x + 1, y: at.y + 1};
    expect(city.applyTool('residential', centre, centre)?.applied).toBe(1);
    expect(city.applyTool('bulldozer', centre, centre)?.applied).toBe(1);

    const tiles: Point[] = [];
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++)
        tiles.push({x: at.x + dx, y: at.y + dy});
    }
    for (const t of tiles) {
      const raw = city.map.getTile(t.x, t.y).getRawValue();
      expect(raw & BIT_MASK).toBeGreaterThanOrEqual(TileValues.TINYEXP);
      expect(raw & BIT_MASK).toBeLessThanOrEqual(TileValues.LASTTINYEXP);
      expect(raw & ALLBITS).toBe(ANIMBIT | BULLBIT);
    }
    return {city, tiles};
  };

  const isRubble = (city: HeadlessCity, t: Point) => {
    const raw = city.map.getTile(t.x, t.y).getRawValue();
    return (raw & BIT_MASK) >= TileValues.RUBBLE && (raw & BIT_MASK) <= TileValues.LASTRUBBLE &&
           (raw & ALLBITS) === BULLBIT;
  };

  test('leave rubble once they have lasted as long as their animation, by the city\'s clock', () => {
    const {city, tiles} = explode();
    const moves = Math.ceil(EXPLOSION_MS / SPRITE_STEP_MS);
    expect(moves).toBe(24);

    expect(city.updateExplosions()).toBe(0);
    city.moveSprites(moves - 1);
    expect(city.updateExplosions()).toBe(0);
    expect(tiles.some(t => isRubble(city, t))).toBe(false);

    city.moveSprites(1);
    expect(city.updateExplosions()).toBe(9);
    expect(tiles.every(t => isRubble(city, t))).toBe(true);
    expect(city.updateExplosions()).toBe(0);
  });

  test('wait while the city is paused', () => {
    const {city, tiles} = explode();
    expect(city.updateExplosions()).toBe(0);
    city.applyPaused(true);
    city.moveSprites(100);
    expect(city.updateExplosions()).toBe(0);
    expect(tiles.some(t => isRubble(city, t))).toBe(false);

    city.applyPaused(false);
    city.moveSprites(24);
    expect(city.updateExplosions()).toBe(9);
  });

  test('are forgotten when something else took their place', () => {
    const {city, tiles} = explode();
    expect(city.updateExplosions()).toBe(0);
    city.map.setTo(tiles[0].x, tiles[0].y, new Tile(TileValues.DIRT) as any);
    expect(city.updateExplosions()).toBe(0);

    // A new explosion there starts its own time
    city.moveSprites(12);
    city.map.setTo(tiles[0].x, tiles[0].y, new Tile(TileValues.TINYEXP, ANIMBIT | BULLBIT) as any);
    expect(city.updateExplosions()).toBe(0);
    city.moveSprites(12);
    expect(city.updateExplosions()).toBe(8);
    expect(isRubble(city, tiles[0])).toBe(false);
    city.moveSprites(12);
    expect(city.updateExplosions()).toBe(1);
    expect(isRubble(city, tiles[0])).toBe(true);
  });
});


describe('The save of a headless city', () => {
  test('is a .kawacity file of the game', () => {
    const city = createHeadlessCity(sampleCity('kowloon'), {random: seededRandom(6)});
    for (let i = 0; i < 64; i++)
      city.step();

    const text = city.saveText();
    expect(text).not.toContain('isSavedGame');
    const parsed = (Storage as any).parseSavedGame(text);
    expect(parsed).not.toBeNull();
    expect(parsed.version).toBe(4);
    expect(parsed.map).toHaveLength(12000);
    expect(parsed.roadClass).toMatch(/^[0-3]{12000}$/);
    expect(city.save()).toEqual(JSON.parse(text));

    // The game opens it: the city it shows is the city the server had
    const copy = new SimulationClass(new (GameMap as any)(120, 100), parsed._gameLevel, SimulationClass.SPEED_MED,
                                     parsed, {inert: true});
    expect(rawTiles({map: copy._map})).toEqual(rawTiles(city));

    // A save of its own: the city goes on without changing it
    const save = city.save();
    const histories = JSON.stringify(save.resHist10);
    for (let i = 0; i < 64; i++)
      city.step();
    expect(JSON.stringify(save.resHist10)).toBe(histories);
  });

  test('opens again with everything the game keeps', () => {
    const city = createHeadlessCity(sampleCity('kowloon'), {random: seededRandom(6)});
    city.name = 'Renamed';
    city.applySettings({autoBulldoze: false, disasters: false, level: 1});
    city.applySpeed(3);
    city.applyDeal('west', 'twinning', true);
    for (let i = 0; i < 32; i++)
      city.step();

    const again = createHeadlessCity(city.save());
    expect([again.name, again.autoBulldoze, again.simulation.disasterManager.disastersEnabled,
            again.simulation.getLevel(), again.speed, again.paused]).toEqual(['Renamed', false, false, 1, 3, false]);
    expect(again.milestones).toEqual(city.milestones);
    expect((again.save().neighbours as any[])[3].deals.twinning).toBe(true);
    expect(again.cityTime).toBe(city.cityTime);
  });
});
