/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { Clock } from '../clock';
import type { Database } from '../db/database';
import { CityStore, decodeState, encodeState } from './cityStore';
import type { EdgeState } from './headless';
import { DEAL_KINDS, SIDES } from './protocol';
import type { RemoteInfo, Room, RoomPlacement } from './room';

// The cities of a region, side by side (DESIGN §5.6). Each city in a slot has the cities of the slots beside it as its
// neighbours on those sides, in place of the neighbours of its save (see Neighbours.setRemote): their name, their
// owner's username, their population (live from their room when it is open, else from the cities table), and what
// they have at the edge facing this city (edge_state: their links, whether they send power, the deals they signed).
// Facing sides: north and south, east and west.
//
// A room stores its city's edges after each scan of the power grid and each deal (see Room.updateEdge): the rooms
// beside it then look at their neighbours again, and send them in their stats. When a city enters or leaves a slot
// (a city made there, a slot cleared, a member removed, the region deleted), the deals between it and the cities
// beside it end, in the same transaction, on both sides: in the room if it is open, else in the stored save, and in
// edge_state.

export const FACING: Readonly<Record<string, string>> = {north: 'south', south: 'north', east: 'west', west: 'east'};

const OFFSETS: Readonly<Record<string, readonly [number, number]>> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

interface PlacementRow {
  region_id: number | null;
  region_x: number | null;
  region_y: number | null;
}

interface RegionCityRow {
  id: number;
  public_id: string;
  name: string;
  population: number;
  edge_state: string;
  region_x: number;
  region_y: number;
  owner_name: string;
}

// The edges of a city that are not running, as stored
const parseEdges = (text: string): Record<string, unknown> => {
  try {
    const edges = JSON.parse(text) as unknown;
    return edges !== null && typeof edges === 'object' && !Array.isArray(edges) ? edges as Record<string, unknown> : {};
  } catch (e) {
    return {};
  }
};

const noDeals = () => Object.fromEntries(DEAL_KINDS.map(kind => [kind, false]));

// An edge as Neighbours.setRemote reads it (it checks each value itself)
const edgeOf = (edges: Record<string, unknown>, side: string): EdgeState => {
  const edge = edges[side];
  if (edge === null || typeof edge !== 'object' || Array.isArray(edge))
    return {transport: false, power: false, powerOut: false, signed: noDeals()};
  return edge as EdgeState;
};

export interface RoomLookup {
  get(cityId: number): Room | undefined;
}

export class RegionLink {
  constructor(private readonly db: Database, private readonly cities: CityStore, private readonly clock: Clock,
              private readonly rooms: RoomLookup) {}

  private placementOf(cityId: number): {regionId: number; x: number; y: number} | null {
    const row = this.db.get<PlacementRow>('SELECT region_id, region_x, region_y FROM cities WHERE id = ?', cityId);
    if (!row || row.region_id === null || row.region_x === null || row.region_y === null)
      return null;
    return {regionId: row.region_id, x: row.region_x, y: row.region_y};
  }

  // The cities beside a slot, by side
  private besides(regionId: number, x: number, y: number): Map<string, RegionCityRow> {
    const rows = this.db.all<RegionCityRow>(
      `SELECT c.id, c.public_id, c.name, c.population, c.edge_state, c.region_x, c.region_y, u.username AS owner_name
       FROM cities c JOIN users u ON u.id = c.owner_id WHERE c.region_id = ?`, regionId);
    const result = new Map<string, RegionCityRow>();
    for (const side of SIDES) {
      const [dx, dy] = OFFSETS[side];
      const row = rows.find(r => r.region_x === x + dx && r.region_y === y + dy);
      if (row)
        result.set(side, row);
    }
    return result;
  }

  // The ids of the cities beside a city, by side (none when it is not in a region)
  neighboursOf(cityId: number): Map<string, number> {
    const placement = this.placementOf(cityId);
    const result = new Map<string, number>();
    if (placement) {
      for (const [side, row] of this.besides(placement.regionId, placement.x, placement.y))
        result.set(side, row.id);
    }
    return result;
  }

  // The room's place in its region, and its neighbours, looked at again
  refresh(room: Room): boolean {
    const placement = this.placementOf(room.id);
    let roomPlacement: RoomPlacement | null = null;
    const remotes: Record<string, RemoteInfo | null> = {};

    if (placement) {
      const region = this.db.get<{public_id: string; name: string}>('SELECT public_id, name FROM regions WHERE id = ?',
                                                                    placement.regionId);
      if (region)
        roomPlacement = {regionId: placement.regionId, publicId: region.public_id, name: region.name, x: placement.x,
                         y: placement.y};

      for (const [side, row] of this.besides(placement.regionId, placement.x, placement.y)) {
        const live = this.rooms.get(row.id);
        remotes[side] = {
          cityId: row.public_id,
          name: live?.name ?? row.name,
          ownerName: row.owner_name,
          population: live ? live.city.population : row.population,
          edge: live ? live.edge[FACING[side]] ?? edgeOf({}, side) : edgeOf(parseEdges(row.edge_state), FACING[side]),
        };
      }
    }

    room.placement = roomPlacement;
    return room.setRemotes(remotes);
  }

  // The open rooms of these cities and of the cities beside them look at their neighbours again
  refreshAround(cityIds: Iterable<number>): void {
    const ids = new Set<number>();
    for (const id of cityIds) {
      ids.add(id);
      for (const neighbour of this.neighboursOf(id).values())
        ids.add(neighbour);
    }
    for (const id of ids) {
      const room = this.rooms.get(id);
      if (room)
        this.refresh(room);
    }
  }

  // A room stored new edges: the open rooms beside it look again
  edgeChanged(room: Room): void {
    for (const id of this.neighboursOf(room.id).values()) {
      const neighbour = this.rooms.get(id);
      if (neighbour)
        this.refresh(neighbour);
    }
  }

  // Ends the deals of a city with the neighbours of these sides: in its room if it is open, else in its stored save
  // and edges
  clearSides(cityId: number, sides: readonly string[]): void {
    if (sides.length === 0)
      return;

    const room = this.rooms.get(cityId);
    if (room) {
      room.clearDeals(sides);
      return;
    }

    const state = this.cities.state(cityId);
    const row = this.cities.byId(cityId);
    if (!state || !row)
      return;

    const save = decodeState(state);
    if (Array.isArray(save.neighbours)) {
      for (const neighbour of save.neighbours as Record<string, unknown>[]) {
        if (neighbour && sides.includes(neighbour.side as string)) {
          neighbour.deals = noDeals();
          neighbour.months = Object.fromEntries(DEAL_KINDS.map(kind => [kind, 0]));
        }
      }
    }

    const edges = parseEdges(row.edge_state);
    for (const side of sides) {
      const edge = edgeOf(edges, side);
      edges[side] = {transport: edge.transport === true, power: edge.power === true, powerOut: false,
                     signed: noDeals()};
    }
    this.cities.replaceState(cityId, encodeState(JSON.stringify(save)), edges as Record<string, EdgeState>,
                             this.clock.now());
  }

  // A city enters or leaves its slot (call it while it is there): the deals between it and each city beside it end,
  // on both sides. Returns the ids of the cities whose neighbours change (the city's own included).
  clearAround(cityId: number): number[] {
    const besides = this.neighboursOf(cityId);
    this.clearSides(cityId, [...besides.keys()]);
    for (const [side, id] of besides)
      this.clearSides(id, [FACING[side]]);
    return [cityId, ...besides.values()];
  }
}
