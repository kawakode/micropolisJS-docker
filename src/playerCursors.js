/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { Placements } from './placements.js';

// The players' pointers on the map of a shared city. Each player sees where the others point, as an outline in their
// colour as big as the tool they hold, or around what they drag; and the game tells the server where its own pointer
// is, at most ten times a second (see the cursor messages in RemoteController):
// - to the server: {t: 'cursor', x, y, tool} (with ax and ay, the tile where a drag started, while dragging), or
//   {t: 'cursor', x: null} when the pointer left the map;
// - from the server: {t: 'cursors', list: [[id, x, y, tool, ax, ay], ...]}, every pointer on the map, each time one
//   changes (ax and ay null when the player is not dragging).
// Nothing here touches the page.

var WIDTH = 120;
var HEIGHT = 100;

// The shortest time between two pointer messages, in milliseconds
var SEND_INTERVAL = 100;

// A colour as the server gives the players' colours
var COLOUR = /^#[0-9a-f]{6}$/i;
var DEFAULT_COLOUR = '#f8f8ff';


// A player's colour, or the default one
var colour = function(value) {
  return typeof(value) === 'string' && COLOUR.test(value) ? value : DEFAULT_COLOUR;
};


var isTile = function(x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
};


// What to tell the server about our pointer. pointer: {x, y, anchor} (anchor: the tile where a drag started, or null;
// see InputStatus.getPointer), or null when it is not over the map; tool: the name of the tool held, or null.
var message = function(pointer, tool) {
  if (pointer === null || typeof(pointer) !== 'object' || !isTile(pointer.x, pointer.y))
    return {t: 'cursor', x: null};

  var result = {t: 'cursor', x: pointer.x, y: pointer.y, tool: typeof(tool) === 'string' ? tool : null};
  var anchor = pointer.anchor;
  if (anchor && isTile(anchor.x, anchor.y)) {
    result.ax = anchor.x;
    result.ay = anchor.y;
  }

  return result;
};


// Sends our pointer as it changes: update is called with each frame's pointer message, and sends it when it differs
// from the last one sent, at most once per interval (the latest pointer goes at the next frame after that).
// send(message) returns false when it could not send (while the connection is down): the message is tried again.
function Sender(send, interval) {
  this._send = send;
  this._interval = interval || SEND_INTERVAL;
  this._lastKey = null;
  this._lastTime = -Infinity;
}


// Returns whether the message was sent
Sender.prototype.update = function(cursor, now) {
  var key = JSON.stringify(cursor);
  if (key === this._lastKey)
    return false;

  // Nothing to say about a pointer that was never on the map
  if (this._lastKey === null && cursor.x === null)
    return false;

  if (now - this._lastTime < this._interval || !this._send(cursor))
    return false;

  this._lastKey = key;
  this._lastTime = now;
  return true;
};


// Forgets what was sent (after reconnecting, the server knows nothing of it)
Sender.prototype.reset = function() {
  this._lastKey = null;
  this._lastTime = -Infinity;
};


// The tiles a tool covers around the tile it is applied at: {size, offset} (offset: from that tile to the footprint's
// top left corner), as its preview shows them (see Game.computeOverlay)
var footprint = function(tool) {
  if (typeof(tool) !== 'string' || !Placements.isApplicable(tool))
    return {size: 1, offset: 0};

  var brush = Placements.brushOf(tool);
  if (brush > 1)
    return {size: brush, offset: Math.floor((brush - 1) / 2)};

  var size = Placements.sizeOf(tool);
  return {size: size, offset: size > 2 ? 1 : 0};
};


// The outline of a pointer, clipped to the map: {x, y, width, height, colour, outline: true}, or null. entry: [x, y,
// tool, ax, ay] (ax and ay optional: the start of a drag, which the outline then surrounds)
var outline = function(entry, playerColour) {
  var x = entry[0];
  var y = entry[1];
  if (!isTile(x, y))
    return null;

  var size = footprint(entry[2]);
  var minX = x, minY = y, maxX = x, maxY = y;
  if (isTile(entry[3], entry[4])) {
    minX = Math.min(x, entry[3]);
    minY = Math.min(y, entry[4]);
    maxX = Math.max(x, entry[3]);
    maxY = Math.max(y, entry[4]);
  }

  var left = Math.max(0, minX - size.offset);
  var top = Math.max(0, minY - size.offset);
  var right = Math.min(WIDTH, maxX - size.offset + size.size);
  var bottom = Math.min(HEIGHT, maxY - size.offset + size.size);
  if (right <= left || bottom <= top)
    return null;

  return {x: left, y: top, width: right - left, height: bottom - top,
          colour: colour(playerColour), outline: true};
};


// The players' pointers, kept from the cursors messages: {id: [x, y, tool, ax, ay]}
function Pointers() {
  this._byId = Object.create(null);
}


// A cursors message's list: every pointer shown now (one that left the map is not in it, or has x null). Returns how
// many were taken.
Pointers.prototype.receive = function(list) {
  var byId = Object.create(null);
  var count = 0;
  if (!Array.isArray(list))
    return count;

  list.forEach(function(entry) {
    if (!Array.isArray(entry) || typeof(entry[0]) !== 'string' || entry[0] === '' || !isTile(entry[1], entry[2]))
      return;

    var tool = typeof(entry[3]) === 'string' ? entry[3] : null;
    byId[entry[0]] = isTile(entry[4], entry[5]) ? [entry[1], entry[2], tool, entry[4], entry[5]] :
                                                  [entry[1], entry[2], tool];
    count++;
  });

  this._byId = byId;
  return count;
};


// Keeps only the pointers of the given players (those still online)
Pointers.prototype.keep = function(ids) {
  Object.keys(this._byId).forEach(function(id) {
    if (ids.indexOf(id) === -1)
      delete this._byId[id];
  }, this);
};


Pointers.prototype.clear = function() {
  this._byId = Object.create(null);
};


Pointers.prototype.get = function(id) {
  return this._byId[id] || null;
};


// The outlines of the other players' pointers (see GameCanvas: the rects of its overlay). colours: {id: colour};
// ownId: our own id, whose pointer is not drawn.
Pointers.prototype.outlines = function(colours, ownId) {
  var rects = [];
  Object.keys(this._byId).forEach(function(id) {
    if (id === ownId)
      return;

    var rect = outline(this._byId[id], colours[id]);
    if (rect !== null)
      rects.push(rect);
  }, this);

  return rects;
};


var PlayerCursors = {
  SEND_INTERVAL: SEND_INTERVAL,
  DEFAULT_COLOUR: DEFAULT_COLOUR,
  colour: colour,
  footprint: footprint,
  message: message,
  outline: outline,
  Pointers: Pointers,
  Sender: Sender
};


export { PlayerCursors };
