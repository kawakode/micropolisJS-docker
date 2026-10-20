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

import $ from "jquery";

import { Config } from './config.js';
import { EventEmitter } from './eventEmitter.js';
import { QUERY_WINDOW_CLOSED } from './messages.ts';

// What the query tool found, in a panel beside the map: it doesn't stop the city, and the next click on the map
// shows the next tile. It closes with its button, or Escape.
var QueryWindow = EventEmitter(function() {
  this._debugToggled = false;
  $('#queryClose').on('click', function(e) {
    e.preventDefault();
    this.close();
  }.bind(this));
});


QueryWindow.prototype.isOpen = function() {
  return !$('#queryWindow').hasClass('hidden');
};


QueryWindow.prototype.close = function() {
  if (!this.isOpen())
    return;

  $('#queryWindow').addClass('hidden');
  this._emitEvent(QUERY_WINDOW_CLOSED);
};


QueryWindow.prototype.open = function() {
  if ((Config.debug || Config.queryDebug) && !this._debugToggled) {
    this._debugToggled = true;
    $('.queryDebug').removeClass('hidden');
  }

  $('#queryWindow').removeClass('hidden');
};


export { QueryWindow };
