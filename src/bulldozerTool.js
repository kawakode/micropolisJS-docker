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
import { EventEmitter } from './eventEmitter.js';
import { SOUND_EXPLOSIONLOW, SOUND_EXPLOSIONHIGH } from './messages.ts';
import { Random } from './random.ts';
import { ANIMBIT, BULLBIT } from "./tileFlags.ts";
import { TileUtils } from './tileUtils.js';
import * as TileValues from "./tileValues.ts";
import { ZoneUtils } from './zoneUtils.js';

var BulldozerTool = EventEmitter(ConnectingTool(function(map) {
  this.init(10, map, true);
}));


BulldozerTool.prototype.putRubble = function(x, y, size) {
  for (var xx = x; xx < x + size; xx++) {
    for (var yy = y; yy < y + size; yy++)  {
      if (this._map.testBounds(xx, yy)) {
        var tile = this._worldEffects.getTileValue(xx, yy);
        if (tile != TileValues.RADTILE && tile != TileValues.DIRT)
          this._worldEffects.setTile(xx, yy, TileValues.TINYEXP + Random.getRandom(2), ANIMBIT | BULLBIT);
      }
    }
  }
};


BulldozerTool.prototype.layDoze = function(x, y) {
  var tile = this._worldEffects.getTile(x, y);

  if (!tile.isBulldozable())
    return this.TOOLRESULT_FAILED;

  tile = tile.getValue();
  tile = TileUtils.normalizeRoad(tile);

  switch (tile) {
    case TileValues.HBRIDGE:
    case TileValues.VBRIDGE:
    case TileValues.BRWV:
    case TileValues.BRWH:
    case TileValues.HBRDG0:
    case TileValues.HBRDG1:
    case TileValues.HBRDG2:
    case TileValues.HBRDG3:
    case TileValues.VBRDG0:
    case TileValues.VBRDG1:
    case TileValues.VBRDG2:
    case TileValues.VBRDG3:
    case TileValues.HPOWER:
    case TileValues.VPOWER:
    case TileValues.HRAIL:
    case TileValues.VRAIL:
      this._worldEffects.setTile(x, y, TileValues.RIVER);
      break;

    default:
      this._worldEffects.setTile(x, y, TileValues.DIRT);
      break;
  }

  this.addCost(1);

  return this.TOOLRESULT_OK;
};


BulldozerTool.prototype.doTool = function(x, y, blockMaps) {
  if (!this._map.testBounds(x, y)) {
    this.result = this.TOOLRESULT_FAILED;
    return;
  }

  var tile = this._worldEffects.getTile(x, y);
  var tileValue = tile.getValue();

  var zoneSize = 0;
  var deltaX = 0;
  var deltaY = 0;

  if (tile.isZone()) {
    zoneSize = ZoneUtils.getZoneSize(tileValue);
  } else {
    var result = ZoneUtils.checkBigZone(tileValue);
    zoneSize = result.zoneSize;
    deltaX = result.deltaX;
    deltaY = result.deltaY;

    // Allow buildings to be demolished by clicking on any of their tiles, not just the centre
    if (zoneSize === 0 && !tile.isBulldozable()) {
      var zone = ZoneUtils.findCoveringZone(this._worldEffects, x, y);
      if (zone !== null) {
        zoneSize = zone.zoneSize;
        deltaX = zone.x - x;
        deltaY = zone.y - y;
      } else if (tileValue >= TileValues.RESBASE) {
        // A fragment of a building whose centre has been destroyed: clear it on its own
        this.addCost(this.bulldozerCost);
        this.putRubble(x, y, 1);
        this.result = this.TOOLRESULT_OK;
        return;
      }
    }
  }

  if (zoneSize > 0) {
    this.addCost(this.bulldozerCost);

    var dozeX = x;
    var dozeY = y;
    var centerX = x + deltaX;
    var centerY = y + deltaY;

    switch (zoneSize) {
      case 3:
        this._emitEvent(SOUND_EXPLOSIONHIGH);
        this.putRubble(centerX - 1, centerY - 1, 3);
        break;

      case 4:
        this._emitEvent(SOUND_EXPLOSIONLOW);
        this.putRubble(centerX - 1, centerY - 1, 4);
        break;

      case 6:
        this._emitEvent(SOUND_EXPLOSIONHIGH);
        this._emitEvent(SOUND_EXPLOSIONLOW);
        this.putRubble(centerX - 1, centerY - 1, 6);
        break;
    }

    this.result = this.TOOLRESULT_OK;
  } else {
    var toolResult;
    if (tileValue === TileValues.RIVER || tileValue === TileValues.REDGE || tileValue === TileValues.CHANNEL) {
      toolResult = this.layDoze(x, y);

      if (tileValue !== this._worldEffects.getTileValue(x, y))
        this.addCost(5);
    } else {
      toolResult =  this.layDoze(x, y);
      this.checkZoneConnections(x, y);
    }

    this.result = toolResult;
  }
};


export { BulldozerTool };
