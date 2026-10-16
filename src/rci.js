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

import { VALVES_UPDATED } from './messages.ts';
import { MiscUtils } from './miscUtils.js';

function RCI(parentNode, eventSource, id) {
  if (arguments.length < 2)
    throw new Error('RCI constructor called with too few arguments ' + [].toString.apply(arguments));

  if (id === undefined)
    id = RCI.DEFAULT_ID;

  if (typeof(parentNode) === 'string') {
    var orig = parentNode;
    parentNode = $(MiscUtils.normaliseDOMid(parentNode));
    parentNode = parentNode.length === 0 ? null : parentNode[0];
    if (parentNode === null)
      throw new Error('Node ' + orig + ' not found');
  }

  this._canvas = $('<canvas></canvas>', {id: id})[0];

  // Remove any existing element with the same id
  var elems = $(MiscUtils.normaliseDOMid(id));
  var current = elems.length > 0 ? elems[0] : null;
  if (current !== null) {
    if (current.parentNode === parentNode)
      parentNode.replaceChild(this._canvas, current);
    else
      throw new Error('ID ' + id + ' already exists in document!');
  } else
    parentNode.appendChild(this._canvas);

  // The last values displayed: we repaint them when the display changes size
  this._lastData = undefined;

  eventSource.addEventListener(VALVES_UPDATED, this.update.bind(this));
}


var COLOURS = ['#4ade80', '#60a5fa', '#facc15'];
var LABELS = ['R', 'C', 'I'];


// Values are in the range -2000 to 2000 for residential, and -1500 to 1500 for commercial and industrial
var normalise = function(index, value) {
  var max = index === 0 ? 2000 : 1500;
  return Math.max(-1, Math.min(1, value / max));
};


RCI.prototype.update = function(data) {
  if (data !== undefined)
    this._lastData = data;

  data = this._lastData;
  if (data === undefined)
    return;

  // The canvas fills its container; match its backing store to the on-screen size
  var dpr = window.devicePixelRatio || 1;
  var cssWidth = this._canvas.clientWidth || this._canvas.parentNode.clientWidth;
  var cssHeight = this._canvas.clientHeight || 72;
  if (cssWidth === 0)
    return;

  var width = Math.round(cssWidth * dpr);
  var height = Math.round(cssHeight * dpr);
  if (this._canvas.width !== width || this._canvas.height !== height) {
    this._canvas.width = width;
    this._canvas.height = height;
  }

  var ctx = this._canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  var labelWidth = 44;
  var midY = cssHeight / 2;
  var half = cssHeight / 2 - 4;
  var barArea = cssWidth - labelWidth;
  var slot = barArea / 3;
  var barWidth = Math.min(28, slot * 0.6);

  // Axis and caption
  ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.fillRect(labelWidth, midY - 0.5, barArea, 1);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('Demand', 0, midY);

  var values = [data.residential, data.commercial, data.industrial];
  for (var i = 0; i < 3; i++) {
    var value = normalise(i, values[i]);
    var x = labelWidth + slot * i + (slot - barWidth) / 2;
    var barHeight = Math.max(1, Math.abs(value) * half);

    ctx.fillStyle = COLOURS[i];
    ctx.globalAlpha = value >= 0 ? 1 : 0.55;
    if (value >= 0)
      ctx.fillRect(x, midY - barHeight, barWidth, barHeight);
    else
      ctx.fillRect(x, midY, barWidth, barHeight);
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#0b1220';
    ctx.textAlign = 'center';
    ctx.font = '700 10px system-ui, sans-serif';
    var labelY = value >= 0 ? midY + 8 : midY - 8;
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(LABELS[i], x + barWidth / 2, labelY);
  }
};


Object.defineProperty(RCI, 'DEFAULT_ID', MiscUtils.makeConstantDescriptor('RCICanvas'));

export { RCI };
