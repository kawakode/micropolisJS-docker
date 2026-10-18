/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { CityState } from './cityState';
import { CityRow, CityStore, encodeState, MemberRow, PALETTE, Role } from './cityStore';
import { CitySave, createHeadlessCity, EdgeState, HeadlessCity, SPRITE_STEP_MS } from './headless';
import { ChatEntry, CLOSE, CommandMessage, CursorEntry, ErrorCode, KickReason, PlayerEntry, SIDES } from './protocol';
import { takeFromAll, TokenBucket } from './tokenBucket';

// A shared city while it is open on the server (DESIGN §5.5): the city simulated by the server (see headless.ts), the
// players connected to it, and what they are sent (see cityState.ts for how the changes are worked out).
//
// The room manager (roomManager.ts) calls frame() about 60 times a second while players are connected: the city
// steps at its speed's interval (at most 2 steps of delay are caught up, the rest is dropped: a busy server makes
// cities slower, never late), its sprites move 60 times a second (at most 4 moves caught up), and 10 times a second
// the room sends what changed:
//   tiles      {c: [index, raw, ...], r: [index, roadClass, ...]}     when tiles changed
//   state      {state: {the scalars that changed}}                   at most 4 times a second
//   sprites    {s: [[id, type, frame, x, y], ...]}                  while there are sprites, and once when they go
//   msg        {subject, data}                                       the city's messages (each milestone once)
//   cursors    {list: [[id, x, y, tool, ax, ay], ...]}               every cursor shown, when one changed
//   stats      {stats: {evaluation, budget, census, historyTime, cityStatus, neighbours}}  each month (and after a
//              command that changes them), at most twice a second
//   maps       {maps: {name: [values]}}                              the overlays that changed, every 2 s, not paused
// Commands are answered at once: toolResult (after the tiles it changed were sent to everyone) and action to the
// others, ok (budget, settings, disaster, deal, speed, pause), or error. A player joining gets a welcome; the others
// get the list of players. Sprites and cursors may be skipped for a connection that does not keep up.
//
// Who may do what (DESIGN §5.1): viewers watch, chat and show their cursor; players also build, set the budget, the
// speed, the city's settings and the deals with the neighbours; only the owner unleashes disasters and turns them on
// or off.

// What the room needs of a connection (see wsServer.ts)
export interface RoomClient {
  readonly userId: number;
  // The tool budgets of the connection and of its user (in placements)
  readonly toolBuckets: readonly TokenBucket[];
  send(message: object): void;
  // A message already turned to text; a skippable one is not sent to a connection that is behind
  sendText(text: string, skippable?: boolean): void;
  // Sends {t: 'kicked', reason} and closes the connection
  kick(reason: KickReason, code: number): void;
}

// Where the city is, in a region
export interface RoomPlacement {
  regionId: number;
  publicId: string;
  name: string;
  x: number;
  y: number;
}

// A player's city beside this one in a region, as Neighbours.setRemote takes it
export interface RemoteInfo {
  cityId: string;
  name: string;
  ownerName: string;
  population: number;
  edge: EdgeState;
}

export interface RoomDeps {
  cities: CityStore;
  buildId: string;
  // The city's edges changed (after a scan of the power grid, or a deal): the cities beside it are told
  onEdgeChanged(room: Room): void;
  // The room checked against the database (see RoomManager.recheck): the city's row, its members and the cities beside
  // it. False when the room closed (the city is gone).
  recheck(room: Room): boolean;
}

export interface RoomOptions {
  row: CityRow;
  save: CitySave;
  ownerName: string;
  members: readonly MemberRow[];
  now: number;
  random?: () => number;
}

export const ROOM_TIMING = Object.freeze({
  // The pass that sends the changes
  passMs: 100,
  stateMs: 250,
  statsMs: 500,
  mapsMs: 2000,
  // How often the room is checked against the database: the city still there, its members, and the cities beside it
  // (their population changes)
  recheckMs: 2000,
  // Steps and sprite moves caught up at most in a frame
  maxStepDebt: 2,
  maxSpriteMoves: 4,
  // The step interval of a city when the server is overloaded: the medium speed's at least
  overloadedStepMs: 50,
});

// Tool commands, counted in placements: per connection and per user (the same), and per room
export const TOOL_BUCKETS = Object.freeze({
  connection: {burst: 4096, perSecond: 2048},
  room: {burst: 8192, perSecond: 4096},
});

export const CHAT_HISTORY = 50;

// The phase of the simulation's cycle that scans the power grid (see Simulation._simulate)
const POWER_SCAN_PHASE = 11;

