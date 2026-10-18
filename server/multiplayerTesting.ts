/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { WebSocket } from 'ws';
import { usernameKey } from './auth/users';
import type { CitySave } from './game/headless';
import { freshCitySave } from './gameTesting';
import { TEST_ORIGIN, TestApp, TestResponse } from './testing';

// Helpers for the tests of the shared cities (server/test/): players with a session, their requests to the lobby, and
// their live connections. Kept apart from testing.ts, so that the other tests do not load the game.

export interface Player {
  id: number;
  publicId: string;
  username: string;
  cookie: string;
  get(path: string): Promise<TestResponse>;
  post(path: string, body?: unknown): Promise<TestResponse>;
  patch(path: string, body: unknown): Promise<TestResponse>;
}

let playerCount = 0;

// A new account, logged in (made directly, without the forms and their captchas), with no password unless given its
// hash
export function addPlayer(t: TestApp, username = `player${++playerCount}`, passwordHash = '!'): Player {
  const {users, sessions} = t.app.context.auth;
  const now = t.clock.now();
  const user = users.create({username, usernameKey: usernameKey(username), email: `${username.toLowerCase()}@example.com`,
                             emailKey: `${username.toLowerCase()}@example.com`, passwordHash, locale: 'en', now,
                             loggedIn: true});
  const {token} = sessions.create(user.id);
  const cookie = `kc_session=${token}`;
  return {
    id: user.id,
    publicId: user.public_id,
    username,
    cookie,
    get: path => t.request(path, {headers: {Cookie: cookie}}),
    post: (path, body = {}) => t.post(path, body, {Cookie: cookie}),
    patch: (path, body) => t.request(path, {method: 'PATCH', body, headers: {Cookie: cookie, Origin: TEST_ORIGIN,
                                                                             'Content-Type': 'application/json'}}),
  };
}

let seed = 1;

// A shared city made by a player (through POST /api/cities): its public id
export async function createCity(player: Player, options: {name?: string; save?: CitySave; level?: number;
                                                           region?: {id: string; x: number; y: number}} = {}) {
  const body: Record<string, unknown> = {name: options.name ?? 'Shared', level: options.level ?? 0,
                                         save: options.save ?? freshCitySave('Fresh', 0, seed++)};
  if (options.region)
    body.region = options.region;
  const response = await player.post('/api/cities', body);
  if (response.status !== 201)
    throw new Error(`city not made: ${response.status} ${response.text}`);
  return response.json.city as {id: string; name: string};
}

// Invites a player to a city and makes them accept: the invitation's answer
export async function addMember(owner: Player, cityId: string, member: Player, role = 'player') {
  const invited = await owner.post(`/api/cities/${cityId}/invitations`, {username: member.username, role});
  if (invited.status !== 201)
    throw new Error(`not invited: ${invited.status} ${invited.text}`);
  const list = (await member.get('/api/cities')).json.invitations as {id: string; target: {id: string}}[];
  const invitation = list.find(i => i.target.id === cityId);
  if (!invitation)
    throw new Error('no invitation');
  return member.post(`/api/invitations/${invitation.id}/accept`);
}

// A live connection, as the game opens it; its messages are kept, parsed
export class TestSocket {
  readonly messages: any[] = [];
  readonly closed: Promise<{code: number; reason: string}>;
  private waiters: {test: (m: any) => boolean; resolve: (m: any) => void}[] = [];
  // Called with every message, as it comes
  readonly listeners: ((m: any) => void)[] = [];
  closeCode: number | null = null;

  constructor(readonly ws: WebSocket) {
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      this.messages.push(message);
      for (const listener of this.listeners)
        listener(message);
      for (const waiter of [...this.waiters]) {
        if (waiter.test(message)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
    this.closed = new Promise(resolve => ws.on('close', (code, reason) => {
      this.closeCode = code;
      resolve({code, reason: reason.toString()});
    }));
  }

  send(message: unknown): void {
    this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  // The first message (already received or to come) that passes the test
  waitFor(test: (m: any) => boolean, timeoutMs = 5000): Promise<any> {
    const found = this.messages.find(test);
    if (found)
      return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter = {test, resolve: (m: any) => { clearTimeout(timer); resolve(m); }};
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error('no such message; got ' + this.messages.map(m => m.t).join(',')));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  // The next message of that type from now on (those already received are forgotten)
  next(type: string, timeoutMs = 5000): Promise<any> {
    this.clear();
    return this.waitFor(m => m.t === type, timeoutMs);
  }

  ofType(type: string): any[] {
    return this.messages.filter(m => m.t === type);
  }

  clear(): void {
    this.messages.length = 0;
  }

  close(): Promise<{code: number; reason: string}> {
    this.ws.close();
    return this.closed;
  }
}

// Opens a WebSocket to /api/ws with the player's cookie (and the page's Origin, unless headers say otherwise)
export function connect(t: TestApp, cookie: string | null, headers: Record<string, string> = {}): Promise<TestSocket> {
  const url = t.url.replace(/^http/, 'ws') + '/api/ws';
  const ws = new WebSocket(url, {headers: {Origin: TEST_ORIGIN, ...(cookie ? {Cookie: cookie} : {}), ...headers}});
  const socket = new TestSocket(ws);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(socket));
    ws.once('unexpected-response', (req, res) => {
      res.resume();
      req.destroy();
      reject(Object.assign(new Error('refused'), {status: res.statusCode}));
    });
    ws.once('error', reject);
  });
}

// The status of a refused upgrade (101 when accepted, the connection then closed)
export async function upgradeStatus(t: TestApp, cookie: string | null, headers: Record<string, string> = {}) {
  try {
    const socket = await connect(t, cookie, headers);
    await socket.close();
    return 101;
  } catch (error) {
    return (error as {status?: number}).status ?? -1;
  }
}

// Connects and joins a city: the socket and its welcome
export async function join(t: TestApp, player: Player, cityId: string) {
  const socket = await connect(t, player.cookie);
  socket.send({t: 'join', city: cityId});
  const welcome = await socket.waitFor(m => m.t === 'welcome' || m.t === 'error');
  return {socket, welcome};
}

// Time passes for the rooms: the clock goes on, and a frame runs at each step of it
export function runFrames(t: TestApp, ms: number, frameMs = 16): void {
  for (let elapsed = 0; elapsed < ms; elapsed += frameMs) {
    t.clock.advance(Math.min(frameMs, ms - elapsed));
    t.app.game.rooms.frame();
  }
}

// Lets the sockets deliver what was sent
export const flushSockets = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));

// Waits until the condition holds (the server noticed a socket closed...)
export async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > end)
      throw new Error('condition never met');
    await flushSockets(5);
  }
}

let syncSeq = 1000000;

// Waits until everything the server sent this socket so far has arrived, and the server has read everything the
// socket sent: a command (settings that change nothing) is sent, and its answer awaited (an ok, or forbidden for a
// viewer), messages on a connection arriving in order
export async function sync(socket: TestSocket): Promise<void> {
  const seq = ++syncSeq;
  socket.send({t: 'settings', seq});
  await socket.waitFor(m => m.seq === seq);
}
