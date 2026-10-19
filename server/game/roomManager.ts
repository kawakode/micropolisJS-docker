/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { IntervalHistogram, monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { Clock } from '../clock';
import type { Logger } from '../log';
import type { RateLimiter } from '../security/rateLimit';
import { CityRow, CityStore, decodeState } from './cityStore';
import { CLOSE, CommandMessage, ErrorCode, KickReason } from './protocol';
import type { RegionLink } from './regionLink';
import { Room, RoomClient } from './room';

// The open shared cities (DESIGN §5.5). One loop, about 60 frames a second, serves every room in turn, starting from
// a different room at each frame, with at most 8 ms of their work per frame: when that is used up, the other rooms
// wait for the next frame (their cities run slower). Rooms step only while players are connected; a room no one is
// connected to is saved, and closed after a minute (at once when MAX_ROOMS are open and another city is to open).
//
// The server watches its own load: when the event loop is late (p99 of its delay above 100 ms over the last second),
// no new city is opened (server_busy); when the rooms took more than half of the last second, every city runs at the
// medium speed at most, and no new city is opened, until they take less than 30%.
//
// Each room's work is guarded: an exception closes the room WITHOUT saving it (its state may be broken), and its
// players are told (kicked, reason error). Cities are saved every minute when they changed, when the last player
// leaves, when they close and when the server stops; a save that finds no row (the city was deleted meanwhile, by
// another process) closes the room.
//
// Another process may change the database under an open room: the admin command user delete deletes an account with
// its cities, takes the cities of its regions out of them and ends their deals with its cities, in the stored saves
// only. So every 2 s, and before each save, a room is checked against the database (see recheck): a city that is gone
// closes its room (kicked, reason deleted), its members are read again (those removed are kicked), and the cities
// beside it are looked at again (a side whose city changed ends its deals, see Room.setRemotes). What the room then
// saves is what the database says, not what it held before.

export const FRAME_MS = 16;
export const FRAME_BUDGET_MS = 8;

export interface RoomManagerOptions {
  maxRooms: number;
  // How long a room no one is connected to stays open, and how often a changed city is saved (by the clock)
  unloadGraceMs: number;
  saveIntervalMs: number;
  // Whether the frames run by themselves (tests call frame() instead)
  frameLoop: boolean;
  // Random numbers per city (tests)
  random?: (cityId: number) => () => number;
}

export const DEFAULT_ROOM_OPTIONS: Omit<RoomManagerOptions, 'maxRooms'> = {
  unloadGraceMs: 60 * 1000,
  saveIntervalMs: 60 * 1000,
  frameLoop: true,
};

export interface RoomManagerDeps {
  clock: Clock;
  log: Logger;
  cities: CityStore;
  buildId: string;
  // 5 rooms opened per minute per user
  loads: RateLimiter;
  // Set once the region link exists
  link: () => RegionLink;
}

// Why a room could not be opened
export class RoomRefusal extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'RoomRefusal';
  }
}

// The server's load, over the last second
export class LoadMonitor {
  // The rooms run at the medium speed at most
  overloaded = false;
  // No new room is opened
  refuseLoads = false;

  private busyMs = 0;
  private windowStart: number;
  private readonly histogram: IntervalHistogram | null;

  constructor(private readonly log: Logger, now: number, watchEventLoop = true) {
    this.windowStart = now;
    this.histogram = watchEventLoop ? monitorEventLoopDelay({resolution: 20}) : null;
    this.histogram?.enable();
  }

  // A new start (the rooms' loop starts again after a time without rooms): nothing of before counts
  reset(now: number): void {
    this.busyMs = 0;
    this.windowStart = now;
    this.overloaded = false;
    this.refuseLoads = false;
    this.histogram?.reset();
  }

  // Time spent on the rooms (ms, by performance.now())
  addBusy(ms: number): void {
    this.busyMs += ms;
  }

  // Once a second: what the last second was like
  update(now: number, p99Ms = this.eventLoopP99()): void {
    const elapsed = now - this.windowStart;
    if (elapsed < 1000)
      return;

    const busy = this.busyMs / elapsed;
    this.busyMs = 0;
    this.windowStart = now;
    this.histogram?.reset();

    this.refuseLoads = p99Ms > 100;
    if (!this.overloaded && busy > 0.5) {
      this.overloaded = true;
      this.log.warn('rooms.overload', {busy: Math.round(busy * 100), message: 'Cities take more than half of the ' +
                                       'server\'s time: they run at the medium speed at most'});
    } else if (this.overloaded && busy < 0.3) {
      this.overloaded = false;
      this.log.info('rooms.overload_end', {busy: Math.round(busy * 100)});
    }
  }

  private eventLoopP99(): number {
    return this.histogram ? this.histogram.percentile(99) / 1e6 : 0;
  }

  stop(): void {
    this.histogram?.disable();
  }
}

