/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import path from 'node:path';
import { RemoteCity } from '../../src/remoteCity.js';
import type { Env } from '../config';
import { Database, migrate } from '../db/database';
import { MIGRATIONS } from '../db/migrations';
import { decodeState } from '../game/cityStore';
import { sampleCity } from '../gameTesting';
import type { Room } from '../game/room';
import { addMember, addPlayer, connect, createCity, flushSockets, join, Player, runFrames, sync, TestSocket, until,
         upgradeStatus } from '../multiplayerTesting';
import { cleanUp, startTestApp, temporaryDirectory, TestApp } from '../testing';

// The live connections to the shared cities: who may connect, the rules of the protocol, every command, what the
// players are sent, and the rooms' life (saving, closing, evictions)

afterAll(cleanUp);

const R = RemoteCity as any;

// Room for many upgrades from 127.0.0.1
const MANY: Env = {IP_LIMIT_FACTOR: '100'};

const rawTiles = (map: any): number[] => map._data.map((tile: any) => tile.getRawValue());

const roomOf = (t: TestApp, cityId: string): Room => {
  const row = t.app.game.cities.byPublicId(cityId);
  const room = row ? t.app.game.rooms.get(row.id) : undefined;
  if (!room)
    throw new Error('no room');
  return room;
};

// A player's copy of the city, as the game makes it from what it is sent (src/remoteCity.js)
class Mirror {
  readonly city: any;

  constructor(readonly socket: TestSocket, welcome: any) {
    this.city = R.fromWelcome(JSON.parse(JSON.stringify(welcome)), 0);
    socket.messages.slice(socket.messages.indexOf(welcome) + 1).forEach(m => this.apply(m));
    socket.listeners.push(m => this.apply(m));
  }

  private apply(m: any): void {
    if (m.t === 'tiles')
      this.city.applyTiles(m);
    else if (m.t === 'state')
      this.city.applyState(m.state);
    else if (m.t === 'stats')
      this.city.applyStats(m.stats);
    else if (m.t === 'maps')
      this.city.applyMaps(m.maps);
    else if (m.t === 'sprites')
      this.city.applySprites(m.s, 0);
  }
}

