/* KawaCity: the metro runs underground, so only its stations take room on the map. A new station is linked by a
 * tunnel to the nearest station within reach, paid for by the tile; a station carries people (and takes cars off the
 * roads around it) once it has another within reach (see KawaBuildings).
 */

import { BuildingTool } from './buildingTool.js';
import { METRO } from "./tileValues.ts";

var STATION_COST = 500;
var TUNNEL_COST = 100;
var RANGE = 24;


// The distance (in tiles, rounded up) from (x, y) to the nearest other station within reach, or null if there is none.
// getTileValue reads the map, or the tool's pending changes to it.
var nearestStation = function(getTileValue, width, height, x, y) {
  var nearest = null;

  for (var sy = Math.max(0, y - RANGE), maxY = Math.min(height - 1, y + RANGE); sy <= maxY; sy++) {
    for (var sx = Math.max(0, x - RANGE), maxX = Math.min(width - 1, x + RANGE); sx <= maxX; sx++) {
      if ((sx === x && sy === y) || getTileValue(sx, sy) !== METRO)
        continue;

      var distance = Math.sqrt((sx - x) * (sx - x) + (sy - y) * (sy - y));
      if (distance <= RANGE && (nearest === null || distance < nearest))
        nearest = distance;
    }
  }

  return nearest === null ? null : Math.ceil(nearest);
};


// Whether the station at (x, y) on the map is linked to another
var isLinked = function(map, x, y) {
  return nearestStation(map.getTileValue.bind(map), map.width, map.height, x, y) !== null;
};


// The station's tool: a 1x1 building, plus its tunnel to the nearest station
var makeTool = function(map) {
  var tool = new BuildingTool(STATION_COST, METRO, map, 1, false);
  var buildBuilding = tool.buildBuilding;

  tool.buildBuilding = function(x, y) {
    var result = buildBuilding.call(this, x, y);
    if (result !== this.TOOLRESULT_OK)
      return result;

    var effects = this._worldEffects;
    var tunnel = nearestStation(effects.getTileValue.bind(effects), this._map.width, this._map.height, x, y);
    if (tunnel !== null)
      this.addCost(tunnel * TUNNEL_COST);

    return result;
  };

  return tool;
};


var Metro = {
  RANGE: RANGE,
  STATION_COST: STATION_COST,
  TUNNEL_COST: TUNNEL_COST,
  isLinked: isLinked,
  makeTool: makeTool,
  nearestStation: nearestStation
};


export { Metro };
