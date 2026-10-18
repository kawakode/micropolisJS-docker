/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { Clock } from '../clock';
import type { CityStore } from './cityStore';
import { FACING, RegionLink } from './regionLink';
import type { RegionStore } from './regionStore';

// What an account takes along in the regions, before its rows go (DESIGN §5.2), in the transaction that deletes it:
// the cities beside its cities end their deals with them, and the other players' cities in its regions leave them
// (ending their deals with the cities beside them). Used by the server (POST /api/account/delete, see gameRoutes.ts)
// and by the admin command `user delete`, which runs in a process of its own: its RegionLink has no room open, so it
// changes the stored saves only (a city open on a running server keeps its deals until its room closes).
//
// evict(ids) is called with the ids of the account's cities, once their neighbours are done with (the server closes
// their rooms without saving them). Returns the ids of the cities whose neighbours changed, and of those the account
// was a member of (the server's open rooms look at them again once the account is gone).

export interface AccountStores {
  readonly cities: CityStore;
  readonly regions: RegionStore;
  readonly link: RegionLink;
  readonly clock: Clock;
}

export function releaseAccount(stores: AccountStores, userId: number, evict: (cityIds: number[]) => void):
    {touched: number[]; memberships: number[]} {
  const {cities, regions, link, clock} = stores;
  const owned = cities.ownedBy(userId).map(city => city.id);
  const ownedSet = new Set(owned);
  const touched: number[] = [];

  // The cities beside its cities lose them as neighbours
  for (const id of owned) {
    for (const [side, neighbour] of link.neighboursOf(id)) {
      if (!ownedSet.has(neighbour)) {
        link.clearSides(neighbour, [FACING[side]]);
        touched.push(neighbour);
      }
    }
  }
  evict(owned);

  // Its regions go: the other players' cities in them leave them
  for (const region of regions.ownedBy(userId)) {
    for (const slot of regions.slots(region.id)) {
      if (ownedSet.has(slot.city_id))
        continue;
      touched.push(...link.clearAround(slot.city_id).filter(id => !ownedSet.has(id)));
      cities.setRegion(slot.city_id, null, clock.now());
    }
  }

  return {touched, memberships: cities.membershipsOf(userId)};
}
