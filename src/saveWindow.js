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

import { SAVE_WINDOW_CLOSED } from './messages.ts';
import { ModalWindow } from './modalWindow.js';

var SaveWindow = ModalWindow(function() {
  $(saveFormID).on('submit', submit.bind(this));
});


var saveFormID = '#saveForm';
var saveOKID = '#saveOK';


var submit = function(e) {
  e.preventDefault();
  this.close();
};


SaveWindow.prototype.close = function() {
  this._toggleDisplay();
  this._emitEvent(SAVE_WINDOW_CLOSED);
};


// downloadURL and fileName: the game as a file, to keep or to move to another browser
SaveWindow.prototype.open = function(succeeded, downloadURL, fileName) {
  $('#saveMessage').text(succeeded === false ?
    'Sorry, the game could not be saved in this browser: it may be blocking storage, or it may be full. You can still keep it as a file.' :
    'Game saved! Choose "Load saved game" on the title screen to carry on later.');

  var link = $('#saveDownload');
  var previous = link.attr('href');
  if (previous && previous.indexOf('blob:') === 0)
    URL.revokeObjectURL(previous);
  $('.saveFile').toggle(!!downloadURL);
  if (downloadURL)
    link.attr({href: downloadURL, download: fileName});

  this._toggleDisplay();
  $(saveOKID).focus();
};


export { SaveWindow };
