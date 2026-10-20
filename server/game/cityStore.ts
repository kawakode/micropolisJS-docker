/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { gunzipSync, gzipSync } from 'node:zlib';
import type { Database } from '../db/database';
import { HttpError } from '../http/response';
import { LIMITS } from '../limits';
import { isPublicId, newPublicId } from '../security/tokens';
import type { CitySave, EdgeState } from './headless';

// The shared cities in the database: the cities, their members and the invitations to them, and who may do what
// (DESIGN §5.1). Someone who is not a member of a city is told it does not exist (404 not_found), whatever they ask:
// a city's id tells nothing to whoever is not in it. A member who asks for what their role does not allow gets 403
// forbidden.
//
// A city's state is its save: one format byte (STATE_FORMAT_GZIP_JSON) and the save's JSON, gzipped.

export type Role = 'owner' | 'player' | 'viewer';

// The roles an invitation (or a change of role) can give: a city has one owner, the player who made it
export type InvitedRole = 'player' | 'viewer';
export const INVITED_ROLES: readonly InvitedRole[] = ['player', 'viewer'];

export const isInvitedRole = (value: unknown): value is InvitedRole =>
  typeof value === 'string' && (INVITED_ROLES as readonly string[]).includes(value);

export const CITY_LIMITS = Object.freeze({
  // Cities a player owns, those of regions included (the game is told, see GET /api/session)
  ownedCities: LIMITS.ownedCities,
  // Members of a city, its owner included
  members: 16,
  // Invitations a player may hold, to cities and regions together: beyond, new ones are not made (silently)
  pendingInvitations: 20,
});

// The colours of the members of a city, as the game draws their pointers on the map and their names in the chat: easy
// to tell apart, and to read both on the map (land, trees, water) and on the game's dark windows. So they are light
// (see the tests: server/test/lobby.ts), the most distinct first. Each member of a city keeps theirs
// (city_members.colour, an index in this list).
export const PALETTE: readonly string[] = [
  '#ff8899', '#33ddff', '#ffcc00', '#dd99ff', '#33ffcc', '#ff8833', '#bbff33', '#ffddee',
  '#ccddff', '#eeee99', '#dd9911', '#ccaa99', '#bbeedd', '#cc99bb', '#ddddcc', '#aaaabb',
];

export const STATE_FORMAT_GZIP_JSON = 1;

// The most a city's state may grow to once unzipped (a save is about 250 KB)
const MAX_STATE_SIZE = 8 * 1024 * 1024;

export function encodeState(saveText: string): Buffer {
  return Buffer.concat([Buffer.from([STATE_FORMAT_GZIP_JSON]), gzipSync(saveText, {level: 6})]);
}

export function decodeStateText(state: Uint8Array): string {
  if (state.length < 2 || state[0] !== STATE_FORMAT_GZIP_JSON)
    throw new Error('unknown city state format');
  return gunzipSync(state.subarray(1), {maxOutputLength: MAX_STATE_SIZE}).toString('utf8');
}

export function decodeState(state: Uint8Array): CitySave {
  const save = JSON.parse(decodeStateText(state)) as unknown;
  if (save === null || typeof save !== 'object' || Array.isArray(save))
    throw new Error('the city state is not a save');
  return save as CitySave;
}

// A city's row, without its state
export interface CityRow {
  id: number;
  public_id: string;
  owner_id: number;
  name: string;
  population: number;
  score: number;
  city_time: number;
  paused: number;
  region_id: number | null;
  region_x: number | null;
  region_y: number | null;
  edge_state: string;
  created_at: number;
  updated_at: number;
  played_at: number | null;
}

const CITY_COLUMNS = `c.id, c.public_id, c.owner_id, c.name, c.population, c.score, c.city_time, c.paused, c.region_id,
                      c.region_x, c.region_y, c.edge_state, c.created_at, c.updated_at, c.played_at`;

// A city as the lobby lists it, for one of its members
export interface CityListing extends CityRow {
  role: Role;
  owner_name: string;
  region_public_id: string | null;
  region_name: string | null;
}

export interface MemberRow {
  user_id: number;
  public_id: string;
  username: string;
  role: Role;
  colour: number;
  joined_at: number;
}

export interface CityInvitationRow {
  id: number;
  public_id: string;
  city_id: number;
  inviter_id: number;
  invitee_id: number;
  role: InvitedRole;
  created_at: number;
}

export interface NewCity {
  ownerId: number;
  name: string;
  state: Uint8Array;
  population: number;
  score: number;
  cityTime: number;
  paused: boolean;
  edgeState: Record<string, EdgeState>;
  region: {id: number; x: number; y: number} | null;
  now: number;
}

export interface SavedState {
  state: Uint8Array;
  population: number;
  score: number;
  cityTime: number;
  paused: boolean;
  edgeState: Record<string, EdgeState>;
  now: number;
}

// The year of a city, from its time (see Simulation.getDate)
// The edges of a city as stored with its save (see Neighbours.edgeState)
export const parseEdges = (text: string): Record<string, unknown> => {
  try {
    const edges = JSON.parse(text) as unknown;
    return edges !== null && typeof edges === 'object' && !Array.isArray(edges) ? edges as Record<string, unknown> : {};
  } catch (e) {
    return {};
  }
};

