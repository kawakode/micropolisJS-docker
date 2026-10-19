/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { BaseTool } from '../../src/baseTool.js';
import { Budget } from '../../src/budget.js';
import { Census } from '../../src/census.js';
import * as Messages from '../../src/messages';
import { RemoteCity } from '../../src/remoteCity.js';
import { Tile } from '../../src/tile';
import { ALLBITS, BIT_MASK, BULLBIT } from '../../src/tileFlags';
import * as TileValues from '../../src/tileValues';
import { CityState } from '../game/cityState';
import { CityMessage, createHeadlessCity, HeadlessCity } from '../game/headless';
import { sampleCity, seededRandom } from '../gameTesting';

// The server-to-client sync test: a city simulated by the server, and the copies the players' games make of it from
// what the server sends them (src/remoteCity.js), every message through JSON. However the players join, the copies
// end up holding the same city as the server.

const BaseToolObject = BaseTool as any;
const R = RemoteCity as any;

// As the room sends a message: through JSON
const send = <T>(message: T): T => JSON.parse(JSON.stringify(message));

interface Player {
  mirror: any;
  // What the heads-up display shows, from the mirror's events (see InfoBar)
  hud: Record<string, unknown>;
  messages: CityMessage[];
  connected: boolean;
}

const follow = (mirror: any): Record<string, unknown> => {
  const values: Record<string, unknown> = {...mirror.infoBarValues()};
  const keys: [string, string][] = [[Messages.CLASSIFICATION_UPDATED, 'classification'],
                                    [Messages.POPULATION_UPDATED, 'population'], [Messages.SCORE_UPDATED, 'score'],
                                    [Messages.FUNDS_CHANGED, 'funds'], [Messages.DATE_UPDATED, 'date']];
  for (const [event, key] of keys)
    mirror.simulation.addEventListener(event, (value: unknown) => { values[key] = value; });
  return values;
};

const join = (state: CityState, now: number): Player => {
  const mirror = R.fromWelcome(send(state.welcome()), now);
  return {mirror, hud: follow(mirror), messages: [], connected: true};
};

// A room's work on a city, as DESIGN §5.5 has it, with players connected
class Room {
  readonly state: CityState;
  readonly players: Player[] = [];
  now = 0;
  sizes = {tiles: 0, tilesMessages: 0, state: 0, stats: 0, maps: 0, sprites: 0};

  constructor(readonly city: HeadlessCity) {
    this.state = new CityState(city);
  }

  private broadcast(apply: (player: Player) => void): void {
    for (const player of this.players) {
      if (player.connected)
        apply(player);
    }
  }

  // The 10 Hz pass: explosions, then the changes
  flush(): void {
    this.city.updateExplosions();
    const {tiles, state, sprites} = this.state.flush();
    if (tiles !== null) {
      this.sizes.tiles += JSON.stringify(tiles).length;
      this.sizes.tilesMessages++;
      this.broadcast(p => p.mirror.applyTiles(send(tiles)));
    }
    if (state !== null) {
      this.sizes.state += JSON.stringify(state).length;
      this.broadcast(p => p.mirror.applyState(send(state)));
    }
    if (sprites !== null) {
      this.sizes.sprites += JSON.stringify(sprites).length;
      this.broadcast(p => p.mirror.applySprites(send(sprites), this.now));
    }

    const messages = this.city.takeMessages();
    this.broadcast(p => messages.forEach(m => p.messages.push(send(m))));
  }

  stats(includeHistories = false): void {
    const stats = this.state.stats(includeHistories);
    this.sizes.stats += JSON.stringify(stats).length;
    this.broadcast(p => p.mirror.applyStats(send(stats)));
  }

  maps(): void {
    const maps = this.state.maps(true);
    if (maps !== null) {
      this.sizes.maps += JSON.stringify(maps).length;
      this.broadcast(p => p.mirror.applyMaps(send(maps)));
    }
  }

  // A step, at the medium speed: 50 ms, three moves of the sprites
  step(): void {
    this.city.step();
    this.city.moveSprites(3);
    this.now += 50;
  }

  // Everything sent at once, as at the end of a month
  catchUp(): void {
    this.flush();
    this.stats();
    this.maps();
  }
}