describe('Connecting', () => {
  test('A session and the game\'s page are needed', async () => {
    const t = await startTestApp(MANY);
    const alice = addPlayer(t);
    expect(await upgradeStatus(t, null)).toBe(401);
    expect(await upgradeStatus(t, 'kc_session=' + 'x'.repeat(43))).toBe(401);
    expect(await upgradeStatus(t, alice.cookie, {Origin: 'http://evil.example'})).toBe(403);
    expect(await upgradeStatus(t, alice.cookie, {Origin: 'null'})).toBe(403);
    expect(await upgradeStatus(t, alice.cookie)).toBe(101);
    expect(t.logs.some(line => line.event === 'ws.reject' && line.reason === 'unauthenticated')).toBe(true);
    await t.close();
  });

  test('3 connections per user, 10 upgrades a minute per user and per client, MAX_WS_CONNECTIONS', async () => {
    const t = await startTestApp({MAX_WS_CONNECTIONS: '5'});
    const alice = addPlayer(t);
    const sockets = [await connect(t, alice.cookie), await connect(t, alice.cookie), await connect(t, alice.cookie)];
    expect(await upgradeStatus(t, alice.cookie)).toBe(429);
    await sockets.pop()!.close();
    await until(() => t.app.game.sockets.connectionsOf(alice.id) === 2);
    sockets.push(await connect(t, alice.cookie));

    const bob = addPlayer(t);
    sockets.push(await connect(t, bob.cookie), await connect(t, bob.cookie));
    // 5 in all
    expect(await upgradeStatus(t, addPlayer(t).cookie)).toBe(503);
    await Promise.all(sockets.map(socket => socket.close()));

    // 8 upgrades from this client so far, refused ones included: the 11th is refused
    await until(() => t.app.game.sockets.connections.size === 0);
    expect(await upgradeStatus(t, addPlayer(t).cookie)).toBe(101);
    expect(await upgradeStatus(t, addPlayer(t).cookie)).toBe(101);
    expect(await upgradeStatus(t, addPlayer(t).cookie)).toBe(429);
    t.clock.advance(2 * 60 * 1000);
    expect(await upgradeStatus(t, addPlayer(t).cookie)).toBe(101);

    // Per user, whatever the client
    const many = await startTestApp(MANY);
    const carol = addPlayer(many);
    for (let i = 0; i < 10; i++)
      expect(await upgradeStatus(many, carol.cookie)).toBe(101);
    expect(await upgradeStatus(many, carol.cookie)).toBe(429);
    await many.close();
    await t.close();
  });

  test('50 connections per client IP key (times IP_LIMIT_FACTOR)', async () => {
    const t = await startTestApp({MAX_WS_CONNECTIONS: '100'});
    const sockets: TestSocket[] = [];
    for (let i = 0; i < 50; i++) {
      // 10 upgrades a minute per client
      if (i % 10 === 0)
        t.clock.advance(2 * 60 * 1000);
      sockets.push(await connect(t, addPlayer(t).cookie));
    }
    t.clock.advance(2 * 60 * 1000);
    expect(await upgradeStatus(t, addPlayer(t).cookie)).toBe(429);
    expect(t.logs.some(line => line.event === 'ws.reject' && line.reason === 'too_many_connections')).toBe(true);
    await sockets.pop()!.close();
    await until(() => t.app.game.sockets.connections.size === 49);
    expect(await upgradeStatus(t, addPlayer(t).cookie)).toBe(101);
    await Promise.all(sockets.map(socket => socket.close()));
    await t.close();
  });

  test('Join: first, once, within the time allowed, to a city of one\'s own', async () => {
    const t = await startTestApp(MANY, {game: {rooms: {frameLoop: false}, ws: {joinTimeoutMs: 100}}});
    const alice = addPlayer(t, 'Alice');
    const bob = addPlayer(t, 'Bob');
    const city = await createCity(alice);

    // Nothing sent
    const idle = await connect(t, alice.cookie);
    expect((await idle.closed).code).toBe(1008);

    // Something else first
    const early = await connect(t, alice.cookie);
    early.send({t: 'chat', text: 'hello'});
    expect((await early.closed).code).toBe(1008);
    const garbage = await connect(t, alice.cookie);
    garbage.send('{"t": "join", "city": ');
    expect((await garbage.closed).code).toBe(1008);

    // Not a member, or no such city: not found
    for (const id of [city.id, 'AAAAAAAAAAAAAAAAAAAAAA', 'x']) {
      const socket = await connect(t, bob.cookie);
      socket.send({t: 'join', city: id});
      expect(await socket.waitFor(m => m.t === 'error')).toEqual({t: 'error', code: 'not_found'});
      expect((await socket.closed).code).toBe(1008);
    }

    const {socket, welcome} = await join(t, alice, city.id);
    expect(welcome.t).toBe('welcome');
    socket.send({t: 'join', city: city.id});
    expect(await socket.waitFor(m => m.t === 'error')).toEqual({t: 'error', code: 'invalid_input'});
    await socket.close();
    await t.close();
  });

  test('Twenty invalid messages close the connection', async () => {
    const t = await startTestApp(MANY);
    const alice = addPlayer(t);
    const city = await createCity(alice);
    const {socket} = await join(t, alice, city.id);
    const invalid = ['nope', '[]', '{"t": "fly"}', '{"t": "tool", "seq": 1, "tool": "query", "from": {"x": 1, "y": 1}, ' +
                     '"to": {"x": 1, "y": 1}}', '{"t": "speed", "speed": 4}', '{"t": "budget", "roadPercent": 100}',
                     '{"t": "chat", "text": ""}', '{"t": "cursor", "x": 500, "y": 1}', '{"t": "deal", "side": "up", ' +
                     '"kind": "trade", "signed": true}', '{"t": "pause", "paused": "yes", "seq": 2}',
                     '{"t": "settings", "level": 7}', '{"t": "disaster", "kind": "Meteor"}',
                     '{"t": "tool", "tool": "road", "from": {"x": 1, "y": 1}, "to": {"x": 1, "y": 1}, "x": 1}',
                     '{"t": "tool", "tool": "road", "from": {"x": 1.5, "y": 1}, "to": {"x": 1, "y": 1}}',
                     '{"t": "speed", "speed": 1, "seq": -1}', '{"t": "chat", "text": "x", "__proto__": {}}',
                     '{"t": "cursor", "x": 1, "y": 1, "ax": 3}', '{"t": "settings", "autoBudget": 1}',
                     '{"t": "join", "city": "x"}'];
    expect(invalid.length).toBe(19);
    for (const text of invalid)
      socket.send(text);
    await until(() => socket.ofType('error').length === 19);
    expect(socket.closeCode).toBeNull();
    socket.ws.send(Buffer.from([1, 2, 3]), {binary: true});
    expect((await socket.closed).code).toBe(1008);
    await t.close();
  });
});

