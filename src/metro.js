/* KawaCity: the metro runs underground, in the tunnels the player lays with the metro line tool (see GameMap.TUNNEL),
 * so only its stations take room on the map. A station is on a line when a tunnel runs under it or beside it, and
 * carries people (and takes cars off the roads around it) once its line reaches another station (see KawaBuildings).
 * The bulldozer fills a tunnel in where nothing is built above it.
 */

import { BaseTool } from './baseTool.js';
import { BuildingTool } from './buildingTool.js';
import { GameMap } from './gameMap.js';
import { METRO } from "./tileValues.ts";

var STATION_COST = 500;
var TUNNEL_COST = 100;

var NEIGHBOURS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];


// A function telling whether a tunnel runs under a tile of the map (quicker than GameMap.hasTunnel, for whole scans)
var tunnelReader = function(map) {
  var width = map.width;
  var height = map.height;
  var under = map._roadClass;
  return function(x, y) {
    return x >= 0 && y >= 0 && x < width && y < height && (under[x + y * width] & GameMap.TUNNEL) !== 0;
  };
};


// Whether the station at (x, y) is linked by tunnels to another station: the tunnels under and beside it are followed
// until one runs under or beside another station
var isLinked = function(map, x, y) {
  var hasTunnel = tunnelReader(map);
  var seen = new Set();
  var stack = [];

  var visit = function(tx, ty) {
    var key = tx + ty * map.width;
    if (!seen.has(key) && hasTunnel(tx, ty)) {
      seen.add(key);
      stack.push(tx, ty);
    }
  };

  NEIGHBOURS.forEach(function(d) { visit(x + d[0], y + d[1]); });

  while (stack.length > 0) {
    var ty = stack.pop();
    var tx = stack.pop();

    for (var i = 0; i < NEIGHBOURS.length; i++) {
      var sx = tx + NEIGHBOURS[i][0];
      var sy = ty + NEIGHBOURS[i][1];
      if ((sx !== x || sy !== y) && sx >= 0 && sy >= 0 && sx < map.width && sy < map.height &&
          map.getTileValue(sx, sy) === METRO)
        return true;
    }

    for (i = 1; i < NEIGHBOURS.length; i++)
      visit(tx + NEIGHBOURS[i][0], ty + NEIGHBOURS[i][1]);
  }

  return false;
};


// The metro line tool: lays a tunnel under any tile, built on or not
var LineTool = BaseTool.makeTool(function(map) {
  this.init(TUNNEL_COST, map, false, true);
});


LineTool.prototype.doTool = function(x, y, blockMaps) {
  if (!this._map.testBounds(x, y)) {
    this.result = this.TOOLRESULT_FAILED;
    return;
  }

  if (!this._worldEffects.hasTunnel(x, y)) {
    this._worldEffects.setTunnel(x, y, true);
    this.addCost(this.toolCost);
  }

  this.result = this.TOOLRESULT_OK;
};


// The tunnels to show (when a metro tool is chosen): each tile with a tunnel, and which of its neighbours have one too
// (1: east, 2: south, 4: west, 8: north)
var tunnels = function(map) {
  var out = [];
  var at = tunnelReader(map);

  for (var y = 0; y < map.height; y++) {
    for (var x = 0; x < map.width; x++) {
      if (at(x, y))
        out.push({x: x, y: y, links: (at(x + 1, y) ? 1 : 0) | (at(x, y + 1) ? 2 : 0) | (at(x - 1, y) ? 4 : 0) |
                                     (at(x, y - 1) ? 8 : 0)});
    }
  }

  return out;
};


var Metro = {
  STATION_COST: STATION_COST,
  TUNNEL_COST: TUNNEL_COST,
  LineTool: LineTool,
  isLinked: isLinked,
  makeStationTool: function(map) { return new BuildingTool(STATION_COST, METRO, map, 1, false); },
  tunnels: tunnels
};


export { Metro };