const rawTiles = (map: any): number[] => map._data.map((tile: any) => tile.getRawValue());

const blockMapValues = (simulation: any, name: string): number[] => {
  const blockMap = simulation.blockMaps[name];
  const values = [];
  for (let y = 0; y < blockMap.height; y++) {
    for (let x = 0; x < blockMap.width; x++)
      values.push(blockMap.get(x, y));
  }
  return values;
};

const pick = (object: any, fields: string[]) => Object.fromEntries(fields.map(field => [field, object[field]]));

// The mirror holds the city as the server has it
const expectSame = (city: HeadlessCity, player: Player): void => {
  const mirror = player.mirror;
  const copy = mirror.simulation;
  const simulation = city.simulation as any;

  expect(rawTiles(mirror.map)).toEqual(rawTiles(city.map));
  expect(Array.from(mirror.map._roadClass)).toEqual(Array.from(city.map._roadClass));

  expect(copy.budget.totalFunds).toBe(simulation.budget.totalFunds);
  expect(copy.getDate()).toEqual(simulation.getDate());
  expect(copy.getCityTime()).toBe(simulation.getCityTime());
  expect(copy.getPopulation()).toBe(city.population);
  expect(copy.getHistoryTime()).toBe(simulation.getHistoryTime());

  const evaluationFields = [...R.EVALUATION_FIELDS, 'problemVotes', 'problemOrder'];
  expect(pick(copy.evaluation, evaluationFields)).toEqual(send(pick(simulation.evaluation, evaluationFields)));
  expect(pick(copy.getCensus(), [...R.CENSUS_FIELDS, ...R.HISTORY_FIELDS]))
    .toEqual(send(pick(simulation._census, [...R.CENSUS_FIELDS, ...R.HISTORY_FIELDS])));
  expect(pick(copy.budget, [...R.BUDGET_FIELDS, 'autoBudget'])).toEqual(pick(simulation.budget,
                                                                             [...R.BUDGET_FIELDS, 'autoBudget']));
  expect(pick(copy._valves, ['resValve', 'comValve', 'indValve']))
    .toEqual(pick(simulation._valves, ['resValve', 'comValve', 'indValve']));
  for (const name of R.MAP_NAMES)
    expect(blockMapValues(copy, name)).toEqual(blockMapValues(simulation, name));

  expect(copy.getCityStatus()).toEqual(send(simulation.getCityStatus()));
  expect(copy.neighbours.describe()).toEqual(send(city.describeNeighbours()));

  expect([mirror.paused, mirror.speed, copy.isPaused(), mirror.autoBulldoze, copy.disasterManager.disastersEnabled,
          copy.getLevel()])
    .toEqual([city.paused, city.speed, city.paused, city.autoBulldoze, simulation.disasterManager.disastersEnabled,
              simulation.getLevel()]);

  // What the players see in the heads-up display
  const hud = {classification: city.hud.cityClass, population: city.hud.population, score: city.hud.score,
               funds: simulation.budget.totalFunds, date: simulation.getDate()};
  expect(player.hud).toEqual(hud);
  expect(mirror.infoBarValues()).toEqual(hud);

  // The sprites, where the server last put them once the delay has passed
  const sprites = simulation.spriteManager.spriteList.filter((s: any) => s.frame !== 0);
  expect(copy.spriteManager.getSpriteList().map((s: any) => [s.id, s.type, s.frame]))
    .toEqual(sprites.map((s: any) => [s.id, s.type, s.frame]));
};

let autoBulldoze: boolean;

beforeEach(() => {
  autoBulldoze = BaseToolObject.getAutoBulldoze();
});

afterEach(() => {
  BaseToolObject.setAutoBulldoze(autoBulldoze);
});


