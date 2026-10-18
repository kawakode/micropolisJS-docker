/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { RawData, WebSocket, WebSocketServer } from 'ws';
import { rejectUpgrade, type AppContext, type UpgradeRequest } from '../app';
import { revokes, type SessionRevocation } from '../auth/sessions';
import type { Logger } from '../log';
import type { CityStore } from './cityStore';
import { CLOSE, CommandMessage, ErrorCode, KickReason, parseClientMessage, seqOf } from './protocol';
import { TOOL_BUCKETS, type Room, type RoomClient } from './room';
import { RoomManager, RoomRefusal } from './roomManager';
import { TokenBucket } from './tokenBucket';

// The live connections to the shared cities: the WebSocket at /api/ws (DESIGN §5.4). The app has checked the path and
// the Origin; here:
//   - 10 upgrades a minute per client IP key (times IP_LIMIT_FACTOR) and per user: 429
//   - the session cookie: 401 without a valid session
//   - MAX_WS_CONNECTIONS in all: 503; 3 per user and 50 per IP key (times IP_LIMIT_FACTOR): 429
// A connection must join a city within 10 s, with its first message (else it is closed, 1008). Its messages are
// counted (30 a second, bursts of 60, cursors included; chat 1 a second, bursts of 5; cursors 10 a second, the others
// dropped; tools in placements, see room.ts): 20 invalid messages close it (1008), and so does a message longer than
// any the game sends (4 KiB), refused unread. A connection that does not keep up is skipped the sprites and cursors
// above 256 KiB waiting to be sent, and closed above 2 MiB (1013: the game connects again and gets a fresh welcome);
// the pings it sends are answered only while it keeps up, 2 a second at most (more: closed, 1008). Every 25 s each
// connection is pinged (no answer since the last ping: closed), what waits to be sent looked at (above 2 MiB: closed,
// 1013), its session looked at again (ended: kicked, reason session), and what its player did: nothing for 15 minutes
// (no command, no chat, no cursor that moved) and it is kicked (reason idle), so that a connection left open does not
// keep a city running, and its room taken, for good. A session ended early (logout, password change...) closes its
// connections at once.

export const WS_PATH = '/api/ws';

export const WS_LIMITS = Object.freeze({
  maxPayload: 64 * 1024,
  // The longest message the game sends (a chat line of 300 characters is at most 1.2 KiB): longer ones are not read
  maxMessage: 4 * 1024,
  upgradesPerMinute: 10,
  perUser: 3,
  perIpKey: 50,
  invalidMessages: 20,
  skipBuffered: 256 * 1024,
  closeBuffered: 2 * 1024 * 1024,
});

// Messages per connection: [burst, per second]. Pings are control frames: the game's browser never sends any.
const MESSAGE_BUCKETS = Object.freeze({
  overall: [60, 30],
  chat: [5, 1],
  cursor: [10, 10],
  ping: [10, 2],
} as const);

export interface WsOptions {
  joinTimeoutMs: number;
  pingIntervalMs: number;
  idleTimeoutMs: number;
}

export const DEFAULT_WS_OPTIONS: WsOptions = {
  joinTimeoutMs: 10 * 1000,
  pingIntervalMs: 25 * 1000,
  idleTimeoutMs: 15 * 60 * 1000,
};

const MINUTE = 60 * 1000;

// A message's bytes, as ws gives them
const bytesOf = (data: RawData): Buffer =>
  Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);

// One live connection
export class Connection implements RoomClient {
  readonly toolBuckets: readonly TokenBucket[];
  room: Room | null = null;
  joined = false;
  closing = false;
  alive = true;
  invalid = 0;
  joinTimer: NodeJS.Timeout | null = null;
  readonly overall = new TokenBucket(...MESSAGE_BUCKETS.overall);
  readonly chat = new TokenBucket(...MESSAGE_BUCKETS.chat);
  readonly cursor = new TokenBucket(...MESSAGE_BUCKETS.cursor);
  readonly ping = new TokenBucket(...MESSAGE_BUCKETS.ping);
  // When its player last did something (see acted), by the server's clock
  active: number;
  private cursorAt = '';

  constructor(readonly ws: WebSocket, readonly userId: number, readonly userPublicId: string,
              readonly tokenHash: string, readonly ipKey: string, userTools: TokenBucket,
              private readonly log: Logger | null = null, now = 0) {
    this.toolBuckets = [new TokenBucket(TOOL_BUCKETS.connection.burst, TOOL_BUCKETS.connection.perSecond), userTools];
    this.active = now;
  }

