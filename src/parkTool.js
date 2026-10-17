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

import { BaseTool } from './baseTool.js';
import { Random } from './random.ts';
import { ANIMBIT, BULLBIT, BURNBIT, CONDBIT } from "./tileFlags.ts";
import { TileUtils } from './tileUtils.js';
import { FOUNTAIN, WOODS2, WOODS5 } from "./tileValues.ts";

var makeTool = BaseTool.makeTool;
var ParkTool = makeTool(function(map) {
  this.init(10, map, true);
});


ParkTool.prototype.doTool = function(x, y, blockMaps) {
  // Nothing to do on a park (which saves warning about it when dragging over parks)
  var current = this._worldEffects.getTileValue(x, y);
  if ((current >= WOODS2 && current <= WOODS5) || current === FOUNTAIN) {
    this.result = this.TOOLRESULT_FAILED;
    return;
  }

  this.result = this.clearTile(x, y);
  if (this.result !== this.TOOLRESULT_OK)
    return;

  var value = Random.getRandom(4);
  var tileFlags = BURNBIT | BULLBIT;
  var tileValue;

  if (value === 4) {
    tileValue = FOUNTAIN;
    tileFlags |= ANIMBIT;
  } else {
    tileValue = value + WOODS2;
  }

  this._worldEffects.setTile(x, y, tileValue, tileFlags);
  this.addCost(10);
  this.result = this.TOOLRESULT_OK;
};


export { ParkTool };