describe('The copies of a shared city', () => {
  test('hold the server\'s city, however the players join', () => {
    const city = createHeadlessCity(sampleCity('kowloon'), {random: seededRandom(11)});
    const room = new Room(city);
    room.players.push(join(room.state, room.now));
    const outcomes: unknown[] = [];

    for (let i = 1; i <= 16 * 50; i++) {
      room.step();

      // The players' commands
      switch (i) {
        case 20:
          outcomes.push(city.applyTool('bulldozer7', {x: 30, y: 30}, {x: 52, y: 41}));
          break;
        case 60:
          outcomes.push(city.applyTool('road', {x: 30, y: 36}, {x: 52, y: 40}));
          outcomes.push(city.applyTool('residential', {x: 41, y: 31}, {x: 50, y: 34}));
          outcomes.push(city.applyTool('avenue', {x: 30, y: 36}, {x: 40, y: 36}));
          break;
        case 100:
          city.applyBudget({roadPercent: 80, firePercent: 90, policePercent: 70, taxPercent: 9});
          city.applySettings({autoBudget: false, level: 2, autoBulldoze: false, disasters: false});
          break;
        case 150:
          // A player joins without the room flushing first: the welcome is what the others have
          room.players.push(join(room.state, room.now));
          break;
        case 200:
          city.applyDisaster('Monster');
          city.applyDeal('north', 'trade', true);
          break;
        case 260:
          city.applySpeed(3);
          city.applyPaused(true);
          break;
        case 300:
          // A player joins once the room flushed
          room.flush();
          room.players.push(join(room.state, room.now));
          break;
        case 320:
          city.applyTool('bulldozer', {x: 60, y: 40}, {x: 70, y: 50});
          city.applyPaused(false);
          city.applySpeed(1);
          break;
        case 400:
          // A player whose connection drops, who comes back later with a new welcome
          room.players[0].connected = false;
          break;
        case 600:
          room.flush();
          room.players[0].mirror.applyWelcome(send(room.state.welcome()), room.now);
          room.players[0].connected = true;
          break;
      }

      if (i % 2 === 0)
        room.flush();
      if (i % 16 === 0)
        room.stats();
      if (i % 40 === 0)
        room.maps();
    }

    room.catchUp();
    for (const player of room.players)
      expectSame(city, player);

    // The tools did something, and the monster's messages name its sprite
    expect(outcomes.every(outcome => (outcome as any).applied > 0)).toBe(true);
    const sighted = room.players[1].messages.find(m => m.subject === Messages.MONSTER_SIGHTED);
    expect(sighted?.data?.spriteId).toEqual(expect.any(Number));
    const resolved = room.players[1].mirror.resolveMessage(sighted, room.now);
    expect(resolved.data.sprite.id).toBe(sighted?.data?.spriteId);

    // The copies never changed the city by themselves
    const tiles = rawTiles(room.players[1].mirror.map);
    room.players[1].mirror.simulation.simTick();
    room.players[1].mirror.animate(room.now + 1000);
    expect(rawTiles(room.players[1].mirror.map)).toEqual(tiles);

    // What it costs to send, as JSON before compression: a welcome is about a save, the changes are small
    expect(JSON.stringify(room.state.welcome()).length).toBeLessThan(320 * 1024);
    expect(room.sizes.tiles / room.sizes.tilesMessages).toBeLessThan(4096);
  });

  test('get the histories when they change, and only then', () => {
    const city = createHeadlessCity(sampleCity('haight'), {random: seededRandom(3)});
    const room = new Room(city);
    room.players.push(join(room.state, 0));

    let sent = 0;
    let changed = 0;
    let last = JSON.stringify(pick(city.simulation._census, R.HISTORY_FIELDS));
    for (let i = 0; i < 16 * 24; i++) {
      room.step();
      if (i % 16 === 0) {
        const stats = room.state.stats();
        const now = JSON.stringify(pick(city.simulation._census, R.HISTORY_FIELDS));
        if (now !== last)
          changed++;
        last = now;
        if (stats.census.resHist10 !== undefined)
          sent++;
        room.players[0].mirror.applyStats(send(stats));
      }
    }

    expect(changed).toBeGreaterThan(2);
    expect(sent).toBe(changed);
    room.catchUp();
    expectSame(city, room.players[0]);

    // Asked for, they come anyway
    expect(room.state.stats(true).census.resHist10).toHaveLength(120);
  });

  test('send what the stats cover with the game\'s own tables', () => {
    const budget: any = {};
    new (Budget as any)().save(budget);
    expect([...R.BUDGET_FIELDS].sort()).toEqual([...Object.keys(budget).filter(key => key !== 'autoBudget' &&
                                                                               key !== 'totalFunds'),
                                                 'taxFund', 'cashFlow'].sort());
    const census: any = {};
    new (Census as any)().save(census);
    expect([...R.CENSUS_FIELDS, ...R.HISTORY_FIELDS].sort()).toEqual(Object.keys(census).sort());

    const city = createHeadlessCity(sampleCity('kobe'));
    const welcome = new CityState(city).welcome();
    expect(Object.keys(welcome.maps).sort()).toEqual([...R.MAP_NAMES].sort());
    expect(Object.keys(welcome.state).sort()).toEqual([...R.STATE_KEYS].sort());
    expect(Object.keys(welcome.stats.census).sort()).toEqual([...R.CENSUS_FIELDS, ...R.HISTORY_FIELDS].sort());
  });
});