const sameEdges = (a: Record<string, EdgeState>, b: Record<string, EdgeState>) => JSON.stringify(a) === JSON.stringify(b);

export class Room {
  readonly id: number;
  readonly publicId: string;
  name: string;
  ownerName: string;
  readonly city: HeadlessCity;
  readonly clients = new Set<RoomClient>();
  placement: RoomPlacement | null = null;
  // What the city has at its edges (saved with the city)
  edge: Record<string, EdgeState>;

  // Whether the city changed since it was last saved, and when that was
  dirty = false;
  lastSaveAt: number;
  // Since when no one is connected (null while someone is)
  emptySince: number | null;

  private readonly deps: RoomDeps;
  private readonly state: CityState;
  private readonly members = new Map<number, MemberRow>();
  private readonly chat: ChatEntry[] = [];
  private readonly cursors = new Map<number, CursorEntry>();
  private cursorsChanged = false;
  private readonly toolBucket = new TokenBucket(TOOL_BUCKETS.room.burst, TOOL_BUCKETS.room.perSecond);
  private readonly remoteKeys: Record<string, string> = {};
  // The player's city on each side at the last look (null: none), once the room looked
  private readonly remoteCities: Record<string, string | null> = {};

  private nextStepAt: number;
  private spriteAt: number;
  private lastPassAt: number;
  private lastStateAt: number;
  private lastStatsAt = -Infinity;
  private statsMonth: number;
  private statsDirty = false;
  private lastMapsAt: number;
  private lastRecheckAt: number;

  constructor(deps: RoomDeps, options: RoomOptions) {
    const {row, now} = options;
    this.deps = deps;
    this.id = row.id;
    this.publicId = row.public_id;
    this.name = row.name;
    this.ownerName = options.ownerName;
    this.city = createHeadlessCity(options.save, {paused: row.paused !== 0, random: options.random});
    this.city.name = row.name;
    this.state = new CityState(this.city);
    this.edge = this.city.edgeState();
    this.setMembers(options.members);

    this.lastSaveAt = now;
    this.emptySince = now;
    this.nextStepAt = now;
    this.spriteAt = now;
    this.lastPassAt = now;
    this.lastStateAt = now;
    this.lastMapsAt = now;
    this.lastRecheckAt = now;
    this.statsMonth = this.month();
  }

  private month(): number {
    const date = this.city.simulation.getDate();
    return date.year * 12 + date.month;
  }

  // Players

  private setMembers(members: readonly MemberRow[]): void {
    this.members.clear();
    for (const member of members)
      this.members.set(member.user_id, member);
  }

  member(userId: number): MemberRow | null {
    return this.members.get(userId) ?? null;
  }

  // How many players are connected
  get online(): number {
    return new Set([...this.clients].map(client => client.userId)).size;
  }

  private isOnline(userId: number): boolean {
    for (const client of this.clients) {
      if (client.userId === userId)
        return true;
    }
    return false;
  }

  players(): PlayerEntry[] {
    return [...this.members.values()].map(member => ({
      id: member.public_id,
      username: member.username,
      role: member.role,
      colour: PALETTE[member.colour] ?? PALETTE[0],
      online: this.isOnline(member.user_id),
    }));
  }

  private broadcastPlayers(except: RoomClient | null = null): void {
    this.broadcast({t: 'players', list: this.players()}, {except});
  }

  // A player connects: what changed is sent to the others first, so that the welcome is the city they all have
  join(client: RoomClient, now: number): void {
    const member = this.members.get(client.userId);
    if (!member) {
      client.kick('removed', CLOSE.normal);
      return;
    }

    this.flushAll(now);
    if (this.clients.size === 0) {
      // The city did not run while no one was there: it goes on from now
      this.nextStepAt = now;
      this.spriteAt = now;
    }
    this.clients.add(client);
    this.emptySince = null;
    client.send(this.welcome(member));
    this.broadcastPlayers(client);
    // The newcomer sees the others' pointers at the next pass, even those that do not move
    if (this.cursors.size > 0)
      this.cursorsChanged = true;
  }

  private welcome(member: MemberRow): object {
    const parts = this.state.welcome();
    const placement = this.placement;
    return {
      t: 'welcome',
      build: this.deps.buildId,
      you: {id: member.public_id, username: member.username, role: member.role,
            colour: PALETTE[member.colour] ?? PALETTE[0]},
      city: {id: this.publicId, name: this.name, ownerName: this.ownerName,
             region: placement ? {id: placement.publicId, name: placement.name, x: placement.x, y: placement.y} : null},
      save: parts.save,
      state: parts.state,
      stats: parts.stats,
      maps: parts.maps,
      sprites: parts.sprites,
      players: this.players(),
      chat: this.chat,
    };
  }

