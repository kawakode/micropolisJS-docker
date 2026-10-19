/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { createLogger } from '../log';
import { CLOSE, parseClientMessage, seqOf } from '../game/protocol';
import type { Room, RoomClient } from '../game/room';
import { FRAME_BUDGET_MS, LoadMonitor } from '../game/roomManager';
import { takeFromAll, TokenBucket } from '../game/tokenBucket';
import { Connection, WS_LIMITS } from '../game/wsServer';
import { addPlayer, createCity, Player } from '../multiplayerTesting';
import { cleanUp, startTestApp, TestApp } from '../testing';

// The rooms' frames (their budget, the steps and sprite moves caught up, the overload), the server's load, the
// protocol's reader, the token buckets, and what a connection that does not keep up is sent

afterAll(cleanUp);

class FakeClient implements RoomClient {
  readonly toolBuckets = [new TokenBucket(4096, 2048)];
  readonly sent: any[] = [];
  kicked: {reason: string; code: number} | null = null;

  constructor(readonly userId: number) {}

  send(message: object): void {
    this.sent.push(JSON.parse(JSON.stringify(message)));
  }

  sendText(text: string): void {
    this.sent.push(JSON.parse(text));
  }

  kick(reason: string, code: number): void {
    this.kicked = {reason, code};
  }
}

async function openRoom(t: TestApp, player: Player, client = new FakeClient(player.id)) {
  const city = await createCity(player);
  const row = t.app.game.cities.byPublicId(city.id)!;
  const room = t.app.game.rooms.open(row, player.id);
  t.app.game.rooms.join(room, client);
  return {room, client};
}

const countSteps = (room: Room) => {
  const counts = {steps: 0, moves: [] as number[]};
  const step = room.city.step.bind(room.city);
  const moveSprites = room.city.moveSprites.bind(room.city);
  room.city.step = () => { counts.steps++; return step(); };
  room.city.moveSprites = (moves = 1) => { counts.moves.push(moves); moveSprites(moves); };
  return counts;
};