describe('Watching a shared city', () => {
  test('does not change it', () => {
    const watched = createHeadlessCity(sampleCity('kowloon'), {random: seededRandom(21)});
    const alone = createHeadlessCity(sampleCity('kowloon'), {random: seededRandom(21)});
    const state = new CityState(watched);
    // The links to the neighbours matter with a deal: the road built to the east edge is a trade link
    for (const city of [watched, alone]) {
      city.applyDeal('east', 'trade', true);
      (city.simulation.neighbours as any)._links = null;
    }

    for (let i = 0; i < 16 * 20; i++) {
      for (const city of [watched, alone]) {
        if (i === 30)
          expect(city.applyTool('road', {x: 119, y: 6}, {x: 111, y: 6})?.applied).toBe(7);
        city.step();
        city.moveSprites(2);
        city.updateExplosions();
      }

      state.flush();
      state.stats(i % 3 === 0);
      state.maps(i % 5 === 0);
      watched.edgeState();
      watched.describeNeighbours();
      watched.cityStatus();
      if (i % 50 === 0)
        state.welcome();
    }

    expect(watched.saveText()).toBe(alone.saveText());
    expect(watched.takeMessages()).toEqual(alone.takeMessages());
  });
});


describe('A welcome', () => {
  test('holds what the other players have: a change undone before it was sent is never missed', () => {
    const city = createHeadlessCity(sampleCity('finnigan', {cityTime: 0, funds: 20000}));
    const state = new CityState(city);
    const tile = city.map.getTile(5, 5);
    const before = tile.getRawValue();

    // Changed, and not sent yet when the player joins
    city.map.setTo(5, 5, new Tile(TileValues.RUBBLE, BULLBIT) as any);
    city.simulation.budget.totalFunds = 1234;
    const player = join(state, 0);
    expect(player.mirror.map.getTile(5, 5).getRawValue()).toBe(before);
    expect(player.mirror.simulation.budget.totalFunds).toBe(20000);

    // Undone before the next changes: there is nothing to send, and the player has the city
    city.map.setTo(5, 5, new Tile(before & BIT_MASK, before & ALLBITS) as any);
    city.simulation.budget.totalFunds = 20000;
    expect(state.flush()).toEqual({tiles: null, state: null, sprites: null});
    expect(rawTiles(player.mirror.map)).toEqual(rawTiles(city.map));

    // A change that stays comes with the next changes
    city.map.setTo(6, 5, new Tile(TileValues.RUBBLE, BULLBIT) as any);
    const second = join(state, 0);
    const {tiles} = state.flush();
    expect(tiles).toEqual({c: [5 * 120 + 6, TileValues.RUBBLE | BULLBIT], r: []});
    player.mirror.applyTiles(send(tiles));
    second.mirror.applyTiles(send(tiles));
    expect(rawTiles(player.mirror.map)).toEqual(rawTiles(city.map));
    expect(rawTiles(second.mirror.map)).toEqual(rawTiles(city.map));
  });
});


