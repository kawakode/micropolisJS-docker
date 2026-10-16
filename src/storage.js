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

import { MiscUtils } from './miscUtils.js';

// A very thin wrapper around localStorage, in case we wish to move to some other storage mechanism
// (such as indexedDB) in the future

// Merely accessing localStorage throws in some browsers when site data is blocked
var canStore = (function() {
  try {
    return window.localStorage !== undefined && window.localStorage !== null;
  } catch (e) {
    return false;
  }
})();

var getSavedGame = function() {
  if (!canStore)
    return null;

  var savedGame;
  try {
    savedGame = window.localStorage.getItem(this.KEY);
    if (savedGame === null)
      return null;

    savedGame = JSON.parse(savedGame);

    if (savedGame.version !== this.CURRENT_VERSION)
      this.transitionOldSave(savedGame);
  } catch (e) {
    console.error('Unable to read saved game', e);
    return null;
  }

  // Flag as a saved game for Game/Simulation etc...
  savedGame.isSavedGame = true;
  return savedGame;
};


// Returns true if the game was saved
var saveGame = function(gameData) {
  if (!canStore)
    return false;

  gameData.version = this.CURRENT_VERSION;
  gameData = JSON.stringify(gameData);

  try {
    window.localStorage.setItem(this.KEY, gameData);
  } catch (e) {
    // Most likely the storage quota has been exceeded, or storage is disabled
    console.error('Unable to save game', e);
    return false;
  }

  return true;
};


var transitionOldSave = function(savedGame) {
  switch (savedGame.version) {
    case 1:
      savedGame.everClicked = false;

      /* falls through */
    case 2:
      savedGame.pollutionMaxX = Math.floor(savedGame.width / 2);
      savedGame.pollutionMaxY = Math.floor(savedGame.height / 2);
      savedGame.cityCentreX = Math.floor(savedGame.width / 2);
      savedGame.cityCentreY = Math.floor(savedGame.height / 2);

      break;

    default:
      throw new Error('Unknown save version!');
  }
};


var Storage = {
  getSavedGame: getSavedGame,
  saveGame: saveGame,
  transitionOldSave: transitionOldSave
};


Object.defineProperty(Storage, 'CURRENT_VERSION', MiscUtils.makeConstantDescriptor(3));
Object.defineProperty(Storage, 'KEY', MiscUtils.makeConstantDescriptor('micropolisJSGame'));
Object.defineProperty(Storage, 'canStore', MiscUtils.makeConstantDescriptor(canStore));


export { Storage };
