/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import $ from "jquery";

import { I18n } from './i18n.js';

// The news ticker along the bottom of the screen. Its items scroll from right to left; each one is asked for (see
// TickerNews) when there is room for it, so that it is up to date as it comes into view. The ticker stops under the
// mouse, to be read, and an item about a place on the map shows it when clicked. When the system asks for reduced
// motion, the items are shown one at a time instead.

// Scrolling speed, in CSS pixels per second
var SPEED = 70;

// Space between items, and before the first one, in CSS pixels
var GAP = 64;
var START = 12;

// How long each item is shown without scrolling, in milliseconds
var STILL_TIME = 9000;


// nextItem: returns the next item to show ({kind, tag, text}, and x and y for a place on the map). showPlace: called
// with the coordinates of the place when an item about one is clicked.
function Ticker(elementID, nextItem, showPlace) {
  this._element = $(elementID);
  this._track = this._element.find('.tickerTrack');
  this._nextItem = nextItem;

  // The items in the track, from left to right: {element, x, width}
  this._items = [];
  this._hovered = false;
  this._stillTime = 0;

  var self = this;
  var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  this._setStill(motion !== null && motion.matches);
  if (motion !== null && motion.addEventListener)
    motion.addEventListener('change', function(e) { self._setStill(e.matches); });

  this._track.on('mouseenter', function() { self._hovered = true; });
  this._track.on('mouseleave', function() { self._hovered = false; });
  this._track.on('click', '.tickerLink', function(e) {
    e.preventDefault();
    showPlace($(this).attr('data-x') - 0, $(this).attr('data-y') - 0);
  });
}


Ticker.prototype._setStill = function(still) {
  this._still = still;
  this._element.toggleClass('still', still);
  this._clear();
};


// Forgets the items shown, to start again with new ones (in another language, for example)
Ticker.prototype.reset = function() {
  this._clear();
};


Ticker.prototype._clear = function() {
  this._items.forEach(function(item) { item.element.remove(); });
  this._items = [];
  this._stillTime = 0;
};


// Adds the next item to the track, at x
Ticker.prototype._add = function(x) {
  var item = this._nextItem();
  var element = $('<span class="tickerItem"></span>').addClass(item.kind);
  $('<span class="tickerTag"></span>').text(item.tag).appendTo(element);
  $('<span class="tickerText"></span>').text(item.text).appendTo(element);

  if (typeof(item.x) === 'number' && typeof(item.y) === 'number')
    element.addClass('tickerLink').attr({'data-x': item.x, 'data-y': item.y, title: I18n.t('Show on the map')});
  else if (this._still)
    element.attr('title', item.text);

  this._track.append(element);
  var entry = {element: element, x: x, width: element[0].offsetWidth};
  this._items.push(entry);
  return entry;
};


// Called once per frame with the elapsed time in milliseconds
Ticker.prototype.update = function(elapsed) {
  var width = this._track[0] ? this._track[0].clientWidth : 0;
  if (width === 0)
    return;

  // Avoid huge jumps after the tab has been in the background
  elapsed = Math.min(elapsed, 100);

  if (this._still) {
    if (!this._hovered)
      this._stillTime -= elapsed;

    if (this._stillTime <= 0) {
      this._clear();
      this._add(START).element[0].style.transform = 'translateX(' + START + 'px)';
      this._stillTime = STILL_TIME;
    }
    return;
  }

  var items = this._items;
  var i;

  if (!this._hovered) {
    var distance = SPEED * elapsed / 1000;
    for (i = 0; i < items.length; i++)
      items[i].x -= distance;
  }

  // Forget the items that have scrolled out of view
  while (items.length > 0 && items[0].x + items[0].width < 0)
    items.shift().element.remove();

  // The first item starts in view; the next ones come in from the right, as soon as there is room for them
  var last = items[items.length - 1];
  if (last === undefined)
    last = this._add(START);

  while (last.x + last.width + GAP < width)
    last = this._add(Math.max(width, last.x + last.width + GAP));

  // Whole device pixels keep the text sharp
  var ratio = window.devicePixelRatio || 1;
  for (i = 0; i < items.length; i++)
    items[i].element[0].style.transform = 'translateX(' + Math.round(items[i].x * ratio) / ratio + 'px)';
};


export { Ticker };
