/* micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details. Alternatively,
 * consult http://micropolisjs.graememcc.co.uk/LICENSE and
 * http://micropolisjs.graememcc.co.uk/COPYING
 *
 * The name/term "MICROPOLIS" is a registered trademark of Micropolis (https://www.micropolis.com) GmbH
 * (Micropolis Corporation, the "licensor") and is licensed here to the authors/publishers of the "Micropolis"
 * city simulation game and its source code (the project or "licensee(s)") as a courtesy of the owner.
 *
 */

import { FireCover } from './fireCover.js';
import { Random } from './random.ts';
import { TileUtils } from './tileUtils.js';
import { DIRT, GASPLANT, IZB, KAWABASE, RADTILE } from "./tileValues.ts";
import { ZoneUtils } from './zoneUtils.js';

var xDelta = [-1,  0,  1,  0 ];
var yDelta = [ 0, -1,  0,  1 ];

var fireFound = function(map, x, y, simData) {
  simData.census.firePop += 1;
  var uncovered = FireCover.coverPercent(simData.blockMaps, x, y) === 0;
  if (uncovered)
    simData.census.uncoveredFirePop += 1;

  // As in the original game, a fire only does anything one scan in four: spread, then maybe burn out
  if ((Random.getRandom16() & 3) !== 0)
    return;

  // Try to set neighbouring tiles on fire as well
  for (var i = 0; i < 4; i++) {
    if (!Random.getChance(7))
      continue;

    var xTem = x + xDelta[i];
    var yTem = y + yDelta[i];

    if (!map.testBounds(xTem, yTem))
      continue;

    var tile = map.getTile(xTem, yTem);
    if (!tile.isCombustible())
      continue;

    if (tile.isZone()) {
      // Neighbour is a zone and burnable
      ZoneUtils.fireZone(map, xTem, yTem, simData.blockMaps);

      // Industrial zones etc really go boom (of KawaCity's buildings, only the gas plant)
      var burning = tile.getValue();
      if ((burning > IZB && burning < KAWABASE) || burning === GASPLANT)
        simData.spriteManager.makeExplosion(xTem, yTem);
    }

    map.setTo(xTem, yTem, TileUtils.randomFire());
  }

  // KawaCity: only firefighters put fires out, faster with better cover; out of their reach, a fire burns on
  if (!uncovered && FireCover.putOut(simData.blockMaps, x, y))
    map.setTo(x, y, TileUtils.randomRubble());
};


var radiationFound = function(map, x, y, simData) {
  if (Random.getChance(4095))
    map.setTile(x, y, DIRT, 0);
};


// An explosion leaves rubble. The renderer turns it to rubble at the end of its animation; off screen, the map scan
// does it after a few scans
var explosionFound = function(map, x, y, simData) {
  if (Random.getChance(3))
    map.setTo(x, y, TileUtils.randomRubble());
};


var floodFound = function(map, x, y, simData) {
  simData.disasterManager.doFlood(x, y, simData.blockMaps);
};


var MiscTiles = {
  registerHandlers: function(mapScanner, repairManager) {
    mapScanner.addAction(TileUtils.isFire, fireFound, true);
    mapScanner.addAction(RADTILE, radiationFound, true);
    mapScanner.addAction(TileUtils.isFlood, floodFound, true);
    mapScanner.addAction(TileUtils.isManualExplosion, explosionFound, true);
  }
};


export { MiscTiles };
