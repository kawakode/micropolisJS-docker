/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { Database } from '../db/database';
import { isPublicId, newPublicId } from '../security/tokens';
import { forbidden, notFound } from './cityStore';

// The regions in the database: private grids of 2x2 to 4x4 slots, each slot empty or holding a shared city, side by
// side with the cities of the slots around it (see regionLink.ts). A region's owner invites its members; a member
// fills a free slot by making a new city there. As for cities, someone who is not a member is told a region does not
// exist (404 not_found).

export const REGION_LIMITS = Object.freeze({
  // Regions a player owns
  ownedRegions: 3,
  // Members of a region, its owner included: as many as it can have cities
  members: 16,
  minSize: 2,
  maxSize: 4,
});

export interface RegionRow {
  id: number;
  public_id: string;
  owner_id: number;
  name: string;
  width: number;
  height: number;
  created_at: number;
  updated_at: number;
}

// A region as the lobby lists it, for one of its members
export interface RegionListing extends RegionRow {
  owner_name: string;
  cities: number;
}

// A city in a slot of a region
export interface SlotRow {
  city_id: number;
  city_public_id: string;
  name: string;
  owner_id: number;
  owner_name: string;
  population: number;
  region_x: number;
  region_y: number;
}

export interface RegionMemberRow {
  user_id: number;
  public_id: string;
  username: string;
  joined_at: number;
}

export interface RegionInvitationRow {
  id: number;
  public_id: string;
  region_id: number;
  inviter_id: number;
  invitee_id: number;
  created_at: number;
}

export class RegionStore {
  constructor(private readonly db: Database) {}

  byId(id: number): RegionRow | null {
    return this.db.get<RegionRow>('SELECT * FROM regions WHERE id = ?', id) ?? null;
  }

  byPublicId(publicId: unknown): RegionRow | null {
    if (!isPublicId(publicId))
      return null;
    return this.db.get<RegionRow>('SELECT * FROM regions WHERE public_id = ?', publicId) ?? null;
  }

  isMember(regionId: number, userId: number): boolean {
    return this.db.get('SELECT 1 FROM region_members WHERE region_id = ? AND user_id = ?', regionId, userId) !==
      undefined;
  }

  // The region, if the user is a member of it: else 404 not_found
  forMember(publicId: unknown, userId: number): RegionRow {
    const region = this.byPublicId(publicId);
    if (!region || !this.isMember(region.id, userId))
      throw notFound();
    return region;
  }

  // The same for what only its owner may do: 403 forbidden for the other members
  forOwner(publicId: unknown, userId: number): RegionRow {
    const region = this.forMember(publicId, userId);
    if (region.owner_id !== userId)
      throw forbidden();
    return region;
  }

  ownerName(region: RegionRow): string {
    return this.db.get<{username: string}>('SELECT username FROM users WHERE id = ?', region.owner_id)?.username ?? '';
  }

  ownedCount(userId: number): number {
    return this.db.get<{n: number}>('SELECT count(*) AS n FROM regions WHERE owner_id = ?', userId)?.n ?? 0;
  }

  ownedBy(userId: number): RegionRow[] {
    return this.db.all<RegionRow>('SELECT * FROM regions WHERE owner_id = ? ORDER BY id', userId);
  }

  listForUser(userId: number): RegionListing[] {
    return this.db.all<RegionListing>(
      `SELECT r.*, o.username AS owner_name, (SELECT count(*) FROM cities c WHERE c.region_id = r.id) AS cities
       FROM region_members m JOIN regions r ON r.id = m.region_id JOIN users o ON o.id = r.owner_id
       WHERE m.user_id = ? ORDER BY r.created_at DESC, r.id DESC`, userId);
  }

  // A new region, its owner its first member
  create(ownerId: number, name: string, width: number, height: number, now: number): RegionRow {
    const id = this.db.run(
      `INSERT INTO regions (public_id, owner_id, name, width, height, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, newPublicId(), ownerId, name, width, height, now, now).lastInsertRowid;
    this.addMember(id, ownerId, now);
    return this.byId(id) as RegionRow;
  }

  rename(id: number, name: string, now: number): void {
    this.db.run('UPDATE regions SET name = ?, updated_at = ? WHERE id = ?', name, now, id);
  }

  delete(id: number): void {
    this.db.run('DELETE FROM regions WHERE id = ?', id);
  }

  cityCount(regionId: number): number {
    return this.db.get<{n: number}>('SELECT count(*) AS n FROM cities WHERE region_id = ?', regionId)?.n ?? 0;
  }

  // The cities in the region's slots
  slots(regionId: number): SlotRow[] {
    return this.db.all<SlotRow>(
      `SELECT c.id AS city_id, c.public_id AS city_public_id, c.name, c.owner_id, u.username AS owner_name,
              c.population, c.region_x, c.region_y
       FROM cities c JOIN users u ON u.id = c.owner_id WHERE c.region_id = ? ORDER BY c.region_y, c.region_x`,
      regionId);
  }

  cityAt(regionId: number, x: number, y: number): SlotRow | null {
    return this.slots(regionId).find(slot => slot.region_x === x && slot.region_y === y) ?? null;
  }

  // Members

  members(regionId: number): RegionMemberRow[] {
    return this.db.all<RegionMemberRow>(
      `SELECT m.user_id, u.public_id, u.username, m.joined_at FROM region_members m JOIN users u ON u.id = m.user_id
       WHERE m.region_id = ? ORDER BY m.joined_at, m.user_id`, regionId);
  }

  memberCount(regionId: number): number {
    return this.db.get<{n: number}>('SELECT count(*) AS n FROM region_members WHERE region_id = ?', regionId)?.n ?? 0;
  }

  addMember(regionId: number, userId: number, now: number): void {
    this.db.run('INSERT INTO region_members (region_id, user_id, joined_at) VALUES (?, ?, ?)', regionId, userId, now);
  }

  removeMember(regionId: number, userId: number): void {
    this.db.run('DELETE FROM region_members WHERE region_id = ? AND user_id = ?', regionId, userId);
  }

  // The cities a user has in a region
  citiesOf(regionId: number, userId: number): number[] {
    return this.db.all<{id: number}>('SELECT id FROM cities WHERE region_id = ? AND owner_id = ?', regionId, userId)
      .map(row => row.id);
  }

  // Invitations

  invitationByPublicId(publicId: unknown): RegionInvitationRow | null {
    if (!isPublicId(publicId))
      return null;
    return this.db.get<RegionInvitationRow>('SELECT * FROM region_invitations WHERE public_id = ?', publicId) ?? null;
  }

  invitationFor(regionId: number, inviteeId: number): RegionInvitationRow | null {
    return this.db.get<RegionInvitationRow>('SELECT * FROM region_invitations WHERE region_id = ? AND invitee_id = ?',
                                            regionId, inviteeId) ?? null;
  }

  invite(regionId: number, inviterId: number, inviteeId: number, now: number): void {
    this.db.run(
      `INSERT INTO region_invitations (public_id, region_id, inviter_id, invitee_id, created_at)
       VALUES (?, ?, ?, ?, ?)`, newPublicId(), regionId, inviterId, inviteeId, now);
  }

  deleteInvitation(id: number): void {
    this.db.run('DELETE FROM region_invitations WHERE id = ?', id);
  }
}