  // A connection went away (or was kicked). Returns whether the room is now empty.
  leave(client: RoomClient, now: number): boolean {
    if (!this.clients.delete(client))
      return this.clients.size === 0;

    if (!this.isOnline(client.userId) && this.cursors.delete(client.userId))
      this.cursorsChanged = true;
    this.broadcastPlayers();
    if (this.clients.size === 0)
      this.emptySince = now;
    return this.clients.size === 0;
  }

  // Ends the connections of a player (removed from the city, or logged out)
  kickUser(userId: number, reason: KickReason, code: number, now: number): void {
    for (const client of [...this.clients]) {
      if (client.userId === userId) {
        this.leave(client, now);
        client.kick(reason, code);
      }
    }
  }

  // Ends every connection (the city is deleted, or the server stops)
  kickAll(reason: KickReason, code: number, now: number): void {
    for (const client of [...this.clients]) {
      this.clients.delete(client);
      client.kick(reason, code);
    }
    this.cursors.clear();
    this.emptySince = now;
  }

  // The members as the database has them: taken when they are not those the room knows (another process changed them)
  checkMembers(members: readonly MemberRow[], now: number): void {
    const same = members.length === this.members.size && members.every(member => {
      const known = this.members.get(member.user_id);
      return known !== undefined && known.role === member.role && known.colour === member.colour &&
             known.username === member.username;
    });
    if (!same)
      this.membersChanged(members, now);
  }

  // The members changed (someone joined, left, or got another role): the members are read again
  membersChanged(members: readonly MemberRow[], now: number): void {
    const before = new Map(this.members);
    this.setMembers(members);

    for (const [userId, old] of before) {
      const member = this.members.get(userId);
      if (!member) {
        this.kickUser(userId, 'removed', CLOSE.normal, now);
        continue;
      }
      if (member.role !== old.role) {
        for (const client of this.clients) {
          if (client.userId === userId)
            client.send({t: 'roleChanged', role: member.role});
        }
      }
    }
    this.broadcastPlayers();
  }

  renamed(name: string): void {
    this.name = name;
    this.city.name = name;
    this.dirty = true;
    this.broadcast({t: 'renamed', name});
  }

  // Sending

  // Turned to text once for everyone
  broadcast(message: object, options: {except?: RoomClient | null; skippable?: boolean;
                                       to?: (member: MemberRow) => boolean} = {}): void {
    if (this.clients.size === 0)
      return;

    const text = JSON.stringify(message);
    for (const client of [...this.clients]) {
      if (client === options.except)
        continue;
      if (options.to) {
        const member = this.members.get(client.userId);
        if (!member || !options.to(member))
          continue;
      }
      client.sendText(text, options.skippable);
    }
  }

  private flushTiles(): void {
    const tiles = this.state.diffTiles();
    if (tiles !== null)
      this.broadcast({t: 'tiles', c: tiles.c, r: tiles.r});
  }

  private flushState(now: number): void {
    this.lastStateAt = now;
    const state = this.state.diffState();
    if (state !== null)
      this.broadcast({t: 'state', state});
  }

  private flushSprites(): void {
    const sprites = this.state.diffSprites();
    if (sprites !== null)
      this.broadcast({t: 'sprites', s: sprites}, {skippable: true});
  }

  // Everything that changed, now
  private flushAll(now: number): void {
    this.flushTiles();
    this.flushState(now);
    this.flushSprites();
  }

  // Time

  // About 60 times a second, while players are connected
  frame(now: number, overloaded: boolean): void {
    if (this.clients.size === 0)
      return;

    const city = this.city;
    if (city.paused) {
      this.nextStepAt = now;
      this.spriteAt = now;
    } else {
      const interval = overloaded ? Math.max(city.stepInterval(), ROOM_TIMING.overloadedStepMs) : city.stepInterval();
      // Behind by more than the steps caught up: the rest is dropped
      if (now - this.nextStepAt >= ROOM_TIMING.maxStepDebt * interval)
        this.nextStepAt = now - (ROOM_TIMING.maxStepDebt - 1) * interval;
      while (now >= this.nextStepAt) {
        this.step();
        this.nextStepAt += interval;
      }

      const due = Math.floor((now - this.spriteAt) / SPRITE_STEP_MS);
      if (due > ROOM_TIMING.maxSpriteMoves) {
        city.moveSprites(ROOM_TIMING.maxSpriteMoves);
        this.spriteAt = now;
      } else if (due > 0) {
        city.moveSprites(due);
        this.spriteAt += due * SPRITE_STEP_MS;
      }
    }

    if (now - this.lastPassAt >= ROOM_TIMING.passMs) {
      this.lastPassAt = now;
      this.pass(now);
    }
  }