  // A message of its player: a command, a chat line, or a cursor, which counts only when it moved
  acted(message: CommandMessage, now: number): void {
    if (message.t === 'cursor') {
      const at = [message.x, message.y, message.tool, message.ax, message.ay].join();
      if (at === this.cursorAt)
        return;
      this.cursorAt = at;
    }
    this.active = now;
  }

  // Whether the connection still keeps up with what it is sent: closed (1013) when it is too far behind
  keepsUp(): boolean {
    if (this.ws.bufferedAmount <= WS_LIMITS.closeBuffered)
      return true;
    this.close(CLOSE.tryAgain);
    return false;
  }

  sendText(text: string, skippable = false): void {
    if (this.closing || this.ws.readyState !== WebSocket.OPEN || !this.keepsUp())
      return;
    if (skippable && this.ws.bufferedAmount > WS_LIMITS.skipBuffered)
      return;
    this.ws.send(text);
  }

  // A ping from the other side (ws does not answer it by itself): answered while the connection keeps up, a few a
  // second at most (more closes it)
  pinged(data: Buffer, now: number): void {
    if (this.closing || this.ws.readyState !== WebSocket.OPEN)
      return;
    if (!this.ping.take(1, now)) {
      this.close(CLOSE.policy);
      return;
    }
    if (this.keepsUp() && this.ws.bufferedAmount <= WS_LIMITS.skipBuffered)
      this.ws.pong(data);
  }

  send(message: object): void {
    this.sendText(JSON.stringify(message));
  }

  error(code: ErrorCode, seq: number | null = null): void {
    this.send(seq === null ? {t: 'error', code} : {t: 'error', code, seq});
  }

  kick(reason: KickReason, code: number): void {
    if (this.closing)
      return;
    this.log?.info('ws.kick', {user: this.userPublicId, ip: this.ipKey, reason, code});
    this.send({t: 'kicked', reason});
    this.close(code);
  }

  close(code: number): void {
    if (this.closing)
      return;
    this.closing = true;
    if (this.joinTimer !== null) {
      clearTimeout(this.joinTimer);
      this.joinTimer = null;
    }
    this.ws.close(code);
  }
}

export class GameSocketServer {
  private readonly wss: WebSocketServer;
  readonly connections = new Set<Connection>();
  private readonly byUser = new Map<number, Set<Connection>>();
  private readonly byIpKey = new Map<string, number>();
  // Each user's tool budget, shared by their connections
  private readonly userTools = new Map<number, TokenBucket>();
  private readonly pingTimer: NodeJS.Timeout;
  private readonly stopRevocations: () => void;
  private stopped = false;

  constructor(private readonly context: AppContext, private readonly rooms: RoomManager,
              private readonly cities: CityStore, private readonly options: WsOptions) {
    this.wss = new WebSocketServer({
      noServer: true,
      clientTracking: false,
      maxPayload: WS_LIMITS.maxPayload,
      // The pings are answered by the connection, which keeps an eye on what waits to be sent (see Connection.pinged)
      autoPong: false,
      perMessageDeflate: {
        threshold: 1024,
        serverNoContextTakeover: true,
        clientNoContextTakeover: true,
        serverMaxWindowBits: 10,
        concurrencyLimit: 10,
        zlibDeflateOptions: {level: 3, memLevel: 7},
      },
    });

    this.pingTimer = setInterval(() => this.heartbeat(), options.pingIntervalMs);
    this.pingTimer.unref();
    this.stopRevocations = context.auth.sessions.onRevoked(revocation => this.revoked(revocation));
  }

  private refuse(upgrade: UpgradeRequest, status: number, reason: string, user?: string): void {
    const {address} = upgrade;
    this.context.log.security('ws.reject', `${reason} ${address.aggregateKey ?? address.key}`,
                              {requestId: upgrade.requestId, ip: address.key, reason, status, user});
    rejectUpgrade(upgrade.socket, status);
  }