describe('Playing together', () => {
  let t: TestApp;
  let alice: Player;
  let bob: Player;
  let carol: Player;
  let cityId: string;

  beforeEach(async () => {
    t = await startTestApp(MANY);
    alice = addPlayer(t, 'Alice');
    bob = addPlayer(t, 'Bob');
    carol = addPlayer(t, 'Carol');
    cityId = (await createCity(alice, {name: 'Together'})).id;
    await addMember(alice, cityId, bob, 'player');
    await addMember(alice, cityId, carol, 'viewer');
  });
  afterEach(() => t.close());

  test('The welcome: the player, the city, its state, the players and the chat', async () => {
    const {socket, welcome} = await join(t, bob, cityId);
    expect(Object.keys(welcome).sort()).toEqual(['build', 'chat', 'city', 'maps', 'players', 'save', 'sprites', 'state',
                                                 'stats', 't', 'you'].sort());
    expect(welcome.build).toBe('test');
    expect(welcome.you).toEqual({id: bob.publicId, username: 'Bob', role: 'player', colour: '#3cb44b'});
    expect(welcome.city).toEqual({id: cityId, name: 'Together', ownerName: 'Alice', region: null});
    expect(welcome.players).toEqual([
      {id: alice.publicId, username: 'Alice', role: 'owner', colour: '#e6194b', online: false},
      {id: bob.publicId, username: 'Bob', role: 'player', colour: '#3cb44b', online: true},
      {id: carol.publicId, username: 'Carol', role: 'viewer', colour: '#4363d8', online: false},
    ]);
    expect(welcome.chat).toEqual([]);
    expect(welcome.save.map.length).toBe(12000);
    expect(welcome.save.name).toBe('Together');
    expect(Object.keys(welcome.stats).sort()).toEqual(['budget', 'census', 'cityStatus', 'evaluation', 'historyTime',
                                                       'neighbours']);
    expect(welcome.state).toMatchObject({paused: false, speed: 2, level: 0});

    // The others are told who is there
    const second = await join(t, alice, cityId);
    const players = await socket.waitFor(m => m.t === 'players');
    expect(players.list.map((p: any) => p.online)).toEqual([true, true, false]);
    expect(second.welcome.you.role).toBe('owner');
    await socket.close();
    expect((await second.socket.waitFor(m => m.t === 'players' && !m.list[1].online)).list[1].username).toBe('Bob');
    await second.socket.close();
  });

  test('A road built by one player appears in the other\'s copy, identically; the tiles come before the result',
       async () => {
    const a = await join(t, alice, cityId);
    const b = await join(t, bob, cityId);
    const room = roomOf(t, cityId);
    const mirrorA = new Mirror(a.socket, a.welcome);
    const mirrorB = new Mirror(b.socket, b.welcome);
    runFrames(t, 500);
    await sync(a.socket);

    a.socket.clear();
    a.socket.send({t: 'tool', seq: 7, tool: 'road', from: {x: 10, y: 20}, to: {x: 40, y: 20}});
    const result = await a.socket.waitFor(m => m.t === 'toolResult');
    expect(result).toEqual({t: 'toolResult', seq: 7, applied: 31, failed: 0, reason: null, cost: expect.any(Number)});
    expect(result.cost).toBeGreaterThan(0);
    const order = a.socket.messages.map(m => m.t);
    expect(order.indexOf('tiles')).toBeLessThan(order.indexOf('toolResult'));
    expect(order.indexOf('state')).toBeLessThan(order.indexOf('toolResult'));

    const action = await b.socket.waitFor(m => m.t === 'action');
    expect(action).toEqual({t: 'action', by: {id: alice.publicId, username: 'Alice'}, tool: 'road', count: 31, x: 40,
                            y: 20});
    expect(a.socket.ofType('action')).toEqual([]);

    runFrames(t, 3000);
    await Promise.all([sync(a.socket), sync(b.socket)]);
    const server = rawTiles(room.city.map);
    expect(rawTiles(mirrorB.city.map)).toEqual(server);
    expect(rawTiles(mirrorA.city.map)).toEqual(server);
    expect(Array.from(mirrorB.city.map._roadClass)).toEqual(Array.from(room.city.map._roadClass));
    expect(mirrorB.city.simulation.budget.totalFunds).toBe(room.city.simulation.budget.totalFunds);
    expect(mirrorB.city.simulation.getDate()).toEqual(room.city.simulation.getDate());
    // The road is there
    expect(server.slice(20 * 120 + 10, 20 * 120 + 41).every(raw => (raw & 0x7ff) >= 64)).toBe(true);

    // Someone joining now gets the same city
    const c = await join(t, carol, cityId);
    const mirrorC = new Mirror(c.socket, c.welcome);
    expect(rawTiles(mirrorC.city.map)).toEqual(rawTiles(room.city.map));
    await Promise.all([a.socket.close(), b.socket.close(), c.socket.close()]);
  });

  test('Every command, and what each role may do', async () => {
    const a = await join(t, alice, cityId);
    const b = await join(t, bob, cityId);
    const c = await join(t, carol, cityId);
    const room = roomOf(t, cityId);
    const answer = async (socket: TestSocket, message: Record<string, unknown>) => {
      socket.clear();
      socket.send(message);
      return socket.waitFor(m => m.t === 'ok' || m.t === 'error' || m.t === 'toolResult');
    };

    // The viewer watches, chats and points
    for (const command of [{t: 'tool', seq: 1, tool: 'road', from: {x: 1, y: 1}, to: {x: 2, y: 1}},
                           {t: 'speed', seq: 2, speed: 3}, {t: 'pause', seq: 3, paused: true},
                           {t: 'budget', seq: 4, roadPercent: 50, firePercent: 50, policePercent: 50, taxPercent: 9},
                           {t: 'settings', seq: 5, autoBulldoze: false}, {t: 'disaster', seq: 6, kind: 'Fire'},
                           {t: 'deal', seq: 7, side: 'north', kind: 'twinning', signed: true}])
      expect(await answer(c.socket, command)).toEqual({t: 'error', code: 'forbidden', seq: command.seq});

    // A player builds, sets the speed, the budget, the settings and the deals, but not the disasters
    expect(await answer(b.socket, {t: 'speed', seq: 10, speed: 3})).toEqual({t: 'ok', seq: 10});
    expect(room.city.speed).toBe(3);
    expect(await answer(b.socket, {t: 'pause', paused: true})).toEqual({t: 'ok'});
    expect(room.city.paused).toBe(true);
    expect(await answer(b.socket, {t: 'budget', seq: 11, roadPercent: 40, firePercent: 60, policePercent: 80,
                                   taxPercent: 12})).toEqual({t: 'ok', seq: 11});
    expect([room.city.simulation.budget.roadPercent, room.city.simulation.budget.cityTax]).toEqual([0.4, 12]);
    expect(await answer(b.socket, {t: 'settings', seq: 12, autoBudget: false, autoBulldoze: false, level: 2}))
      .toEqual({t: 'ok', seq: 12});
    expect([room.city.simulation.budget.autoBudget, room.city.autoBulldoze, room.city.simulation.getLevel()])
      .toEqual([false, false, 2]);
    expect(await answer(b.socket, {t: 'settings', seq: 13, disasters: false})).toEqual({t: 'error', code: 'forbidden',
                                                                                          seq: 13});
    expect(await answer(b.socket, {t: 'disaster', seq: 14, kind: 'Monster'})).toEqual({t: 'error', code: 'forbidden',
                                                                                         seq: 14});
    expect(await answer(b.socket, {t: 'deal', seq: 15, side: 'east', kind: 'trade', signed: true}))
      .toEqual({t: 'ok', seq: 15});
    expect(room.edge.east.signed.trade).toBe(true);
    expect(JSON.parse(t.db.get<{edge_state: string}>('SELECT edge_state FROM cities')!.edge_state).east.signed.trade)
      .toBe(true);

    // The owner unleashes disasters and turns them off
    expect(await answer(a.socket, {t: 'settings', seq: 20, disasters: false})).toEqual({t: 'ok', seq: 20});
    expect(room.city.simulation.disasterManager.disastersEnabled).toBe(false);
    expect(await answer(a.socket, {t: 'speed', seq: 21, speed: 1})).toEqual({t: 'ok', seq: 21});
    expect(await answer(a.socket, {t: 'disaster', seq: 22, kind: 'Monster'})).toEqual({t: 'ok', seq: 22});

    // Everyone hears of it: the monster's message, with the id of its sprite, then the sprites
    c.socket.clear();
    runFrames(t, 600);
    const message = await c.socket.waitFor(m => m.t === 'msg' && typeof m.data.spriteId === 'number');
    expect(message.subject).toEqual(expect.any(String));
    const sprites = await c.socket.waitFor(m => m.t === 'sprites');
    expect(sprites.s.some((s: number[]) => s[0] === message.data.spriteId)).toBe(true);
    await sync(c.socket);

    // The state that changed, at most 4 times a second; the stats after the commands that change them
    const states = c.socket.ofType('state');
    expect(states.length).toBeGreaterThan(0);
    expect(states.length).toBeLessThanOrEqual(4);
    const merged = Object.assign({}, ...states.map(s => s.state));
    expect(merged).toMatchObject({speed: 1, autoBudget: false, autoBulldoze: false, disasters: false, level: 2});
    expect(c.socket.ofType('stats').length).toBeGreaterThan(0);
    await Promise.all([a.socket.close(), b.socket.close(), c.socket.close()]);
  });

  test('Tools are counted in placements: per connection, per user and per room', async () => {
    const dave = addPlayer(t, 'Dave');
    await addMember(alice, cityId, dave, 'player');
    const a = await join(t, alice, cityId);
    const a2 = await join(t, alice, cityId);
    const b = await join(t, bob, cityId);
    const d = await join(t, dave, cityId);
    const drag = (socket: TestSocket, seq: number) => {
      socket.send({t: 'tool', seq, tool: 'bulldozer', from: {x: 0, y: 0}, to: {x: 63, y: 63}});
      return socket.waitFor(m => (m.t === 'toolResult' || m.t === 'error') && m.seq === seq);
    };

    // 4096 placements
    const first = await drag(a.socket, 1);
    expect([first.t, first.applied + first.failed]).toEqual(['toolResult', 4096]);
    expect(await drag(a.socket, 2)).toEqual({t: 'error', code: 'rate_limited', seq: 2});
    // The same user on another connection
    expect(await drag(a2.socket, 3)).toEqual({t: 'error', code: 'rate_limited', seq: 3});
    // Another player still can, then the room (8192) is used up for a while
    expect((await drag(b.socket, 4)).t).toBe('toolResult');
    expect(await drag(d.socket, 5)).toEqual({t: 'error', code: 'rate_limited', seq: 5});
    t.clock.advance(1000);
    // 2048 back for each connection and user, 4096 for the room
    expect((await drag(a.socket, 6)).t).toBe('error');
    expect((await drag(d.socket, 7)).t).toBe('toolResult');
    t.clock.advance(1000);
    expect((await drag(a.socket, 8)).t).toBe('toolResult');

    // Connecting again does not give a fresh budget
    await Promise.all([a.socket.close(), a2.socket.close()]);
    await until(() => t.app.game.sockets.connectionsOf(alice.id) === 0);
    const again = await join(t, alice, cityId);
    expect(await drag(again.socket, 9)).toEqual({t: 'error', code: 'rate_limited', seq: 9});
    await Promise.all([again.socket.close(), b.socket.close(), d.socket.close()]);
  });

  test('Chat: cleaned, limited, kept (the last 50) for those who join later', async () => {
    const a = await join(t, alice, cityId);
    const c = await join(t, carol, cityId);
    a.socket.send({t: 'chat', text: '  Hello‮ \u0007there​  '});
    expect(await c.socket.waitFor(m => m.t === 'chat')).toEqual({
      t: 'chat', from: {id: alice.publicId, username: 'Alice', colour: '#e6194b'}, text: 'Hello there', at: t.clock.now(),
    });

    a.socket.send({t: 'chat', seq: 3, text: 'x'.repeat(301)});
    expect(await a.socket.waitFor(m => m.t === 'error')).toEqual({t: 'error', code: 'invalid_input', seq: 3});
    a.socket.clear();
    a.socket.send({t: 'chat', text: '​'});
    expect(await a.socket.waitFor(m => m.t === 'error')).toEqual({t: 'error', code: 'invalid_input'});

    // 5 at once, then 1 a second
    t.clock.advance(5000);
    a.socket.clear();
    for (let i = 0; i < 6; i++)
      a.socket.send({t: 'chat', seq: i, text: 'line ' + i});
    expect(await a.socket.waitFor(m => m.t === 'error')).toEqual({t: 'error', code: 'rate_limited', seq: 5});
    expect(a.socket.ofType('chat').length).toBe(5);
    for (let i = 0; i < 50; i++) {
      t.clock.advance(1000);
      c.socket.send({t: 'chat', text: 'more ' + i});
      await a.socket.waitFor(m => m.t === 'chat' && m.text === 'more ' + i);
    }

    const b = await join(t, bob, cityId);
    expect(b.welcome.chat.length).toBe(50);
    expect(b.welcome.chat[49]).toMatchObject({text: 'more 49', from: {username: 'Carol'}});
    expect(b.welcome.chat[0].text).toBe('more 0');
    await Promise.all([a.socket.close(), b.socket.close(), c.socket.close()]);
  });

  test('Cursors are sent together, ten times a second at most', async () => {
    const a = await join(t, alice, cityId);
    const c = await join(t, carol, cityId);
    runFrames(t, 200);
    await Promise.all([sync(a.socket), sync(c.socket)]);
    a.socket.clear();
    c.socket.clear();

    a.socket.send({t: 'cursor', x: 5, y: 6, tool: 'road', ax: 1, ay: 2});
    c.socket.send({t: 'cursor', x: 7, y: 8, tool: 'query'});
    for (let i = 0; i < 20; i++)
      c.socket.send({t: 'cursor', x: 9, y: i});
    await Promise.all([sync(a.socket), sync(c.socket)]);
    expect(a.socket.ofType('cursors')).toEqual([]);

    runFrames(t, 100);
    const cursors = await a.socket.waitFor(m => m.t === 'cursors');
    expect(cursors.list).toEqual(expect.arrayContaining([[alice.publicId, 5, 6, 'road', 1, 2]]));
    const carols = cursors.list.find((entry: unknown[]) => entry[0] === carol.publicId);
    // Beyond 10 at once, cursor messages are dropped without a word
    expect(carols).toEqual([carol.publicId, 9, 8, null, null, null]);
    expect(c.socket.ofType('error').filter(m => m.code !== 'forbidden')).toEqual([]);
    expect((await c.socket.waitFor(m => m.t === 'cursors')).list).toEqual(cursors.list);

    await sync(a.socket);
    a.socket.clear();
    c.socket.send({t: 'cursor', x: null});
    await sync(c.socket);
    runFrames(t, 100);
    expect((await a.socket.waitFor(m => m.t === 'cursors')).list).toEqual([[alice.publicId, 5, 6, 'road', 1, 2]]);
    // Nothing changed, nothing sent
    await sync(a.socket);
    a.socket.clear();
    runFrames(t, 300);
    await sync(a.socket);
    expect(a.socket.ofType('cursors')).toEqual([]);

    // A player who joins gets the pointers that do not move, at the next pass
    const b = await join(t, bob, cityId);
    runFrames(t, 100);
    expect((await b.socket.waitFor(m => m.t === 'cursors')).list).toEqual([[alice.publicId, 5, 6, 'road', 1, 2]]);
    await Promise.all([a.socket.close(), b.socket.close(), c.socket.close()]);
  });

  test('Stats each month (twice a second at most), maps every 2 s, nothing of the maps while paused', async () => {
    const a = await join(t, alice, cityId);
    a.socket.send({t: 'speed', speed: 3});
    a.socket.send({t: 'tool', seq: 1, tool: 'residential', from: {x: 50, y: 50}, to: {x: 50, y: 50}});
    await a.socket.waitFor(m => m.t === 'toolResult');
    a.socket.clear();
    runFrames(t, 4000);
    await sync(a.socket);
    const stats = a.socket.ofType('stats').length;
    expect(stats).toBeGreaterThanOrEqual(2);
    expect(stats).toBeLessThanOrEqual(9);
    expect(a.socket.ofType('maps').length).toBeLessThanOrEqual(2);

    a.socket.send({t: 'pause', paused: true});
    await a.socket.waitFor(m => m.t === 'ok');
    runFrames(t, 300);
    await sync(a.socket);
    a.socket.clear();
    runFrames(t, 5000);
    await sync(a.socket);
    expect(a.socket.ofType('maps')).toEqual([]);
    expect(a.socket.ofType('tiles')).toEqual([]);
    await a.socket.close();
  });

  test('Members: a new role is told at once, a removed member and a deleted city end the connections', async () => {
    const a = await join(t, alice, cityId);
    const b = await join(t, bob, cityId);
    const c = await join(t, carol, cityId);

    expect((await alice.post(`/api/cities/${cityId}/members/${carol.publicId}`, {role: 'player'})).status).toBe(200);
    expect(await c.socket.waitFor(m => m.t === 'roleChanged')).toEqual({t: 'roleChanged', role: 'player'});
    expect((await a.socket.waitFor(m => m.t === 'players' && m.list[2].role === 'player')).list[2].username)
      .toBe('Carol');
    c.socket.send({t: 'tool', seq: 1, tool: 'road', from: {x: 1, y: 1}, to: {x: 3, y: 1}});
    expect((await c.socket.waitFor(m => m.t === 'toolResult')).applied).toBe(3);

    expect((await alice.patch(`/api/cities/${cityId}`, {name: 'New name'})).status).toBe(200);
    expect(await b.socket.waitFor(m => m.t === 'renamed')).toEqual({t: 'renamed', name: 'New name'});

    expect((await alice.post(`/api/cities/${cityId}/members/${carol.publicId}/remove`)).status).toBe(204);
    expect(await c.socket.waitFor(m => m.t === 'kicked')).toEqual({t: 'kicked', reason: 'removed'});
    expect((await c.socket.closed).code).toBe(1000);

    // Bob leaves by himself
    expect((await bob.post(`/api/cities/${cityId}/members/${bob.publicId}/remove`)).status).toBe(204);
    expect(await b.socket.waitFor(m => m.t === 'kicked')).toEqual({t: 'kicked', reason: 'removed'});

    const before = t.db.get<{state: Uint8Array}>('SELECT state FROM cities')!.state;
    expect(before).toBeTruthy();
    expect((await alice.post(`/api/cities/${cityId}/delete`)).status).toBe(204);
    expect(await a.socket.waitFor(m => m.t === 'kicked')).toEqual({t: 'kicked', reason: 'deleted'});
    expect((await a.socket.closed).code).toBe(1000);
    expect(t.app.game.rooms.rooms.size).toBe(0);
    expect(t.logs.filter(line => line.event === 'ws.kick').map(line => line.reason))
      .toEqual(['removed', 'removed', 'deleted']);
  });

  test('A session that ends closes its connections at once; the ping looks at the session again', async () => {
    const a = await join(t, alice, cityId);
    const b = await join(t, bob, cityId);

    t.app.context.auth.sessions.revokeAll(alice.id);
    expect(await a.socket.waitFor(m => m.t === 'kicked')).toEqual({t: 'kicked', reason: 'session'});
    expect((await a.socket.closed).code).toBe(1000);
    expect(b.socket.closeCode).toBeNull();

    t.db.run('DELETE FROM sessions WHERE user_id = ?', bob.id);
    t.app.game.sockets.heartbeat();
    expect(await b.socket.waitFor(m => m.t === 'kicked')).toEqual({t: 'kicked', reason: 'session'});
    expect((await b.socket.closed).code).toBe(1000);
  });

  test('A connection that does not answer the pings is closed', async () => {
    const c = await join(t, carol, cityId);
    expect(t.app.game.sockets.connectionsOf(carol.id)).toBe(1);
    // The test's socket answers pings by itself: it stops reading
    (c.socket.ws as any)._socket.pause();
    t.app.game.sockets.heartbeat();
    await flushSockets(50);
    t.app.game.sockets.heartbeat();
    await until(() => t.app.game.sockets.connectionsOf(carol.id) === 0);
    expect(roomOf(t, cityId).clients.size).toBe(0);
    (c.socket.ws as any)._socket.resume();
    expect((await c.socket.closed).code).toBe(1006);
  });

  test('Deleting an account: its cities close, their players told', async () => {
    const b = await join(t, bob, cityId);
    const {auth} = t.app.context;
    t.db.transaction(() => {
      for (const hook of auth.deletionHooks)
        hook(alice.id);
      auth.users.delete(alice.id);
    });
    expect(await b.socket.waitFor(m => m.t === 'kicked')).toEqual({t: 'kicked', reason: 'deleted'});
    expect(t.db.get<{n: number}>('SELECT count(*) AS n FROM cities')?.n).toBe(0);
  });
});