describe('The changes of a shared city', () => {
  test('are only what changed, then nothing', () => {
    const city = createHeadlessCity(sampleCity('kowloon'), {random: seededRandom(8)});
    const state = new CityState(city);
    expect(state.diffTiles()).toBeNull();
    expect(state.diffState()).toBeNull();
    expect(state.maps(true)).toBeNull();

    const outcome = city.applyTool('bulldozer', {x: 40, y: 40}, {x: 44, y: 44});
    const tiles = state.diffTiles();
    expect(outcome?.applied).toBeGreaterThan(0);
    expect(tiles?.c.length).toBeGreaterThan(0);
    for (let i = 0; i < (tiles?.c.length ?? 0); i += 2) {
      const index = tiles?.c[i] as number;
      expect(city.map._data[index].getRawValue()).toBe(tiles?.c[i + 1]);
    }
    expect(state.diffTiles()).toBeNull();
    expect(state.diffState()).toEqual({funds: city.simulation.budget.totalFunds});
    expect(state.diffState()).toBeNull();

    city.applyTool('highway', {x: 40, y: 40}, {x: 44, y: 40});
    expect(state.diffTiles()?.r).toEqual([4840, 3, 4841, 3, 4842, 3, 4843, 3, 4844, 3]);

    city.applyPaused(true);
    city.applySettings({level: 1});
    expect(state.diffState()).toEqual({paused: true, level: 1, funds: city.simulation.budget.totalFunds});
    expect(state.fullState()).toMatchObject({paused: true, level: 1});
    expect(state.diffState()).toBeNull();
  });

  test('send the sprites while there are some, and once more when they are gone', () => {
    const city = createHeadlessCity(sampleCity('finnigan', {cityTime: 0, funds: 20000}));
    const state = new CityState(city);
    expect(state.diffSprites()).toBeNull();

    city.applyDisaster('Monster');
    const monster = city.simulation.spriteManager.spriteList[0];
    expect(state.diffSprites()).toEqual([[monster.id, monster.type, monster.frame, monster.x, monster.y]]);
    expect(state.diffSprites()).toHaveLength(1);
    monster.frame = 0;
    expect(state.diffSprites()).toEqual([]);
    expect(state.diffSprites()).toBeNull();
  });
});


describe('A shared city\'s scenario', () => {
  test('strikes with its disaster, then ends for every player when its time is up', () => {
    const save = sampleCity('kowloon');
    save.scenario = {id: 'tokyo', goal: 'score', disaster: 'monster', disasterWait: 1, scoreWait: 2};
    const city = createHeadlessCity(save, {random: seededRandom(5)});
    const room = new Room(city);
    room.players.push(join(room.state, room.now));
    const ends: unknown[] = [];
    room.players[0].mirror.simulation.addEventListener(Messages.SCENARIO_ENDED, (data: unknown) => ends.push(data));

    const welcome = room.state.fullState().scenario;
    expect(welcome).toMatchObject({id: 'tokyo', goal: 'score', scoreWait: 2, ended: false, won: false, target: 500});
    expect(room.players[0].mirror.simulation.getScenarioProgress()).toEqual(
      {value: city.simulation.evaluation.cityScore, target: 500, met: city.simulation.evaluation.cityScore > 500});

    let monster = false;
    for (let i = 0; i < 2000 && !city.simulation.getScenario()?.ended; i++) {
      room.step();
      room.flush();
      monster ||= room.players[0].mirror.simulation.spriteManager.getSpriteList().length > 0;
    }
    room.flush();

    // The monster came, as the scenario has it
    expect(monster).toBe(true);
    const scenario = city.simulation.getScenario();
    expect(scenario).toMatchObject({ended: true, scoreWait: 0});

    // A player joining now gets the scenario as it ended, without it ending again
    room.players.push(join(room.state, room.now));
    for (const player of room.players) {
      expect(player.mirror.simulation.getScenario()).toEqual({id: 'tokyo', goal: 'score', scoreWait: 0, ended: true,
                                                              won: scenario?.won});
      expect(player.mirror.simulation.getScenarioProgress()?.met).toBe(scenario?.won);
    }
    expect(ends).toEqual([{id: 'tokyo', won: scenario?.won}]);

    // The save keeps it, as the server accepts it
    const saved: Record<string, unknown> = {};
    city.simulation.save(saved);
    expect(saved.scenario).toMatchObject({id: 'tokyo', ended: true, scoreWait: 0});
  });

  test('is none in free play', () => {
    const state = new CityState(createHeadlessCity(sampleCity('kowloon')));
    expect(state.fullState().scenario).toBeNull();
    expect(state.diffState()).toBeNull();
  });
});
