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

function TileHistory() {
  this.clear();
}


// Map coordinates are bounded well below 65536, so this key is unique
var toKey = function(x, y) {
  return y * 65536 + x;
};


TileHistory.prototype.clear = function() {
  this.data = new Map();
};


TileHistory.prototype.getTile = function(x, y) {
  return this.data.get(toKey(x, y));
};


TileHistory.prototype.setTile = function(x, y, value) {
  this.data.set(toKey(x, y), value);
};


export { TileHistory };