  // A WebSocket upgrade to /api/ws, its Origin checked by the app
  handleUpgrade(upgrade: UpgradeRequest): void {
    const {context} = this;
    const {address} = upgrade;
    if (this.stopped) {
      rejectUpgrade(upgrade.socket, 503);
      return;
    }

    const perIp = context.ipLimiter('ws-upgrade', WS_LIMITS.upgradesPerMinute, MINUTE);
    if (!perIp.hit({key: address.key, aggregateKey: address.aggregateKey}).allowed) {
      this.refuse(upgrade, 429, 'rate_limited');
      return;
    }

    const resolved = context.auth.sessions.resolve(upgrade.cookies);
    if (!resolved) {
      this.refuse(upgrade, 401, 'unauthenticated');
      return;
    }

    const {user, session} = resolved;
    const perUser = context.userLimiter('ws-upgrade-user', WS_LIMITS.upgradesPerMinute, MINUTE);
    if (!perUser.hit(String(user.id)).allowed) {
      this.refuse(upgrade, 429, 'rate_limited', user.publicId);
      return;
    }

    if (this.connections.size >= context.config.maxWsConnections) {
      this.refuse(upgrade, 503, 'server_busy', user.publicId);
      return;
    }
    if ((this.byUser.get(user.id)?.size ?? 0) >= WS_LIMITS.perUser ||
        (this.byIpKey.get(address.key) ?? 0) >= WS_LIMITS.perIpKey * context.config.ipLimitFactor) {
      this.refuse(upgrade, 429, 'too_many_connections', user.publicId);
      return;
    }

    this.wss.handleUpgrade(upgrade.req, upgrade.socket, upgrade.head, ws => {
      this.accept(ws, user.id, user.publicId, session.tokenHash, address.key);
    });
  }

  private accept(ws: WebSocket, userId: number, userPublicId: string, tokenHash: string, ipKey: string): void {
    let tools = this.userTools.get(userId);
    if (!tools) {
      tools = new TokenBucket(TOOL_BUCKETS.connection.burst, TOOL_BUCKETS.connection.perSecond);
      this.userTools.set(userId, tools);
    }

    const connection = new Connection(ws, userId, userPublicId, tokenHash, ipKey, tools, this.context.log,
                                      this.context.clock.now());
    this.connections.add(connection);
    let mine = this.byUser.get(userId);
    if (!mine) {
      mine = new Set();
      this.byUser.set(userId, mine);
    }
    mine.add(connection);
    this.byIpKey.set(ipKey, (this.byIpKey.get(ipKey) ?? 0) + 1);

    connection.joinTimer = setTimeout(() => {
      connection.joinTimer = null;
      if (!connection.joined)
        connection.close(CLOSE.policy);
    }, this.options.joinTimeoutMs);

    ws.on('message', (data, isBinary) => this.receive(connection, data, isBinary));
    ws.on('ping', data => connection.pinged(data, this.context.clock.now()));
    ws.on('pong', () => { connection.alive = true; });
    ws.on('error', () => { /* the connection closes: see 'close' */ });
    ws.on('close', () => this.closed(connection));
  }

  private closed(connection: Connection): void {
    if (!this.connections.delete(connection))
      return;

    connection.closing = true;
    if (connection.joinTimer !== null)
      clearTimeout(connection.joinTimer);
    if (connection.room)
      this.rooms.leave(connection.room, connection);

    const mine = this.byUser.get(connection.userId);
    mine?.delete(connection);
    if (mine?.size === 0)
      this.byUser.delete(connection.userId);
    this.forgetToolBudget(connection.userId);
    const count = (this.byIpKey.get(connection.ipKey) ?? 1) - 1;
    if (count > 0)
      this.byIpKey.set(connection.ipKey, count);
    else
      this.byIpKey.delete(connection.ipKey);
  }

  // A message that is not one, or not allowed now: 20 of them close the connection
  private invalid(connection: Connection, code: ErrorCode = 'invalid_input', seq: number | null = null): void {
    connection.invalid++;
    if (connection.invalid >= WS_LIMITS.invalidMessages) {
      connection.close(CLOSE.policy);
      return;
    }
    connection.error(code, seq);
  }