  private step(): void {
    const simulation = this.city.simulation as unknown as {_phaseCycle: number};
    const scansPower = simulation._phaseCycle === POWER_SCAN_PHASE;
    const result = this.city.step();
    if (!result.stepped)
      return;

    this.dirty = true;
    if (result.budgetApplied) {
      this.statsDirty = true;
      this.broadcast({t: 'budgetApplied'}, {to: member => member.role !== 'viewer'});
    }
    if (scansPower)
      this.updateEdge();
  }

  // Ten times a second: the changes, the messages, the cursors, and now and then the stats and the overlays
  private pass(now: number): void {
    this.city.updateExplosions();
    this.flushTiles();
    if (now - this.lastStateAt >= ROOM_TIMING.stateMs)
      this.flushState(now);
    this.flushSprites();

    for (const message of this.city.takeMessages())
      this.broadcast({t: 'msg', subject: message.subject, data: message.data ?? {}});

    if (this.cursorsChanged) {
      this.cursorsChanged = false;
      this.broadcast({t: 'cursors', list: [...this.cursors.values()]}, {skippable: true});
    }

    if (now - this.lastRecheckAt >= ROOM_TIMING.recheckMs) {
      this.lastRecheckAt = now;
      if (!this.deps.recheck(this))
        return;
    }

    const month = this.month();
    if ((month !== this.statsMonth || this.statsDirty) && now - this.lastStatsAt >= ROOM_TIMING.statsMs) {
      this.statsMonth = month;
      this.statsDirty = false;
      this.lastStatsAt = now;
      this.broadcast({t: 'stats', stats: this.state.stats()});
    }

    if (!this.city.paused && now - this.lastMapsAt >= ROOM_TIMING.mapsMs) {
      this.lastMapsAt = now;
      const maps = this.state.maps(true);
      if (maps !== null)
        this.broadcast({t: 'maps', maps});
    }
  }

  // The neighbours

  // Takes the city's edges again, and tells the cities beside it when they changed (they read them from the room while
  // it is open). They are stored with the city's save, never apart: a room closed without a save (an error, a crash)
  // leaves the edges of its last save, which match the deals of that save.
  updateEdge(): void {
    const edge = this.city.edgeState();
    if (sameEdges(edge, this.edge))
      return;

    this.edge = edge;
    this.deps.onEdgeChanged(this);
  }

  // The players' cities beside this one, by side (null: the neighbour of the save). A side whose city is not the one
  // of the last look (it left, or another city took its place) ends its deals (DESIGN §5.2), whoever changed it: the
  // lobby does it too, in the same transaction, but the admin command user delete runs in a process of its own. The
  // first look, as the room opens, keeps the deals of the save.
  setRemotes(remotes: Readonly<Record<string, RemoteInfo | null>>): boolean {
    let changed = false;
    const ended: string[] = [];
    for (const side of SIDES) {
      const remote = remotes[side] ?? null;
      const cityId = remote === null ? null : remote.cityId;
      if (Object.hasOwn(this.remoteCities, side) && this.remoteCities[side] !== cityId)
        ended.push(side);
      this.remoteCities[side] = cityId;

      const key = remote === null ? '' : JSON.stringify(remote);
      if ((this.remoteKeys[side] ?? '') === key)
        continue;

      this.remoteKeys[side] = key;
      this.city.simulation.neighbours.setRemote(side, remote);
      changed = true;
    }

    if (changed)
      this.statsDirty = true;
    this.clearDeals(ended);
    return changed;
  }

  // Ends the deals with the neighbours of these sides (the city beside changed)
  clearDeals(sides: readonly string[]): void {
    if (sides.length === 0)
      return;

    for (const side of sides)
      this.city.simulation.neighbours.clearDeals(side);
    this.dirty = true;
    this.statsDirty = true;
    this.updateEdge();
  }

  // Commands

  private error(client: RoomClient, code: ErrorCode, seq: number | null): void {
    client.send(seq === null ? {t: 'error', code} : {t: 'error', code, seq});
  }