describe('Deleting an account', () => {
  test('Through the account route: its cities close (kicked, deleted), its connections end', async () => {
    const t = await startTestApp(MANY);
    const password = 'a very private passphrase';
    const alice = addPlayer(t, 'Alice', await t.app.context.auth.passwords.hash(password, 'test'));
    const bob = addPlayer(t, 'Bob');
    const city = await createCity(alice);
    const theirs = await createCity(bob);
    await addMember(alice, city.id, bob);
    await addMember(bob, theirs.id, alice, 'viewer');
    const a = await join(t, alice, theirs.id);
    const b = await join(t, bob, city.id);
    const b2 = await join(t, bob, theirs.id);

    expect((await alice.post('/api/account/delete', {password})).status).toBe(204);
    expect(await b.socket.waitFor(m => m.t === 'kicked')).toEqual({t: 'kicked', reason: 'deleted'});
    expect(await a.socket.waitFor(m => m.t === 'kicked')).toEqual({t: 'kicked', reason: 'session'});
    // Bob's own city goes on, without Alice
    const players = await b2.socket.waitFor(m => m.t === 'players' && m.list.length === 1);
    expect(players.list).toEqual([expect.objectContaining({username: 'Bob', online: true})]);
    expect((await bob.get('/api/cities')).json.cities.map((c: any) => c.id)).toEqual([theirs.id]);
    await b2.socket.close();
    await t.close();
  });
});