  private receive(connection: Connection, data: RawData, isBinary: boolean): void {
    if (connection.closing)
      return;

    const now = this.context.clock.now();
    const bytes = bytesOf(data);
    // Longer than any message of the game: not read
    if (bytes.length > WS_LIMITS.maxMessage) {
      if (connection.joined)
        this.invalid(connection);
      else
        connection.close(CLOSE.policy);
      return;
    }
    const text = isBinary ? null : bytes.toString('utf8');
    const message = text === null ? null : parseClientMessage(text);

    if (!connection.joined) {
      // The first message must be a valid join
      if (message === null || message.t !== 'join') {
        connection.close(CLOSE.policy);
        return;
      }
      this.join(connection, message.city, now);
      return;
    }

    if (message === null || message.t === 'join') {
      this.invalid(connection, 'invalid_input', text === null ? null : seqOf(text));
      return;
    }

    const seq = 'seq' in message ? message.seq : null;
    if (!connection.overall.take(1, now)) {
      this.invalid(connection, 'rate_limited', seq);
      return;
    }
    connection.acted(message, now);
    // Cursor messages beyond theirs are dropped, without a word (they count all the same, above)
    if (message.t === 'cursor' && !connection.cursor.take(1, now))
      return;

    if (message.t === 'chat' && !connection.chat.take(1, now)) {
      connection.error('rate_limited', seq);
      return;
    }

    if (connection.room)
      this.rooms.command(connection.room, connection, message);
  }

  private join(connection: Connection, cityId: string, now: number): void {
    const city = this.cities.byPublicId(cityId);
    const member = city ? this.cities.member(city.id, connection.userId) : null;
    if (!city || !member) {
      connection.error('not_found');
      connection.close(CLOSE.policy);
      return;
    }

    let room: Room;
    try {
      room = this.rooms.open(city, connection.userId);
    } catch (error) {
      if (!(error instanceof RoomRefusal))
        throw error;
      connection.error(error.code);
      connection.close(error.code === 'internal' ? CLOSE.internal :
                       error.code === 'not_found' ? CLOSE.policy : CLOSE.tryAgain);
      return;
    }

    connection.joined = true;
    if (connection.joinTimer !== null) {
      clearTimeout(connection.joinTimer);
      connection.joinTimer = null;
    }
    connection.room = room;
    connection.active = now;
    this.cities.setPlayed(city.id, now);
    this.rooms.join(room, connection);
  }

  // A user's tool budget is kept while they are connected, and until it is full again (connecting anew does not
  // refill it)
  private forgetToolBudget(userId: number): void {
    const tools = this.userTools.get(userId);
    if (tools && !this.byUser.has(userId) && tools.isFull(this.context.clock.now()))
      this.userTools.delete(userId);
  }

  // Every 25 s: connections that did not answer the last ping are closed, so are those that do not read what they are
  // sent (a quiet city sends them nothing that would show it); sessions that ended are told, and players who did
  // nothing for a long while
  heartbeat(): void {
    for (const userId of [...this.userTools.keys()])
      this.forgetToolBudget(userId);

    const now = this.context.clock.now();
    for (const connection of [...this.connections]) {
      if (connection.closing || connection.ws.readyState !== WebSocket.OPEN)
        continue;
      if (!connection.alive) {
        connection.ws.terminate();
        continue;
      }
      if (!connection.keepsUp())
        continue;
      connection.alive = false;
      connection.ws.ping();

      if (!this.context.auth.sessions.resolveHash(connection.tokenHash))
        this.kick(connection, 'session');
      else if (connection.joined && now - connection.active >= this.options.idleTimeoutMs)
        this.kick(connection, 'idle');
    }
  }

  private kick(connection: Connection, reason: KickReason, code: number = CLOSE.normal): void {
    if (connection.room) {
      this.rooms.leave(connection.room, connection);
      connection.room = null;
    }
    connection.kick(reason, code);
  }

  private revoked(revocation: SessionRevocation): void {
    for (const connection of [...(this.byUser.get(revocation.userId) ?? [])]) {
      if (revokes(revocation, connection.userId, connection.tokenHash))
        this.kick(connection, 'session');
    }
  }

  // The user's connections (their sockets close at once)
  connectionsOf(userId: number): number {
    return this.byUser.get(userId)?.size ?? 0;
  }

  // The server stops: no new connection; those still open after the rooms told them are closed within a second
  async shutdown(): Promise<void> {
    this.stopped = true;
    clearInterval(this.pingTimer);
    this.stopRevocations();

    for (const connection of this.connections) {
      if (!connection.room)
        connection.close(CLOSE.goingAway);
    }

    const open = [...this.connections];
    await Promise.race([
      Promise.all(open.map(connection => new Promise<void>(resolve => {
        if (connection.ws.readyState === WebSocket.CLOSED)
          resolve();
        else
          connection.ws.once('close', () => resolve());
      }))),
      new Promise<void>(resolve => setTimeout(resolve, 1000).unref()),
    ]);
    for (const connection of this.connections)
      connection.ws.terminate();
  }
}
