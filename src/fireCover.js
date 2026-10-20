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

import { Random } from './random.ts';

// KawaCity: the firefighters both prevent fires and put them out. Out of their reach, a fire never goes out on its own.

// The fire station effect at which a spot is fully covered: about one block from a fully funded fire station. The fire
// overlay of the minimap uses the same scale.
var FULL_COVER = 100;

// At full cover, most fires are stopped before they start
var MAX_PREVENTED_PERCENT = 75;


// The fire cover at a spot, in percent (0 when the block maps are not known yet)
var coverPercent = function(blockMaps, x, y) {
  if (!blockMaps)
    return 0;

  var cover = blockMaps.fireStationEffectMap.worldGet(x, y);
  return Math.round(100 * Math.min(cover, FULL_COVER) / FULL_COVER);
};


// Whether a fire starting at a spot (a building catching fire, a quake, an explosion) actually breaks out
var catchesFire = function(blockMaps, x, y) {
  var prevented = Math.floor(MAX_PREVENTED_PERCENT * coverPercent(blockMaps, x, y) / 100);
  return Random.getRandom(99) >= prevented;
};


// Whether the firefighters put out a burning tile this time: never without cover, at best one time in two (as fast as
// in the original game with full cover)
var putOut = function(blockMaps, x, y) {
  return Random.getRandom(199) < coverPercent(blockMaps, x, y);
};


var FireCover = {
  FULL_COVER: FULL_COVER,
  catchesFire: catchesFire,
  coverPercent: coverPercent,
  putOut: putOut
};


export { FireCover };