export const yearOf = (cityTime: number): number => 1900 + Math.floor(cityTime / 48);

export const notFound = () => new HttpError(404, 'not_found');
export const forbidden = () => new HttpError(403, 'forbidden');

export class CityStore {
  constructor(private readonly db: Database) {}

  byId(id: number): CityRow | null {
    return this.db.get<CityRow>(`SELECT ${CITY_COLUMNS} FROM cities c WHERE c.id = ?`, id) ?? null;
  }

  byPublicId(publicId: unknown): CityRow | null {
    if (!isPublicId(publicId))
      return null;
    return this.db.get<CityRow>(`SELECT ${CITY_COLUMNS} FROM cities c WHERE c.public_id = ?`, publicId) ?? null;
  }

  state(id: number): Uint8Array | null {
    return this.db.get<{state: Uint8Array}>('SELECT state FROM cities WHERE id = ?', id)?.state ?? null;
  }

  ownerName(city: CityRow): string {
    return this.db.get<{username: string}>('SELECT username FROM users WHERE id = ?', city.owner_id)?.username ?? '';
  }

  member(cityId: number, userId: number): MemberRow | null {
    return this.db.get<MemberRow>(
      `SELECT m.user_id, u.public_id, u.username, m.role, m.colour, m.joined_at
       FROM city_members m JOIN users u ON u.id = m.user_id WHERE m.city_id = ? AND m.user_id = ?`,
      cityId, userId) ?? null;
  }

  // The city and the user's membership of it: 404 not_found when the city does not exist or the user is not in it
  forMember(publicId: unknown, userId: number): {city: CityRow; member: MemberRow} {
    const city = this.byPublicId(publicId);
    const member = city ? this.member(city.id, userId) : null;
    if (!city || !member)
      throw notFound();
    return {city, member};
  }

  // The same for what only the owner may do: 403 forbidden for the other members
  forOwner(publicId: unknown, userId: number): {city: CityRow; member: MemberRow} {
    const found = this.forMember(publicId, userId);
    if (found.member.role !== 'owner')
      throw forbidden();
    return found;
  }

  count(): number {
    return this.db.get<{n: number}>('SELECT count(*) AS n FROM cities')?.n ?? 0;
  }

  ownedCount(userId: number): number {
    return this.db.get<{n: number}>('SELECT count(*) AS n FROM cities WHERE owner_id = ?', userId)?.n ?? 0;
  }

  ownedBy(userId: number): CityRow[] {
    return this.db.all<CityRow>(`SELECT ${CITY_COLUMNS} FROM cities c WHERE c.owner_id = ? ORDER BY c.id`, userId);
  }

  // The cities the user is a member of, most recently played first
  listForUser(userId: number): CityListing[] {
    return this.db.all<CityListing>(
      `SELECT ${CITY_COLUMNS}, m.role, o.username AS owner_name, r.public_id AS region_public_id,
              r.name AS region_name
       FROM city_members m JOIN cities c ON c.id = m.city_id JOIN users o ON o.id = c.owner_id
       LEFT JOIN regions r ON r.id = c.region_id
       WHERE m.user_id = ? ORDER BY coalesce(c.played_at, c.created_at) DESC, c.id DESC`, userId);
  }