describe('Frames', () => {
  let t: TestApp;
  let alice: Player;
  beforeEach(async () => {
    t = await startTestApp();
    alice = addPlayer(t);
  });
  afterEach(() => t.close());

  test('A city steps at its speed\'s interval; at most 2 steps and 4 sprite moves are caught up', async () => {
    const {room, client} = await openRoom(t, alice);
    expect(client.sent[0].t).toBe('welcome');
    const counts = countSteps(room);

    // The medium speed: a step every 50 ms
    for (let i = 0; i < 60; i++) {
      t.clock.advance(1000 / 60);
      t.app.game.rooms.frame();
    }
    expect(counts.steps).toBeGreaterThanOrEqual(19);
    expect(counts.steps).toBeLessThanOrEqual(21);
    expect(counts.moves.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(59);

    // A long pause of the server: the rest is dropped
    counts.steps = 0;
    counts.moves.length = 0;
    t.clock.advance(5000);
    t.app.game.rooms.frame();
    expect(counts.steps).toBe(2);
    expect(counts.moves).toEqual([4]);
    t.clock.advance(16);
    t.app.game.rooms.frame();
    expect(counts.steps).toBeLessThanOrEqual(3);
  });

  test('Without players, or paused, a city does not step', async () => {
    const {room, client} = await openRoom(t, alice);
    const counts = countSteps(room);
    t.app.game.rooms.leave(room, client);
    for (let i = 0; i < 30; i++) {
      t.clock.advance(16);
      t.app.game.rooms.frame();
    }
    expect(counts.steps).toBe(0);

    // Back: it goes on from now, without catching up
    t.app.game.rooms.join(room, client);
    t.clock.advance(16);
    t.app.game.rooms.frame();
    expect(counts.steps).toBe(1);
    room.city.applyPaused(true);
    t.clock.advance(1000);
    t.app.game.rooms.frame();
    expect([counts.steps, counts.moves.length]).toEqual([1, 0]);
  });

  test('Overloaded, every city runs at the medium speed at most', async () => {
    const {room} = await openRoom(t, alice);
    room.city.applySpeed(3);
    const counts = countSteps(room);
    const run = (overloaded: boolean) => {
      counts.steps = 0;
      for (let i = 0; i < 60; i++) {
        t.clock.advance(1000 / 60);
        room.frame(t.clock.now(), overloaded);
      }
      return counts.steps;
    };
    expect(run(false)).toBeGreaterThanOrEqual(95);
    expect(run(true)).toBeLessThanOrEqual(21);
  });

  test('8 ms of rooms\' work per frame, served in turn from a different room each frame', async () => {
    const players = [alice, addPlayer(t), addPlayer(t)];
    const rooms = [];
    for (const player of players)
      rooms.push((await openRoom(t, player)).room);
    const served: number[][] = [];
    let current: number[] = [];
    // Each room's frame takes 60% of the budget (by the clock the loop measures with)
    let elapsed = 0;
    const now = jest.spyOn(performance, 'now').mockImplementation(() => elapsed);
    rooms.forEach((room, i) => {
      room.frame = () => {
        current.push(i);
        elapsed += FRAME_BUDGET_MS * 0.6;
      };
    });
    try {
      for (let frame = 0; frame < 3; frame++) {
        current = [];
        t.app.game.rooms.frame();
        served.push(current);
      }
    } finally {
      now.mockRestore();
    }
    // Two rooms fit in a frame; each room is first in turn
    expect(served.map(list => list.length)).toEqual([2, 2, 2]);
    expect(served.map(list => list[0]).sort()).toEqual([0, 1, 2]);
  });

  test('The server\'s load: overloaded above half of a second busy, back below 30%; no new room when late', () => {
    const lines: any[] = [];
    const monitor = new LoadMonitor(createLogger({write: line => lines.push(JSON.parse(line))}), 0, false);
    monitor.addBusy(400);
    monitor.update(1000, 10);
    expect([monitor.overloaded, monitor.refuseLoads]).toEqual([false, false]);
    monitor.addBusy(600);
    monitor.update(2000, 150);
    expect([monitor.overloaded, monitor.refuseLoads]).toEqual([true, true]);
    expect(lines.some(line => line.event === 'rooms.overload')).toBe(true);
    monitor.addBusy(400);
    monitor.update(3000, 20);
    expect([monitor.overloaded, monitor.refuseLoads]).toEqual([true, false]);
    monitor.addBusy(200);
    monitor.update(4000, 20);
    expect(monitor.overloaded).toBe(false);
    // Less than a second: nothing decided yet
    monitor.addBusy(900);
    monitor.update(4500, 500);
    expect([monitor.overloaded, monitor.refuseLoads]).toEqual([false, false]);
  });

  test('A late event loop refuses new rooms; once the last room closed, what the monitor saw no longer counts', async () => {
    const {rooms, cities} = t.app.game;
    const first = cities.byPublicId((await createCity(alice)).id)!;
    const second = cities.byPublicId((await createCity(alice)).id)!;
    const room = rooms.open(first, alice.id);
    rooms.monitor.refuseLoads = true;
    expect(() => rooms.open(second, alice.id)).toThrow('server_busy');
    rooms.monitor.refuseLoads = false;
    rooms.monitor.overloaded = true;
    expect(() => rooms.open(second, alice.id)).toThrow('server_busy');

    // The last room closes while the server is late: its loop stops, and nothing would ever clear the monitor
    rooms.monitor.refuseLoads = true;
    rooms.drop(room, 'error', 1011);
    expect(rooms.rooms.size).toBe(0);
    expect(rooms.open(second, alice.id).id).toBe(second.id);
    expect([rooms.monitor.overloaded, rooms.monitor.refuseLoads]).toEqual([false, false]);
  });

  test('A city opened again sends its neighbours the power it sent when it was saved, until it scans its grid', async () => {
    const city = await createCity(alice);
    const stored = {east: {transport: false, power: true, powerOut: true,
                           signed: {trade: false, buyPower: false, sellPower: true, twinning: false}}};
    t.db.run('UPDATE cities SET edge_state = ? WHERE public_id = ?', JSON.stringify(stored), city.id);

    const row = t.app.game.cities.byPublicId(city.id)!;
    const room = t.app.game.rooms.open(row, alice.id);
    expect(room.edge.east.powerOut).toBe(true);
    expect(room.edge.west.powerOut).toBe(false);
  });

  test('A player who joins an empty room is not told what the city said before they came', async () => {
    const {room, client} = await openRoom(t, alice);
    // The city spoke after the last pass, then the last player left
    (room.city as any).messages.push({subject: 'FIRE_REPORTED'});
    t.app.game.rooms.leave(room, client);

    const next = new FakeClient(alice.id);
    t.app.game.rooms.join(room, next);
    for (let i = 0; i < 30; i++) {
      t.clock.advance(1000 / 60);
      t.app.game.rooms.frame();
    }
    expect(next.sent.filter((m) => m.subject === 'FIRE_REPORTED')).toEqual([]);
  });
});

describe('The protocol', () => {
  test('Each message is read into a fresh object of a known shape', () => {
    const read = (message: unknown) => parseClientMessage(JSON.stringify(message));
    expect(read({t: 'join', city: 'abc'})).toEqual({t: 'join', city: 'abc'});
    expect(read({t: 'tool', seq: 3, tool: 'bulldozer5', from: {x: 0, y: 99}, to: {x: 119, y: 0}}))
      .toEqual({t: 'tool', seq: 3, tool: 'bulldozer5', from: {x: 0, y: 99}, to: {x: 119, y: 0}});
    expect(read({t: 'speed', speed: 2})).toEqual({t: 'speed', seq: null, speed: 2});
    expect(read({t: 'pause', seq: 0, paused: false})).toEqual({t: 'pause', seq: 0, paused: false});
    expect(read({t: 'budget', roadPercent: 0, firePercent: 100, policePercent: 50, taxPercent: 20}))
      .toEqual({t: 'budget', seq: null, roadPercent: 0, firePercent: 100, policePercent: 50, taxPercent: 20});
    expect(read({t: 'settings', seq: 1})).toEqual({t: 'settings', seq: 1});
    expect(read({t: 'settings', autoBudget: true, level: 0})).toEqual({t: 'settings', seq: null, autoBudget: true,
                                                                       level: 0});
    expect(read({t: 'disaster', kind: 'Earthquake'})).toEqual({t: 'disaster', seq: null, kind: 'Earthquake'});
    expect(read({t: 'deal', side: 'west', kind: 'sellPower', signed: false}))
      .toEqual({t: 'deal', seq: null, side: 'west', kind: 'sellPower', signed: false});
    expect(read({t: 'chat', text: ' a\u0000b '})).toEqual({t: 'chat', seq: null, text: 'ab'});
    expect(read({t: 'cursor', x: 3, y: 4})).toEqual({t: 'cursor', x: 3, y: 4, tool: null, ax: null, ay: null});
    expect(read({t: 'cursor', x: 3, y: 4, tool: 'query', ax: null, ay: null}))
      .toEqual({t: 'cursor', x: 3, y: 4, tool: 'query', ax: null, ay: null});
    expect(read({t: 'cursor', x: null})).toEqual({t: 'cursor', x: null, y: null, tool: null, ax: null, ay: null});

    for (const bad of [null, 1, 'join', [], {}, {t: 1}, {t: 'join'}, {t: 'join', city: 5}, {t: 'join', city: 'x'.repeat(65)},
                       {t: 'tool', tool: 'query', from: {x: 0, y: 0}, to: {x: 0, y: 0}},
                       {t: 'tool', tool: 'toString', from: {x: 0, y: 0}, to: {x: 0, y: 0}},
                       {t: 'tool', tool: 'road', from: {x: 0, y: 100}, to: {x: 0, y: 0}},
                       {t: 'tool', tool: 'road', from: {x: 0, y: 0, z: 1}, to: {x: 0, y: 0}},
                       {t: 'tool', tool: 'road', from: [0, 0], to: {x: 0, y: 0}},
                       {t: 'speed', speed: 0}, {t: 'speed', speed: '1'}, {t: 'pause', paused: 0},
                       {t: 'budget', roadPercent: 101, firePercent: 0, policePercent: 0, taxPercent: 0},
                       {t: 'budget', roadPercent: 1, firePercent: 0, policePercent: 0, taxPercent: 0.5},
                       {t: 'settings', disasters: 'off'}, {t: 'settings', extra: true},
                       {t: 'disaster', kind: 'toString'}, {t: 'deal', side: 'north', kind: 'trade'},
                       {t: 'chat', text: 'x'.repeat(1201)}, {t: 'chat', text: ['x']},
                       {t: 'cursor', x: 1, y: 1, tool: 'laser'}, {t: 'cursor', x: 1, y: 1, ax: 1},
                       {t: 'cursor', x: null, y: 1}, {t: 'speed', seq: 1.5, speed: 1},
                       {t: 'speed', seq: 2 ** 53, speed: 1}])
      expect([bad, read(bad)]).toEqual([bad, null]);
    expect(parseClientMessage('{')).toBeNull();
    expect(seqOf('{"t": "nope", "seq": 12}')).toBe(12);
    expect(seqOf('{"seq": -1}')).toBeNull();
    expect(seqOf('nope')).toBeNull();
  });
});

describe('Token buckets', () => {
  test('A burst, then a refill per second; all or none from several', () => {
    const a = new TokenBucket(10, 5);
    const b = new TokenBucket(4, 1);
    expect(a.take(10, 0)).toBe(true);
    expect(a.take(1, 0)).toBe(false);
    expect(a.take(1, 199)).toBe(false);
    expect(a.take(1, 200)).toBe(true);
    expect(a.isFull(10000)).toBe(true);
    expect(takeFromAll([a, b], 5, 10000)).toBe(false);
    expect(a.has(10, 10000)).toBe(true);
    expect(takeFromAll([a, b], 4, 10000)).toBe(true);
    expect([a.has(6, 10000), a.has(7, 10000), b.has(1, 10000)]).toEqual([true, false, false]);
    // A clock going back changes nothing
    expect(b.has(1, 5000)).toBe(false);
  });
});

describe('A connection that does not keep up', () => {
  const fakeSocket = (bufferedAmount: number) => {
    const socket = {readyState: WebSocket.OPEN, bufferedAmount, sent: [] as string[], closed: null as number | null,
                    send(text: string) { this.sent.push(text); }, close(code: number) { this.closed = code; }};
    return socket;
  };

  test('is skipped the sprites and cursors above 256 KiB, and closed above 2 MiB', () => {
    const ws = fakeSocket(0);
    const connection = new Connection(ws as unknown as WebSocket, 1, 'id', 'hash', 'key', new TokenBucket(1, 1));
    connection.sendText('a', true);
    ws.bufferedAmount = WS_LIMITS.skipBuffered + 1;
    connection.sendText('b', true);
    connection.sendText('c');
    ws.bufferedAmount = WS_LIMITS.closeBuffered + 1;
    connection.sendText('d');
    expect(ws.sent).toEqual(['a', 'c']);
    expect(ws.closed).toBe(CLOSE.tryAgain);
    connection.send({t: 'late'});
    expect(ws.sent).toEqual(['a', 'c']);
  });
});