  private ok(client: RoomClient, seq: number | null): void {
    client.send(seq === null ? {t: 'ok'} : {t: 'ok', seq});
  }

  command(client: RoomClient, message: CommandMessage, now: number): void {
    const member = this.members.get(client.userId);
    if (!member || !this.clients.has(client))
      return;

    const role: Role = member.role;
    const builds = role !== 'viewer';

    switch (message.t) {
      case 'tool': {
        if (!builds) {
          this.error(client, 'forbidden', message.seq);
          return;
        }

        const placements = this.city.placementsFor(message.tool, message.from, message.to);
        if (placements === null) {
          this.error(client, 'invalid_input', message.seq);
          return;
        }
        if (!takeFromAll([...client.toolBuckets, this.toolBucket], Math.max(1, placements.length), now)) {
          this.error(client, 'rate_limited', message.seq);
          return;
        }

        const outcome = this.city.applyTool(message.tool, message.from, message.to);
        if (outcome === null) {
          this.error(client, 'invalid_input', message.seq);
          return;
        }

        this.dirty = true;
        // The tiles first: the player sees the result and the tiles together
        this.flushTiles();
        this.flushState(now);
        const result: Record<string, unknown> = {t: 'toolResult', applied: outcome.applied, failed: outcome.failed,
                                                 reason: outcome.reason, cost: outcome.cost};
        if (message.seq !== null)
          result.seq = message.seq;
        client.send(result);

        if (outcome.applied > 0)
          this.broadcast({t: 'action', by: {id: member.public_id, username: member.username}, tool: message.tool,
                          count: outcome.applied, x: message.to.x, y: message.to.y}, {except: client});
        return;
      }

      case 'speed':
      case 'pause': {
        if (!builds) {
          this.error(client, 'forbidden', message.seq);
          return;
        }
        if (message.t === 'speed')
          this.city.applySpeed(message.speed);
        else
          this.city.applyPaused(message.paused);
        this.dirty = true;
        this.ok(client, message.seq);
        return;
      }

      case 'budget':
        if (!builds) {
          this.error(client, 'forbidden', message.seq);
          return;
        }
        if (!this.city.applyBudget(message)) {
          this.error(client, 'invalid_input', message.seq);
          return;
        }
        this.dirty = true;
        this.statsDirty = true;
        this.ok(client, message.seq);
        return;

      case 'settings': {
        if (!builds || (message.disasters !== undefined && role !== 'owner')) {
          this.error(client, 'forbidden', message.seq);
          return;
        }
        const {autoBudget, autoBulldoze, disasters, level} = message;
        if (!this.city.applySettings({autoBudget, autoBulldoze, disasters, level})) {
          this.error(client, 'invalid_input', message.seq);
          return;
        }
        this.dirty = true;
        this.statsDirty = true;
        this.ok(client, message.seq);
        return;
      }

      case 'disaster':
        if (role !== 'owner') {
          this.error(client, 'forbidden', message.seq);
          return;
        }
        this.city.applyDisaster(message.kind);
        this.dirty = true;
        this.ok(client, message.seq);
        return;

      case 'deal':
        if (!builds) {
          this.error(client, 'forbidden', message.seq);
          return;
        }
        this.city.applyDeal(message.side, message.kind, message.signed);
        this.dirty = true;
        this.statsDirty = true;
        this.updateEdge();
        this.ok(client, message.seq);
        return;

      case 'chat': {
        const entry: ChatEntry = {from: {id: member.public_id, username: member.username,
                                         colour: PALETTE[member.colour] ?? PALETTE[0]},
                                  text: message.text, at: now};
        this.chat.push(entry);
        if (this.chat.length > CHAT_HISTORY)
          this.chat.shift();
        this.broadcast({t: 'chat', ...entry});
        return;
      }

      case 'cursor':
        if (message.x === null || message.y === null) {
          if (this.cursors.delete(client.userId))
            this.cursorsChanged = true;
        } else {
          this.cursors.set(client.userId, [member.public_id, message.x, message.y, message.tool, message.ax,
                                           message.ay]);
          this.cursorsChanged = true;
        }
        return;
    }
  }

  // Saving

  // The city written to its row. False when the row is gone (the city was deleted meanwhile).
  save(now: number): boolean {
    const saved = this.deps.cities.saveState(this.id, {
      state: encodeState(this.city.saveText()),
      population: this.city.population,
      cityTime: this.city.cityTime,
      paused: this.city.paused,
      edgeState: this.edge,
      now,
    });
    this.dirty = false;
    this.lastSaveAt = now;
    return saved;
  }
}