  // A new city, its owner its first member (with the first colour)
  create(city: NewCity): CityRow {
    const id = this.db.run(
      `INSERT INTO cities (public_id, owner_id, name, state, population, score, city_time, paused, region_id,
                           region_x, region_y, edge_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newPublicId(), city.ownerId, city.name, city.state, city.population, city.score, city.cityTime,
      city.paused ? 1 : 0,
      city.region?.id ?? null, city.region?.x ?? null, city.region?.y ?? null, JSON.stringify(city.edgeState),
      city.now, city.now).lastInsertRowid;
    this.db.run('INSERT INTO city_members (city_id, user_id, role, colour, joined_at) VALUES (?, ?, ?, 0, ?)', id,
                city.ownerId, 'owner', city.now);
    return this.byId(id) as CityRow;
  }

  rename(id: number, name: string, now: number): void {
    this.db.run('UPDATE cities SET name = ?, updated_at = ? WHERE id = ?', name, now, id);
  }

  delete(id: number): void {
    this.db.run('DELETE FROM cities WHERE id = ?', id);
  }

  // A room's save of its city. False when the city is gone (the room then closes).
  saveState(id: number, saved: SavedState): boolean {
    return this.db.run(
      `UPDATE cities SET state = ?, population = ?, score = ?, city_time = ?, paused = ?, edge_state = ?,
                         updated_at = ?
       WHERE id = ?`,
      saved.state, saved.population, saved.score, saved.cityTime, saved.paused ? 1 : 0, JSON.stringify(saved.edgeState), saved.now,
      id).changes === 1;
  }

  // The state of a city that is not running, changed (deals cleared when its neighbours change)
  replaceState(id: number, state: Uint8Array, edgeState: Record<string, EdgeState>, now: number): void {
    this.db.run('UPDATE cities SET state = ?, edge_state = ?, updated_at = ? WHERE id = ?', state,
                JSON.stringify(edgeState), now, id);
  }

  setPlayed(id: number, now: number): void {
    this.db.run('UPDATE cities SET played_at = ? WHERE id = ?', now, id);
  }

  setRegion(id: number, region: {id: number; x: number; y: number} | null, now: number): void {
    this.db.run('UPDATE cities SET region_id = ?, region_x = ?, region_y = ?, updated_at = ? WHERE id = ?',
                region?.id ?? null, region?.x ?? null, region?.y ?? null, now, id);
  }

  // Members

  members(cityId: number): MemberRow[] {
    return this.db.all<MemberRow>(
      `SELECT m.user_id, u.public_id, u.username, m.role, m.colour, m.joined_at
       FROM city_members m JOIN users u ON u.id = m.user_id WHERE m.city_id = ?
       ORDER BY (m.role = 'owner') DESC, m.joined_at, m.user_id`, cityId);
  }

  memberCount(cityId: number): number {
    return this.db.get<{n: number}>('SELECT count(*) AS n FROM city_members WHERE city_id = ?', cityId)?.n ?? 0;
  }

  // A new member, with the first colour no other member of the city has
  addMember(cityId: number, userId: number, role: InvitedRole, now: number): void {
    const taken = new Set(this.db.all<{colour: number}>('SELECT colour FROM city_members WHERE city_id = ?', cityId)
      .map(row => row.colour));
    let colour = 0;
    while (taken.has(colour) && colour < PALETTE.length - 1)
      colour++;
    this.db.run('INSERT INTO city_members (city_id, user_id, role, colour, joined_at) VALUES (?, ?, ?, ?, ?)', cityId,
                userId, role, colour, now);
  }

  setRole(cityId: number, userId: number, role: InvitedRole): void {
    this.db.run('UPDATE city_members SET role = ? WHERE city_id = ? AND user_id = ? AND role != ?', role, cityId, userId,
                'owner');
  }

  // The city goes to another of its members: the owner before stays, as a player
  setOwner(cityId: number, oldOwnerId: number, newOwnerId: number, now: number): void {
    this.db.run('UPDATE cities SET owner_id = ?, updated_at = ? WHERE id = ?', newOwnerId, now, cityId);
    this.db.run(`UPDATE city_members SET role = 'player' WHERE city_id = ? AND user_id = ?`, cityId, oldOwnerId);
    this.db.run(`UPDATE city_members SET role = 'owner' WHERE city_id = ? AND user_id = ?`, cityId, newOwnerId);
  }

  removeMember(cityId: number, userId: number): void {
    this.db.run('DELETE FROM city_members WHERE city_id = ? AND user_id = ?', cityId, userId);
  }

  // The cities the user is a member of but does not own
  membershipsOf(userId: number): number[] {
    return this.db.all<{city_id: number}>(
      `SELECT city_id FROM city_members WHERE user_id = ? AND role != 'owner'`, userId).map(row => row.city_id);
  }

  // Invitations

  invitationByPublicId(publicId: unknown): CityInvitationRow | null {
    if (!isPublicId(publicId))
      return null;
    return this.db.get<CityInvitationRow>('SELECT * FROM city_invitations WHERE public_id = ?', publicId) ?? null;
  }

  invitationFor(cityId: number, inviteeId: number): CityInvitationRow | null {
    return this.db.get<CityInvitationRow>('SELECT * FROM city_invitations WHERE city_id = ? AND invitee_id = ?',
                                          cityId, inviteeId) ?? null;
  }

  // The invitations to a city that wait for an answer, with the invitees' names (for its owner)
  invitationsTo(cityId: number): (CityInvitationRow & {invitee_public_id: string; invitee_name: string})[] {
    return this.db.all(
      `SELECT i.*, u.public_id AS invitee_public_id, u.username AS invitee_name
       FROM city_invitations i JOIN users u ON u.id = i.invitee_id WHERE i.city_id = ? ORDER BY i.created_at, i.id`,
      cityId);
  }

  invite(cityId: number, inviterId: number, inviteeId: number, role: InvitedRole, now: number): void {
    this.db.run(
      `INSERT INTO city_invitations (public_id, city_id, inviter_id, invitee_id, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`, newPublicId(), cityId, inviterId, inviteeId, role, now);
  }

  setInvitationRole(id: number, role: InvitedRole): void {
    this.db.run('UPDATE city_invitations SET role = ? WHERE id = ?', role, id);
  }

  deleteInvitation(id: number): void {
    this.db.run('DELETE FROM city_invitations WHERE id = ?', id);
  }
}

// How many invitations, to cities and regions, wait for the user's answer
export function pendingInvitations(db: Database, userId: number): number {
  return db.get<{n: number}>(
    `SELECT (SELECT count(*) FROM city_invitations WHERE invitee_id = ?) +
            (SELECT count(*) FROM region_invitations WHERE invitee_id = ?) AS n`, userId, userId)?.n ?? 0;
}
