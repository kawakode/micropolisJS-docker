/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import $ from "jquery";

import { GRAPHS_WINDOW_CLOSED } from './messages.ts';
import { ModalWindow } from './modalWindow.js';

// The city's history (see Census): the residential, commercial and industrial populations, the cash flow, crime
// and pollution, over the last 10 or 120 years
var SERIES = [
  {key: 'res', label: 'Residential', colour: '#4cc464'},
  {key: 'com', label: 'Commercial', colour: '#5c9cff'},
  {key: 'ind', label: 'Industrial', colour: '#f8c838'},
  {key: 'money', label: 'Cash flow', colour: '#6ee0d0'},
  {key: 'crime', label: 'Crime', colour: '#e04836'},
  {key: 'pollution', label: 'Pollution', colour: '#b08850'}
];

// How many city time units (see Simulation) separate two samples of each history
var SAMPLE_PERIOD = {'10': 4, '120': 48};
var TIME_PER_YEAR = 48;
var SAMPLES = 120;

var CANVAS_WIDTH = 520;
var CANVAS_HEIGHT = 240;
var MARGIN = {left: 12, right: 12, top: 24, bottom: 10};

var graphsFormID = '#graphsForm';
var canvasID = '#graphsCanvas';


var GraphsWindow = ModalWindow(function() {
  this._data = null;
  this._range = '10';
  this._shown = {res: true, com: true, ind: true, money: true, crime: true, pollution: true};

  $(graphsFormID).on('submit', submit.bind(this));

  var self = this;
  $('.graphsRange').on('change', function() {
    self._range = $('.graphsRange:checked').val();
    self._paint();
  });

  $('.graphsSeries').on('change', function() {
    self._shown[$(this).val()] = $(this).prop('checked');
    self._paint();
  });
});


var submit = function(e) {
  e.preventDefault();
  this.close();
};


GraphsWindow.prototype.close = function() {
  this._data = null;
  this._emitEvent(GRAPHS_WINDOW_CLOSED);
  this._toggleDisplay();
};


// data: {census, cityTime, startingYear}
GraphsWindow.prototype.open = function(data) {
  this._data = data;

  $('.graphsRange').each(function(i, element) {
    $(element).prop('checked', $(element).val() === this._range);
  }.bind(this));

  $('.graphsSeries').each(function(i, element) {
    $(element).prop('checked', this._shown[$(element).val()]);
  }.bind(this));

  this._toggleDisplay();
  this._paint();
};


GraphsWindow.prototype._paint = function() {
  if (this._data === null)
    return;

  var canvas = $(canvasID)[0];
  var ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(CANVAS_WIDTH * ratio);
  canvas.height = Math.round(CANVAS_HEIGHT * ratio);

  var ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingEnabled = false;

  var census = this._data.census;
  var range = this._range;
  var left = MARGIN.left;
  var right = CANVAS_WIDTH - MARGIN.right;
  var top = MARGIN.top;
  var bottom = CANVAS_HEIGHT - MARGIN.bottom;
  var step = (right - left) / (SAMPLES - 1);

  // Background, with a dark inset frame
  ctx.fillStyle = '#0e1546';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = '#121b58';
  ctx.fillRect(left, top, right - left, bottom - top);

  // Years: a vertical line at the start of each year (10 years) or decade (120 years), labelled
  var period = SAMPLE_PERIOD[range];
  var yearsPerMark = range === '10' ? 1 : 10;
  var latest = Math.floor(this._data.cityTime / period);
  ctx.font = '12px DotGothic16, monospace';
  ctx.textBaseline = 'top';
  var labelled = 0;
  for (var i = 0; i < SAMPLES; i++) {
    var time = (latest - (SAMPLES - 1) + i) * period;
    if (time < 0 || time % (TIME_PER_YEAR * yearsPerMark) >= period)
      continue;

    var x = Math.round(left + i * step);
    ctx.fillStyle = '#2d419c';
    ctx.fillRect(x, top, 1, bottom - top);

    var year = this._data.startingYear + Math.floor(time / TIME_PER_YEAR);
    // Only label every other mark when the 10 year graph is crowded
    if (range === '10' && (labelled++ % 2) === 1)
      continue;

    ctx.fillStyle = '#b4bdee';
    ctx.fillText(String(year), Math.min(x + 2, right - 30), 6);
  }

  // How many samples have been taken since the city was founded
  var available = Math.min(SAMPLES, latest + 1);

  // The populations share a scale that fits them; crime, pollution and the cash flow are indexes from 0 to 255
  var populationMax = 32;
  ['res', 'com', 'ind'].forEach(function(key) {
    var history = census[key + 'Hist' + range];
    for (var j = 0; j < available; j++)
      populationMax = Math.max(populationMax, history[j] || 0);
  });
  var height = bottom - top;
  var populationScale = height / (populationMax * 1.15);
  var indexScale = height / 256;

  // The cash flow is recorded around 128: mark its zero line
  if (this._shown.money) {
    var zero = Math.round(bottom - 128 * indexScale);
    ctx.fillStyle = 'rgba(110, 224, 208, 0.35)';
    for (x = left; x < right; x += 6)
      ctx.fillRect(x, zero, 3, 1);
  }

  ctx.lineWidth = 2;
  ctx.lineJoin = 'miter';
  SERIES.forEach(function(series) {
    if (!this._shown[series.key])
      return;

    var history = census[series.key + 'Hist' + range];
    var yScale = series.key === 'res' || series.key === 'com' || series.key === 'ind' ? populationScale : indexScale;
    ctx.strokeStyle = 'rgba(7, 10, 31, 0.8)';
    tracePath(ctx, history, available, left + 1, bottom + 1, step, yScale);
    ctx.stroke();
    ctx.strokeStyle = series.colour;
    tracePath(ctx, history, available, left, bottom, step, yScale);
    ctx.stroke();
  }, this);

  // The frame on top
  ctx.strokeStyle = '#070a1f';
  ctx.lineWidth = 2;
  ctx.strokeRect(left - 1, top - 1, right - left + 2, bottom - top + 2);
};


// Index 0 of a history is the latest sample, drawn on the right; only the samples taken so far are drawn
var tracePath = function(ctx, history, available, left, bottom, step, yScale) {
  ctx.beginPath();
  for (var i = SAMPLES - available; i < SAMPLES; i++) {
    var value = Math.max(0, history[SAMPLES - 1 - i] || 0);
    var x = Math.round(left + i * step);
    var y = Math.round(bottom - Math.min(value * yScale, bottom - MARGIN.top));
    if (i === SAMPLES - available)
      ctx.moveTo(x, y);
    else
      ctx.lineTo(x, y);
  }
};


export { GraphsWindow };
