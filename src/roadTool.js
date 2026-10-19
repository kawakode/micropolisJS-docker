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

import { ConnectingTool } from './connectingTool.js';
import { GameMap } from './gameMap.js';
import { BULLBIT, BURNBIT, CONDBIT } from "./tileFlags.ts";
import { TileUtils } from './tileUtils.js';
import * as TileValues from "./tileValues.ts";

// Lays roads of a kind (see GameMap.ROAD_*): streets by default. bridgeCost is the cost of a tile of bridge, or 0
// if this kind of road can't cross water. Laying a road over a road of another kind rebuilds it as this kind.
var RoadTool = ConnectingTool(function(map, roadClass, cost, bridgeCost) {
  this.init(cost || 10, map, true, true);
  this.roadClass = roadClass || GameMap.ROAD_STREET;
  this.bridgeCost = bridgeCost === undefined ? 50 : bridgeCost;
});


// Whether the tile is a road (including bridges and crossings with rails and power lines)
var isRoad = function(tile) {
  tile = TileUtils.normalizeRoad(tile);
  return (tile >= TileValues.ROADBASE && tile <= TileValues.LASTROAD) ||
         tile === TileValues.HRAILROAD || tile === TileValues.VRAILROAD;
};


var isBridge = function(tile) {
  tile = TileUtils.normalizeRoad(tile);
  return tile === TileValues.HBRIDGE || tile === TileValues.VBRIDGE ||
         tile === TileValues.BRWH || tile === TileValues.BRWV;
};


// How big each kind of road is (see GameMap.ROAD_*): a dirt road, a street, an avenue, then a highway
var ROAD_RANK = [1, 0, 2, 3];


// The tool is about to be applied at the given number of places, along a drag
RoadTool.prototype.startBatch = function(count) {
  this._batchSize = count || 1;
};


RoadTool.prototype.endBatch = function() {
  this._batchSize = 1;
};


RoadTool.prototype.layRoad = function(x, y) {
  var current = this._worldEffects.getTileValue(x, y);

  // Rebuild an existing road as this kind of road. A road dragged across a bigger one leaves it as it is: only a
  // click on a single tile makes a road smaller
  if (isRoad(current)) {
    var currentClass = this._worldEffects.getRoadClass(x, y);
    if (currentClass === this.roadClass)
      return this.TOOLRESULT_FAILED;
    if (this._batchSize > 1 && ROAD_RANK[this.roadClass] < ROAD_RANK[currentClass])
      return this.TOOLRESULT_FAILED;

    var cost = this.toolCost;
    if (isBridge(current)) {
      if (this.bridgeCost === 0)
        return this.TOOLRESULT_FAILED;
      cost = this.bridgeCost;
    }

    this._worldEffects.setRoadClass(x, y, this.roadClass);
    this.addCost(cost);
    return this.TOOLRESULT_OK;
  }

  var result = this._layRoadTile(x, y);
  if (result === this.TOOLRESULT_OK)
    this._worldEffects.setRoadClass(x, y, this.roadClass);

  return result;
};


RoadTool.prototype._layRoadTile = function(x, y) {
  var needsBulldoze = this.doAutoBulldoze(x, y);
  var tile = this._worldEffects.getTileValue(x, y);
  var cost = this.toolCost;

  switch (tile) {
    case TileValues.DIRT:
      this._worldEffects.setTile(x, y, TileValues.ROADS, BULLBIT | BURNBIT);
      break;

    case TileValues.RIVER:
    case TileValues.REDGE:
    case TileValues.CHANNEL:
      if (this.bridgeCost === 0)
        return this.TOOLRESULT_FAILED;

      cost = this.bridgeCost;

      if (x < this._map.width - 1) {
        tile = this._worldEffects.getTileValue(x + 1, y);
        tile = TileUtils.normalizeRoad(tile);

        if (tile === TileValues.VRAILROAD || tile === TileValues.HBRIDGE ||
            (tile >= TileValues.ROADS && tile <= TileValues.HROADPOWER)) {
          this._worldEffects.setTile(x, y, TileValues.HBRIDGE, BULLBIT);
          break;
        }
      }

      if (x > 0) {
        tile = this._worldEffects.getTileValue(x - 1, y);
        tile = TileUtils.normalizeRoad(tile);

        if (tile === TileValues.VRAILROAD || tile === TileValues.HBRIDGE ||
            (tile >= TileValues.ROADS && tile <= TileValues.INTERSECTION)) {
          this._worldEffects.setTile(x, y, TileValues.HBRIDGE, BULLBIT);
          break;
        }
      }

      if (y < this._map.height - 1) {
        tile = this._worldEffects.getTileValue(x, y + 1);
        tile = TileUtils.normalizeRoad(tile);

        if (tile === TileValues.HRAILROAD || tile === TileValues.VROADPOWER ||
            (tile >= TileValues.VBRIDGE && tile <= TileValues.INTERSECTION)) {
          this._worldEffects.setTile(x, y, TileValues.VBRIDGE, BULLBIT);
          break;
        }
      }

      if (y > 0) {
        tile = this._worldEffects.getTileValue(x, y - 1);
        tile = TileUtils.normalizeRoad(tile);

        if (tile === TileValues.HRAILROAD || tile === TileValues.VROADPOWER ||
            (tile >= TileValues.VBRIDGE && tile <= TileValues.INTERSECTION)) {
          this._worldEffects.setTile(x, y, TileValues.VBRIDGE, BULLBIT);
          break;
        }
      }

      return this.TOOLRESULT_FAILED;

    case TileValues.LHPOWER:
      this._worldEffects.setTile(x, y, TileValues.VROADPOWER, CONDBIT | BURNBIT | BULLBIT);
      break;

    case TileValues.LVPOWER:
      this._worldEffects.setTile(x, y, TileValues.HROADPOWER, CONDBIT | BURNBIT | BULLBIT);
      break;

    case TileValues.LHRAIL:
      this._worldEffects.setTile(x, y, TileValues.HRAILROAD, BURNBIT | BULLBIT);
      break;

    case TileValues.LVRAIL:
      this._worldEffects.setTile(x, y, TileValues.VRAILROAD, BURNBIT | BULLBIT);
      break;

    default:
      return needsBulldoze ? this.TOOLRESULT_NEEDS_BULLDOZE : this.TOOLRESULT_FAILED;
  }

  this.addCost(cost);
  this.checkZoneConnections(x, y);
  return this.TOOLRESULT_OK;
};


RoadTool.prototype.doTool = function(x, y, blockMaps) {
  this.result = this.layRoad(x, y);
};


export { RoadTool };
