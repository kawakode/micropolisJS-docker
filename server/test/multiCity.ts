/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { BaseTool } from '../../src/baseTool.js';
import * as Messages from '../../src/messages';
import { CityState } from '../game/cityState';
import { CityMessage, createHeadlessCity, HeadlessCity } from '../game/headless';
import { digest, sampleCity, seededRandom } from '../gameTesting';

// Several shared cities in one server process: each runs as it would alone. Each object keeps its own listeners
// (see EventEmitter), each city its own random numbers and its own automatic bulldozer (set before it acts), and the
// game's modules keep nothing of one city for another.

const BaseToolObject = BaseTool as any;

interface Room {
  city: HeadlessCity;
  state: CityState;
  // Everything the room would send, digested, and the events the city's own listeners heard
  sent: string[];
  messages: CityMessage[];
  funds: number[];
}

const makeRoom = (name: string, seed: number, autoBulldoze: boolean): Room => {
  // Late in a year, so that the yearly budget comes during the test
  const city = createHeadlessCity({...sampleCity(name), autoBulldoze, _cityTime: 48 * 85 + 30},
                                  {random: seededRandom(seed)});
  city.applySettings({autoBudget: false});
  const room: Room = {city, state: new CityState(city), sent: [], messages: [], funds: []};
  city.simulation.addEventListener(Messages.FUNDS_CHANGED, ((funds: number) => { room.funds.push(funds); }) as any);
  return room;
};

// What a room does to its city at each step: commands now and then, the step and the sprites, and what it sends
const work = (room: Room, i: number): void => {
  const city = room.city;
  if (i % 50 === 10)
    city.applyTool('bulldozer5', {x: 20 + (i % 60), y: 30}, {x: 30 + (i % 60), y: 36});
  if (i % 50 === 30)
    city.applyTool('road', {x: 10, y: 10 + (i % 70)}, {x: 100, y: 12 + (i % 70)});
  if (i === 120)
    city.applyDisaster('Tornado');
  if (i === 200)
    city.applyBudget({roadPercent: 60, firePercent: 100, policePercent: 80, taxPercent: 8});

  const result = city.step();
  city.moveSprites(4);
  if (result.budgetApplied)
    room.sent.push('budgetApplied');

  if (i % 2 === 0) {
    city.updateExplosions();
    room.sent.push(digest(room.state.flush()));
    room.messages.push(...city.takeMessages());
  }
  if (i % 16 === 0)
    room.sent.push(digest(room.state.stats()));
  if (i % 40 === 0)
    room.sent.push(digest(room.state.maps(true)));
};

const STEPS = 16 * 30;

let autoBulldoze: boolean;

beforeEach(() => {
  autoBulldoze = BaseToolObject.getAutoBulldoze();
});

afterEach(() => {
  BaseToolObject.setAutoBulldoze(autoBulldoze);
});


describe('Cities in one process', () => {
  test('each run as it would alone', () => {
    const alone = makeRoom('kowloon', 1, true);
    for (let i = 0; i < STEPS; i++)
      work(alone, i);

    // Side by side with two others, which bulldoze automatically or not
    const rooms = [makeRoom('kowloon', 1, true), makeRoom('haight', 2, false), makeRoom('kobe', 3, false)];
    for (let i = 0; i < STEPS; i++)
      rooms.forEach(room => work(room, i));

    expect(alone.messages.length).toBeGreaterThan(5);
    expect(alone.sent).toContain('budgetApplied');
    expect(rooms[0].messages).toEqual(alone.messages);
    expect(rooms[0].funds).toEqual(alone.funds);
    expect(rooms[0].sent).toEqual(alone.sent);
    expect(digest(rooms[0].city.saveText())).toBe(digest(alone.city.saveText()));
    expect(digest(rooms[1].city.saveText())).not.toBe(digest(rooms[0].city.saveText()));

    // Without its automatic bulldozer, the city would have become another: the others' setting did not reach it
    const manual = makeRoom('kowloon', 1, false);
    for (let i = 0; i < STEPS; i++)
      work(manual, i);
    expect(digest(manual.city.saveText())).not.toBe(digest(alone.city.saveText()));
  });

  test('keep their events to themselves', () => {
    const first = createHeadlessCity(sampleCity('kowloon'));
    const second = createHeadlessCity(sampleCity('haight'));
    first.takeMessages();
    second.takeMessages();

    const heard: string[] = [];
    first.simulation.addEventListener(Messages.FUNDS_CHANGED, ((v: number) => heard.push('first ' + v)) as any);
    second.simulation.addEventListener(Messages.FUNDS_CHANGED, ((v: number) => heard.push('second ' + v)) as any);

    const funds = second.simulation.budget.totalFunds;
    expect(second.applyTool('bulldozer', {x: 50, y: 50}, {x: 52, y: 50})?.applied).toBeGreaterThan(0);
    expect(heard.length).toBeGreaterThan(0);
    expect(heard.every(line => line.startsWith('second '))).toBe(true);
    expect(heard[heard.length - 1]).toBe('second ' + second.simulation.budget.totalFunds);
    expect(second.simulation.budget.totalFunds).toBeLessThan(funds);

    // A monster in one city is not in the other, nor in its news
    second.applyDisaster('Monster');
    expect(second.takeMessages().map(m => m.subject)).toEqual([Messages.MONSTER_SIGHTED]);
    expect(first.takeMessages()).toEqual([]);
    expect(first.simulation.spriteManager.spriteList.some(s => s.type === 5)).toBe(false);

    // Each city numbers its own sprites
    first.applyDisaster('Monster');
    const ids = [first, second].map(city => city.simulation.spriteManager.spriteList.find(s => s.type === 5)?.id);
    expect(ids[0]).toBeGreaterThan(0);
    expect(ids[1]).toBeGreaterThan(0);
  });

  test('each have their own tools', () => {
    const first = createHeadlessCity(sampleCity('kowloon'));
    const second = createHeadlessCity(sampleCity('kowloon'));
    expect(first.tools.road).not.toBe(second.tools.road);
    expect((first.tools.road as any)._map).toBe(first.map);
    expect((second.tools.road as any)._map).toBe(second.map);
  });
});