export class RoomManager {
  readonly rooms = new Map<number, Room>();
  readonly monitor: LoadMonitor;
  private readonly options: RoomManagerOptions;
  private rotation = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly deps: RoomManagerDeps, options: RoomManagerOptions) {
    this.options = options;
    this.monitor = new LoadMonitor(deps.log, performance.now(), options.frameLoop);
  }

  get(cityId: number): Room | undefined {
    return this.rooms.get(cityId);
  }

  // How many players are connected to a city
  online(cityId: number): number {
    return this.rooms.get(cityId)?.online ?? 0;
  }

  // The room of a city, opened if need be (the user is a member of it). Throws RoomRefusal.
  open(row: CityRow, userId: number): Room {
    const existing = this.rooms.get(row.id);
    if (existing)
      return existing;

    // Without rooms, their loop stopped and the monitor with it: what it last saw does not count (see startLoop)
    if (this.rooms.size === 0)
      this.monitor.reset(performance.now());
    // A full server closes the room no one is connected to since the longest, if there is one
    const spare = this.rooms.size >= this.options.maxRooms ? this.longestEmpty() : null;
    if (this.stopped || this.monitor.refuseLoads || this.monitor.overloaded ||
        (this.rooms.size >= this.options.maxRooms && spare === null))
      throw new RoomRefusal('server_busy');
    if (!this.deps.loads.hit(String(userId)).allowed)
      throw new RoomRefusal('rate_limited');
    if (spare !== null)
      this.unload(spare, this.deps.clock.now(), 'full');

    const {cities, clock, log} = this.deps;
    let room: Room;
    try {
      const state = cities.state(row.id);
      if (!state)
        throw new RoomRefusal('not_found');
      room = new Room({
        cities,
        buildId: this.deps.buildId,
        onEdgeChanged: changed => this.deps.link().edgeChanged(changed),
        recheck: target => this.recheck(target),
      }, {
        row,
        save: decodeState(state),
        ownerName: cities.ownerName(row),
        members: cities.members(row.id),
        now: clock.now(),
        random: this.options.random?.(row.id),
      });
    } catch (error) {
      if (error instanceof RoomRefusal)
        throw error;
      log.error('room.load_error', {city: row.public_id, err: error});
      throw new RoomRefusal('internal');
    }

    this.rooms.set(row.id, room);
    this.guard(room, () => this.deps.link().refresh(room));
    if (!this.rooms.has(row.id))
      throw new RoomRefusal('internal');
    log.info('room.open', {city: row.public_id, rooms: this.rooms.size});
    this.startLoop();
    return room;
  }

  // Runs some of a room's work: an exception closes it without saving it
  guard(room: Room, work: () => void): void {
    try {
      work();
    } catch (error) {
      this.deps.log.error('room.error', {city: room.publicId, err: error});
      this.drop(room, 'error', CLOSE.internal);
    }
  }

  // Whether the room is still open (a room closed by an error or a deletion is never saved again)
  private isOpen(room: Room): boolean {
    return this.rooms.get(room.id) === room;
  }

  join(room: Room, client: RoomClient): void {
    if (!this.isOpen(room)) {
      client.kick('error', CLOSE.internal);
      return;
    }
    this.guard(room, () => room.join(client, this.deps.clock.now()));
  }

  leave(room: Room, client: RoomClient): void {
    const now = this.deps.clock.now();
    if (!this.isOpen(room)) {
      room.leave(client, now);
      return;
    }
    this.guard(room, () => {
      if (room.leave(client, now) && room.dirty)
        this.save(room, now);
    });
  }

  command(room: Room, client: RoomClient, message: CommandMessage): void {
    if (this.isOpen(room))
      this.guard(room, () => room.command(client, message, this.deps.clock.now()));
  }

  // Closes a room without saving it, its players kicked
  drop(room: Room, reason: KickReason, code: number): void {
    if (!this.isOpen(room))
      return;
    this.rooms.delete(room.id);
    room.kickAll(reason, code, this.deps.clock.now());
    this.deps.log.info('room.close', {city: room.publicId, reason, rooms: this.rooms.size});
    this.stopLoopIfIdle();
  }

  // A room checked against the database, which another process may have changed: a city that is gone closes its room
  // (without a save); the members and the cities beside it are read again. Returns whether the room is still open.
  private recheck(room: Room): boolean {
    const {cities, clock, log} = this.deps;
    if (cities.byId(room.id) === null) {
      log.info('room.gone', {city: room.publicId});
      this.drop(room, 'deleted', CLOSE.normal);
      return false;
    }

    room.checkMembers(cities.members(room.id), clock.now());
    this.deps.link().refresh(room);
    return this.isOpen(room);
  }

  // Saves a room's city, once checked against the database; a city that is gone closes its room
  private save(room: Room, now: number): void {
    if (this.recheck(room) && !room.save(now)) {
      this.deps.log.info('room.gone', {city: room.publicId});
      this.drop(room, 'deleted', CLOSE.normal);
    }
  }

  // The cities are about to be deleted (or their rows were): their rooms close without saving
  evict(cityIds: Iterable<number>, reason: KickReason): void {
    for (const id of cityIds) {
      const room = this.rooms.get(id);
      if (room)
        this.drop(room, reason, CLOSE.normal);
    }
  }

  // A player's connections to a city end (removed from it, or left it)
  kickMember(cityId: number, userId: number, reason: KickReason): void {
    const room = this.rooms.get(cityId);
    if (room)
      this.guard(room, () => room.kickUser(userId, reason, CLOSE.normal, this.deps.clock.now()));
  }

  // The members of a city changed (roles, new and removed members)
  membersChanged(cityId: number): void {
    const room = this.rooms.get(cityId);
    if (room)
      this.guard(room, () => room.membersChanged(this.deps.cities.members(cityId), this.deps.clock.now()));
  }

  // The city has another owner: its members (and their roles) are read again
  ownerChanged(cityId: number, ownerName: string): void {
    const room = this.rooms.get(cityId);
    if (room)
      this.guard(room, () => {
        room.ownerName = ownerName;
        room.membersChanged(this.deps.cities.members(cityId), this.deps.clock.now());
      });
  }

  renamed(cityId: number, name: string): void {
    const room = this.rooms.get(cityId);
    if (room)
      this.guard(room, () => room.renamed(name));
  }

  // One frame: the rooms' work within the budget, then saves and closes due
  frame(): void {
    const started = performance.now();
    const now = this.deps.clock.now();
    const rooms = [...this.rooms.values()];
    const overloaded = this.monitor.overloaded;

    if (rooms.length > 0) {
      const start = this.rotation % rooms.length;
      this.rotation = (start + 1) % rooms.length;
      for (let i = 0; i < rooms.length; i++) {
        if (performance.now() - started >= FRAME_BUDGET_MS)
          break;
        const room = rooms[(start + i) % rooms.length];
        if (this.rooms.get(room.id) === room)
          this.guard(room, () => room.frame(now, overloaded));
      }
    }

    this.housekeeping(now);

    const spent = performance.now() - started;
    this.monitor.addBusy(spent);
    this.monitor.update(performance.now());
    if (spent > FRAME_MS)
      this.deps.log.security('loop.overrun', 'rooms', {ms: Math.round(spent), rooms: this.rooms.size});
  }

  // At most one save per frame: a changed city every minute; a room no one is connected to closes after a minute
  private housekeeping(now: number): void {
    let saved = false;
    for (const room of [...this.rooms.values()]) {
      if (room.clients.size === 0) {
        if (room.emptySince !== null && now - room.emptySince >= this.options.unloadGraceMs)
          this.unload(room, now);
      } else if (!saved && room.dirty && now - room.lastSaveAt >= this.options.saveIntervalMs) {
        saved = true;
        this.guard(room, () => this.save(room, now));
      }
    }
  }

  // The room no one is connected to since the longest, or null. When the server is full, it closes for a city to open,
  // rather than at the end of its minute: such rooms only spare their players a load when they come back, and a player
  // could otherwise hold many cities open, joining each of them now and then.
  private longestEmpty(): Room | null {
    let oldest: Room | null = null;
    for (const room of this.rooms.values()) {
      if (room.clients.size === 0 && room.emptySince !== null &&
          (oldest === null || room.emptySince < (oldest.emptySince as number)))
        oldest = room;
    }
    return oldest;
  }

  private unload(room: Room, now: number, reason = 'idle'): void {
    this.guard(room, () => {
      if (room.dirty && this.recheck(room))
        room.save(now);
    });
    if (this.rooms.get(room.id) === room) {
      this.rooms.delete(room.id);
      this.deps.log.info('room.close', {city: room.publicId, reason, rooms: this.rooms.size});
    }
    this.stopLoopIfIdle();
  }

  private startLoop(): void {
    if (!this.options.frameLoop || this.timer !== null || this.stopped)
      return;
    this.monitor.reset(performance.now());
    this.timer = setInterval(() => this.frame(), FRAME_MS);
    this.timer.unref();
  }

  private stopLoopIfIdle(): void {
    if (this.rooms.size === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // The server stops: every city saved, every player told
  shutdown(): void {
    this.stopped = true;
    const now = this.deps.clock.now();
    for (const room of [...this.rooms.values()]) {
      try {
        if (this.recheck(room))
          room.save(now);
      } catch (error) {
        this.deps.log.error('room.save_error', {city: room.publicId, err: error});
      }
      room.kickAll('shutdown', CLOSE.goingAway, now);
      this.rooms.delete(room.id);
    }
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.monitor.stop();
  }
}
