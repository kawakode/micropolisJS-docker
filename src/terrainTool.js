/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { BaseTool } from './baseTool.js';
import { BIT_MASK, BLBNBIT, BULLBIT } from "./tileFlags.ts";
import * as TileValues from "./tileValues.ts";

// Tools that shape the land, tile by tile: planting forests, digging water, filling water in, and laying single
// tile features such as gardens and plazas. The shores and the edges of forests are smoothed around each tile, as
// the map generator does.

var PLANT = 'plant';
var DIG = 'dig';
var FILL = 'fill';
var LAY = 'lay';

var DX = [-1, 0, 1, 0];
var DY = [0, 1, 0, -1];

// Shore tiles, by which of the four neighbours (west, south, east, north) are not land (see MapGenerator)
var RIVER_EDGES = [
  13 | BULLBIT, 13 | BULLBIT, 17 | BULLBIT, 15 | BULLBIT,
   5 | BULLBIT, TileValues.RIVER, 19 | BULLBIT, 17 | BULLBIT,
   9 | BULLBIT, 11 | BULLBIT, TileValues.RIVER, 13 | BULLBIT,
   7 | BULLBIT,  9 | BULLBIT,  5 | BULLBIT, TileValues.RIVER];

// The edges of a forest, by which neighbours are trees (see MapGenerator)
var TREE_EDGES = [
   0,   0,  0, 34,
   0,   0, 36, 35,
   0,  32,  0, 33,
  30,  31, 29, 37];


var isWater = function(value) {
  return value >= TileValues.WATER_LOW && value <= TileValues.WATER_HIGH;
};


var isTree = function(value) {
  return value >= TileValues.WOODS_LOW && value <= TileValues.WOODS_HIGH;
};


var TerrainTool = BaseTool.makeTool(function(map, mode, cost, tile, flags) {
  this.init(cost, map, true, true);
  this.mode = mode;
  this.tile = tile;
  this.tileFlags = flags || 0;
});


TerrainTool.prototype._set = function(x, y, value) {
  this._worldEffects.setTile(x, y, value & BIT_MASK, value & ~BIT_MASK);
};


// Picks the right shore tile for water at (x, y), from its neighbours
TerrainTool.prototype._smoothWaterAt = function(x, y) {
  var effects = this._worldEffects;
  if (!effects.testBounds(x, y) || !isWater(effects.getTileValue(x, y)) ||
      effects.getTileValue(x, y) === TileValues.CHANNEL)
    return;

  var index = 0;
  for (var i = 0; i < 4; i++) {
    index = index << 1;
    var nx = x + DX[i];
    var ny = y + DY[i];
    // Off the map counts as water; trees and bare land as land
    if (!effects.testBounds(nx, ny)) {
      index++;
      continue;
    }

    var value = effects.getTileValue(nx, ny);
    if (value !== TileValues.DIRT && !isTree(value))
      index++;
  }

  this._set(x, y, RIVER_EDGES[index & 15]);
};


// Picks the right edge for a tree at (x, y), from its neighbours
TerrainTool.prototype._smoothTreeAt = function(x, y) {
  var effects = this._worldEffects;
  if (!effects.testBounds(x, y) || !isTree(effects.getTileValue(x, y)))
    return;

  var index = 0;
  for (var i = 0; i < 4; i++) {
    index = index << 1;
    var nx = x + DX[i];
    var ny = y + DY[i];
    if (effects.testBounds(nx, ny) && isTree(effects.getTileValue(nx, ny)))
      index++;
  }

  var value = TREE_EDGES[index & 15];
  // A lone tree stays a full tree
  if (value === 0)
    value = TileValues.WOODS;
  else if (value !== TileValues.WOODS && ((x + y) & 1))
    value -= 8;

  this._worldEffects.setTile(x, y, value, BLBNBIT);
};


TerrainTool.prototype._smoothAround = function(x, y) {
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      this._smoothWaterAt(x + dx, y + dy);
      this._smoothTreeAt(x + dx, y + dy);
    }
  }
};


TerrainTool.prototype.doTool = function(x, y, blockMaps) {
  var effects = this._worldEffects;
  if (!effects.testBounds(x, y)) {
    this.result = this.TOOLRESULT_FAILED;
    return;
  }

  var value = effects.getTileValue(x, y);

  switch (this.mode) {
    case PLANT:
      // Trees grow on bare land
      if (value !== TileValues.DIRT) {
        this.result = isTree(value) ? this.TOOLRESULT_FAILED : this.TOOLRESULT_NEEDS_BULLDOZE;
        return;
      }
      effects.setTile(x, y, TileValues.WOODS, BLBNBIT);
      break;

    case DIG:
      // Water can be dug out of bare land, forests and rubble (with the bulldozer's help)
      if (isWater(value)) {
        this.result = this.TOOLRESULT_FAILED;
        return;
      }

      if (value !== TileValues.DIRT && !isTree(value) &&
          !(value >= TileValues.RUBBLE && value <= TileValues.LASTRUBBLE)) {
        this.result = this.TOOLRESULT_NEEDS_BULLDOZE;
        return;
      }
      effects.setTile(x, y, TileValues.RIVER, 0);
      break;

    case FILL:
      // Open water and shores (bridges are roads, and stay)
      if (!isWater(value)) {
        this.result = this.TOOLRESULT_FAILED;
        return;
      }
      effects.setTile(x, y, TileValues.DIRT, 0);
      break;

    case LAY:
      if (value === this.tile) {
        this.result = this.TOOLRESULT_FAILED;
        return;
      }

      if (value !== TileValues.DIRT) {
        // Trees and rubble are cleared for $1, as roads do
        if (!this.autoBulldoze || !(isTree(value) || (value >= TileValues.RUBBLE && value <= TileValues.LASTRUBBLE))) {
          this.result = this.TOOLRESULT_NEEDS_BULLDOZE;
          return;
        }
        this.addCost(1);
      }
      effects.setTile(x, y, this.tile, this.tileFlags);
      break;
  }

  this._smoothAround(x, y);
  this.addCost(this.toolCost);
  this.result = this.TOOLRESULT_OK;
};


TerrainTool.PLANT = PLANT;
TerrainTool.DIG = DIG;
TerrainTool.FILL = FILL;
TerrainTool.LAY = LAY;


export { TerrainTool };
