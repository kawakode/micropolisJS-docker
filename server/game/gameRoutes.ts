/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { AppContext } from '../app';
import { releaseAccount } from './accounts';
import { CityStore, PALETTE, yearOf } from './cityStore';
import { registerLobbyRoutes } from './lobbyRoutes';
import { RegionLink } from './regionLink';
import { RegionStore } from './regionStore';
import { DEFAULT_ROOM_OPTIONS, RoomManager, RoomManagerOptions } from './roomManager';
import { DEFAULT_WS_OPTIONS, GameSocketServer, WS_PATH, WsOptions } from './wsServer';

// Multiplayer (DESIGN §5): the lobby's routes, the rooms of the shared cities, the regions, and the WebSocket at
// /api/ws, put together and registered with the app. Also:
//   - deleting an account (auth.onAccountDeleting, inside its transaction): its cities' rooms close without saving
//     (kicked, deleted), its regions' cities leave them, and the cities beside its cities lose their deals with them
//   - the account's export gains its cities, regions, memberships and invitations
//   - at shutdown, every open city is saved and its players told (kicked, shutdown)

export interface GameOptions {
  rooms: Partial<Omit<RoomManagerOptions, 'maxRooms'>>;
  ws: Partial<WsOptions>;
}

export interface GameServices {
  readonly cities: CityStore;
  readonly regions: RegionStore;
  readonly rooms: RoomManager;
  readonly link: RegionLink;
  readonly sockets: GameSocketServer;
}

const MINUTE = 60 * 1000;

const isoTime = (time: number | null) => time === null ? null : new Date(time).toISOString();

export function registerGameRoutes(context: AppContext, options: Partial<GameOptions> = {}): GameServices {
  const {auth, clock, config, db, log} = context;
  const cities = new CityStore(db);
  const regions = new RegionStore(db);

  let link: RegionLink | null = null;
  const rooms = new RoomManager({
    clock,
    log,
    cities,
    buildId: config.buildId,
    loads: context.userLimiter('room-loads', 5, MINUTE),
    link: () => link as RegionLink,
  }, {...DEFAULT_ROOM_OPTIONS, ...options.rooms, maxRooms: config.maxRooms});
  link = new RegionLink(db, cities, clock, rooms);

  const sockets = new GameSocketServer(context, rooms, cities, {...DEFAULT_WS_OPTIONS, ...options.ws});
  context.setUpgradeHandler(WS_PATH, upgrade => sockets.handleUpgrade(upgrade));

  const services: GameServices = {cities, regions, rooms, link, sockets};
  registerLobbyRoutes(context, services);

  // Deleting an account, in its transaction, before its rows go (they take its cities and regions along)
  auth.onAccountDeleting(userId => {
    const regionLink = link as RegionLink;
    let owned: number[] = [];
    const {touched, memberships} = releaseAccount({cities, regions, link: regionLink, clock}, userId,
                                                  ids => { owned = ids; });

    // Its cities close, and the cities beside and those it was a member of see it go, once it is gone (not if the
    // transaction is rolled back)
    setImmediate(() => {
      try {
        rooms.evict(owned.filter(id => cities.byId(id) === null), 'deleted');
        regionLink.refreshAround(touched.filter(id => cities.byId(id) !== null));
        for (const id of memberships)
          rooms.membersChanged(id);
      } catch (error) {
        log.error('game.account_deleted', {err: error});
      }
    });
  });

  auth.addExportSection('cities', userId => cities.ownedBy(userId).map(city => {
    const region = city.region_id === null ? null : regions.byId(city.region_id);
    return {
      id: city.public_id,
      name: city.name,
      population: city.population,
      year: yearOf(city.city_time),
      createdAt: isoTime(city.created_at),
      updatedAt: isoTime(city.updated_at),
      playedAt: isoTime(city.played_at),
      region: region ? {id: region.public_id, name: region.name, x: city.region_x, y: city.region_y} : null,
      members: cities.members(city.id).map(member => ({id: member.public_id, username: member.username,
                                                       role: member.role})),
    };
  }));

  auth.addExportSection('regions', userId => regions.ownedBy(userId).map(region => ({
    id: region.public_id,
    name: region.name,
    width: region.width,
    height: region.height,
    public: region.is_public === 1,
    createdAt: isoTime(region.created_at),
    members: regions.members(region.id).map(member => ({id: member.public_id, username: member.username})),
  })));

  auth.addExportSection('memberships', userId => ({
    cities: db.all<{public_id: string; name: string; role: string; colour: number; joined_at: number}>(
      `SELECT c.public_id, c.name, m.role, m.colour, m.joined_at FROM city_members m JOIN cities c ON c.id = m.city_id
       WHERE m.user_id = ? ORDER BY m.joined_at`, userId).map(row => ({
      id: row.public_id, name: row.name, role: row.role, colour: PALETTE[row.colour] ?? PALETTE[0],
      joinedAt: isoTime(row.joined_at),
    })),
    regions: db.all<{public_id: string; name: string; joined_at: number}>(
      `SELECT r.public_id, r.name, m.joined_at FROM region_members m JOIN regions r ON r.id = m.region_id
       WHERE m.user_id = ? ORDER BY m.joined_at`, userId).map(row => ({
      id: row.public_id, name: row.name, joinedAt: isoTime(row.joined_at),
    })),
    // The regions whose owner removed the player: they do not join them again without an invitation
    removedFrom: db.all<{public_id: string; name: string; removed_at: number}>(
      `SELECT r.public_id, r.name, x.removed_at FROM region_removals x JOIN regions r ON r.id = x.region_id
       WHERE x.user_id = ? ORDER BY x.removed_at`, userId).map(row => ({
      id: row.public_id, name: row.name, removedAt: isoTime(row.removed_at),
    })),
  }));

  auth.addExportSection('invitations', userId => {
    const list = (direction: 'invitee_id' | 'inviter_id', other: 'invitee_id' | 'inviter_id') => db.all<{
      public_id: string; kind: string; target: string; target_name: string; username: string; role: string | null;
      created_at: number}>(
      `SELECT i.public_id, 'city' AS kind, c.public_id AS target, c.name AS target_name, u.username, i.role,
              i.created_at AS created_at
       FROM city_invitations i JOIN cities c ON c.id = i.city_id JOIN users u ON u.id = i.${other}
       WHERE i.${direction} = ?
       UNION ALL
       SELECT i.public_id, 'region' AS kind, r.public_id AS target, r.name AS target_name, u.username, NULL AS role,
              i.created_at AS created_at
       FROM region_invitations i JOIN regions r ON r.id = i.region_id JOIN users u ON u.id = i.${other}
       WHERE i.${direction} = ?
       ORDER BY created_at`, userId, userId).map(row => ({
      id: row.public_id, kind: row.kind, target: {id: row.target, name: row.target_name}, username: row.username,
      role: row.role, createdAt: isoTime(row.created_at),
    }));
    return {received: list('invitee_id', 'inviter_id'), sent: list('inviter_id', 'invitee_id')};
  });

  // At shutdown: every open city saved, its players told; then the other connections closed
  context.onShutdown(async () => {
    rooms.shutdown();
    await sockets.shutdown();
  });

  return services;
}