describe('Rooms', () => {
  test('A room is saved when its last player leaves, and closed a minute later', async () => {
    const t = await startTestApp(MANY);
    const alice = addPlayer(t);
    const city = await createCity(alice);
    const {socket} = await join(t, alice, city.id);
    socket.send({t: 'tool', seq: 1, tool: 'road', from: {x: 30, y: 30}, to: {x: 35, y: 30}});
    await socket.waitFor(m => m.t === 'toolResult');
    runFrames(t, 1000);
    await socket.close();
    await until(() => t.app.game.sockets.connections.size === 0);

    const row = t.db.get<{state: Uint8Array; city_time: number}>('SELECT state, city_time FROM cities')!;
    const saved = decodeState(row.state);
    expect((saved.map as {value: number}[])[30 * 120 + 32].value & 0x7ff).toBeGreaterThanOrEqual(64);
    expect(t.app.game.rooms.rooms.size).toBe(1);
    runFrames(t, 59 * 1000, 1000);
    expect(t.app.game.rooms.rooms.size).toBe(1);
    runFrames(t, 2000, 1000);
    expect(t.app.game.rooms.rooms.size).toBe(0);
    await t.close();
  });

  test('Saved every minute while it changes; a city whose row went away closes its room', async () => {
    const t = await startTestApp(MANY);
    const alice = addPlayer(t);
    const city = await createCity(alice);
    const {socket} = await join(t, alice, city.id);
    const time = () => t.db.get<{city_time: number}>('SELECT city_time FROM cities')?.city_time;
    const start = time();
    runFrames(t, 30 * 1000);
    expect(time()).toBe(start);
    runFrames(t, 31 * 1000);
    expect(time()).toBeGreaterThan(start!);

    // Another process (the admin CLI) deleted it
    t.db.run('DELETE FROM cities');
    runFrames(t, 61 * 1000);
    expect(await socket.waitFor(m => m.t === 'kicked')).toEqual({t: 'kicked', reason: 'deleted'});
    expect(t.app.game.rooms.rooms.size).toBe(0);
    await t.close();
  });

  test('A room whose city throws closes without saving; its players are told', async () => {
    const t = await startTestApp(MANY);
    const alice = addPlayer(t);
    const city = await createCity(alice);
    const {socket} = await join(t, alice, city.id);
    socket.send({t: 'tool', seq: 1, tool: 'road', from: {x: 30, y: 30}, to: {x: 35, y: 30}});
    await socket.waitFor(m => m.t === 'toolResult');
    const before = t.db.get<{state: Uint8Array}>('SELECT state FROM cities')!.state;

    const room = roomOf(t, city.id);
    room.city.step = () => { throw new Error('broken'); };
    runFrames(t, 100);
    expect(await socket.waitFor(m => m.t === 'kicked')).toEqual({t: 'kicked', reason: 'error'});
    expect((await socket.closed).code).toBe(1011);
    // Once the server saw the connection close too: still not saved
    await until(() => t.app.game.sockets.connectionsOf(alice.id) === 0);
    expect(room.dirty).toBe(true);
    expect(t.db.get<{state: Uint8Array}>('SELECT state FROM cities')!.state).toEqual(before);
    expect(t.logs.some(line => line.event === 'room.error' && line.err.message === 'broken')).toBe(true);

    // It opens again from its last save
    const again = await join(t, alice, city.id);
    expect(again.welcome.t).toBe('welcome');
    await again.socket.close();
    await t.close();
  });

  test('MAX_ROOMS, and 5 cities opened a minute per user', async () => {
    const t = await startTestApp({...MANY, MAX_ROOMS: '1'});
    const alice = addPlayer(t);
    const first = await createCity(alice);
    const second = await createCity(alice);
    const a = await join(t, alice, first.id);
    const b = await join(t, alice, second.id);
    expect(b.welcome).toEqual({t: 'error', code: 'server_busy'});
    expect((await b.socket.closed).code).toBe(1013);
    await a.socket.close();
    await t.close();

    const u = await startTestApp(MANY);
    const bob = addPlayer(u);
    const ids = [];
    for (let i = 0; i < 5; i++)
      ids.push((await createCity(bob)).id);
    const dan = addPlayer(u);
    const sixth = await createCity(dan);
    await addMember(dan, sixth.id, bob, 'viewer');
    for (const id of ids) {
      const {socket, welcome} = await join(u, bob, id);
      expect(welcome.t).toBe('welcome');
      await socket.close();
    }
    expect(u.app.game.rooms.rooms.size).toBe(5);
    const refused = await join(u, bob, sixth.id);
    expect(refused.welcome).toEqual({t: 'error', code: 'rate_limited'});
    expect((await refused.socket.closed).code).toBe(1013);
    // Joining a city already open is not opening one
    const open = await join(u, bob, ids[0]);
    expect(open.welcome.t).toBe('welcome');
    await open.socket.close();
    await u.close();
  });

  test('The yearly budget is confirmed at once, and the players (not the viewers) are told', async () => {
    const t = await startTestApp(MANY);
    const alice = addPlayer(t);
    const viewer = addPlayer(t);
    // A city with people: one without has no budget
    const city = await createCity(alice, {save: sampleCity('kobe')});
    await addMember(alice, city.id, viewer, 'viewer');
    const a = await join(t, alice, city.id);
    const v = await join(t, viewer, city.id);
    a.socket.send({t: 'settings', seq: 1, autoBudget: false});
    a.socket.send({t: 'speed', seq: 2, speed: 3});
    await a.socket.waitFor(m => m.t === 'ok' && m.seq === 2);
    const room = roomOf(t, city.id);
    for (let i = 0; i < 40 && a.socket.ofType('budgetApplied').length === 0; i++) {
      runFrames(t, 500);
      await sync(a.socket);
    }
    expect(await a.socket.waitFor(m => m.t === 'budgetApplied')).toEqual({t: 'budgetApplied'});
    expect(room.city.simulation.budget.awaitingValues).toBe(false);
    await sync(v.socket);
    expect(v.socket.ofType('budgetApplied')).toEqual([]);
    await Promise.all([a.socket.close(), v.socket.close()]);
    await t.close();
  }, 60 * 1000);

  test('A city survives a restart of the server: its tiles, its pause, its edges', async () => {
    const directory = temporaryDirectory();
    const file = path.join(directory, 'kawacity.db');
    const open = () => {
      const db = new Database(file);
      migrate(db, MIGRATIONS, {backupDirectory: path.join(directory, 'backups'), now: 0});
      return db;
    };

    const t = await startTestApp(MANY, {db: open()});
    const alice = addPlayer(t);
    const city = await createCity(alice, {name: 'Lasting'});
    const {socket} = await join(t, alice, city.id);
    socket.send({t: 'tool', seq: 1, tool: 'road', from: {x: 60, y: 0}, to: {x: 60, y: 10}});
    socket.send({t: 'deal', seq: 2, side: 'north', kind: 'trade', signed: true});
    socket.send({t: 'pause', seq: 3, paused: true});
    await socket.waitFor(m => m.t === 'ok' && m.seq === 3);
    runFrames(t, 200);
    const tiles = rawTiles(roomOf(t, city.id).city.map);
    const closing = socket.waitFor(m => m.t === 'kicked');
    await t.close();
    expect(await closing).toEqual({t: 'kicked', reason: 'shutdown'});
    expect((await socket.closed).code).toBe(1001);

    const again = await startTestApp(MANY, {db: open()});
    const back = await join(again, alice, city.id);
    expect(back.welcome.state.paused).toBe(true);
    expect(back.welcome.city.name).toBe('Lasting');
    expect(back.welcome.save.map.map((tile: {value: number}) => tile.value)).toEqual(tiles);
    const edges = JSON.parse(again.db.get<{edge_state: string}>('SELECT edge_state FROM cities')!.edge_state);
    expect(edges.north).toEqual({transport: true, power: false, powerOut: false,
                                 signed: {trade: true, buyPower: false, sellPower: false, twinning: false}});
    expect(roomOf(again, city.id).edge.north.signed.trade).toBe(true);
    await back.socket.close();
    await again.close();
  });
});
