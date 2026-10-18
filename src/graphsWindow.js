/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import $ from "jquery";

import { I18n } from './i18n.js';
import { GRAPHS_WINDOW_CLOSED } from './messages.ts';
import { MiscUtils } from './miscUtils.js';
import { ModalWindow } from './modalWindow.js';
import { Text } from './text.js';

// The city's history (see Census): the residential, commercial and industrial populations, the cash flow, crime
// and pollution. The 10 year history has a sample a month, the 120 year history a sample a year.
var SERIES = [
  {key: 'res', label: 'Residential', colour: '#4cc464'},
  {key: 'com', label: 'Commercial', colour: '#5c9cff'},
  {key: 'ind', label: 'Industrial', colour: '#f8c838'},
  {key: 'money', label: 'Cash flow', colour: '#6ee0d0'},
  {key: 'crime', label: 'Crime', colour: '#e04836'},
  {key: 'pollution', label: 'Pollution', colour: '#b08850'}
];

// City time units (see Simulation)
var TIME_PER_MONTH = 4;
var TIME_PER_YEAR = 48;
var SAMPLES = 120;

// Monthly samples are drawn for periods up to this many years: beyond, they would be too close together
var MONTHLY_SPAN = 20;

// The time axis is marked every so many years, as few as fit: the steps tried, and how many marks fit
var YEAR_STEPS = [1, 2, 5, 10, 20, 50, 100];
var MAX_MARKS = 15;
// The least room for each label of the axis, in pixels
var LABEL_SPACING = 40;

// A drag shorter than this, in pixels, is not a choice of period
var MIN_DRAG = 6;

var CANVAS_WIDTH = 520;
var CANVAS_HEIGHT = 240;
var MARGIN = {left: 12, right: 12, top: 24, bottom: 10};

var graphsFormID = '#graphsForm';
var canvasID = '#graphsCanvas';


var GraphsWindow = ModalWindow(function() {
  this._data = null;

  // The period shown: the last 10 or 120 years, the year to date, or the years chosen
  this._range = '10';
  // The years chosen, counted from the city's founding: {from, to}, both included
  this._custom = null;
  // The period being chosen by dragging across the graph: {start, end}, in pixels
  this._drag = null;
  this._shown = {res: true, com: true, ind: true, money: true, crime: true, pollution: true};

  $(graphsFormID).on('submit', submit.bind(this));

  var self = this;
  $('.graphsRange').on('change', function() {
    self._setRange($('.graphsRange:checked').val());
  });

  $('.graphsYear').on('change', function() {
    var from = $('#graphsFrom').val() - 0;
    var to = $('#graphsTo').val() - 0;

    // The period runs forwards: moving one end past the other moves both
    if (from > to) {
      if (this.id === 'graphsFrom')
        to = from;
      else
        from = to;
    }

    self._custom = {from: from, to: to};
    self._showCustom();
    self._paint();
  });

  $('.graphsSeries').on('change', function() {
    self._shown[$(this).val()] = $(this).prop('checked');
    self._paint();
  });

  var canvas = $(canvasID);
  canvas.on('pointerdown', function(e) {
    var x = self._canvasX(e);
    if (self._data === null || e.button !== 0 || x < MARGIN.left || x > CANVAS_WIDTH - MARGIN.right)
      return;

    this.setPointerCapture(e.pointerId);
    self._drag = {start: x, end: x};
    e.preventDefault();
  });

  canvas.on('pointermove', function(e) {
    if (self._drag === null)
      return;

    self._drag.end = MiscUtils.clamp(self._canvasX(e), MARGIN.left, CANVAS_WIDTH - MARGIN.right);
    self._paint();
  });

  canvas.on('pointerup', function() {
    if (self._drag === null)
      return;

    var drag = self._drag;
    self._drag = null;
    if (Math.abs(drag.end - drag.start) >= MIN_DRAG)
      self._chooseDragged(Math.min(drag.start, drag.end), Math.max(drag.start, drag.end));
    else
      self._paint();
  });

  canvas.on('pointercancel lostpointercapture', function() {
    if (self._drag === null)
      return;

    self._drag = null;
    self._paint();
  });
});


var submit = function(e) {
  e.preventDefault();
  this.close();
};


GraphsWindow.prototype.close = function() {
  this._data = null;
  this._drag = null;
  this._emitEvent(GRAPHS_WINDOW_CLOSED);
  this._toggleDisplay();
};


// data: {census, historyTime (the city time of the last census), startingYear}
GraphsWindow.prototype.open = function(data) {
  this._data = data;

  // The city has aged since the period was chosen
  if (this._custom !== null)
    this._custom = this._clampYears(this._custom.from, this._custom.to);

  $('.graphsSeries').each(function(i, element) {
    $(element).prop('checked', this._shown[$(element).val()]);
  }.bind(this));

  this._showRange();
  this._toggleDisplay();
  this._paint();
};


GraphsWindow.prototype._setRange = function(range) {
  // The first custom period is the one shown
  if (range === 'custom' && this._custom === null) {
    var view = this._view();
    this._custom = this._clampYears(Math.ceil(view.from / TIME_PER_YEAR), this._years().last);
  }

  this._range = range;
  this._showRange();
  this._paint();
};


GraphsWindow.prototype._showRange = function() {
  $('.graphsRange').each(function(i, element) {
    $(element).prop('checked', $(element).val() === this._range);
  }.bind(this));

  this._showCustom();
};


// The years of the city's history, counted from its founding: {first, last}
GraphsWindow.prototype._years = function() {
  var last = Math.floor(this._data.historyTime / TIME_PER_YEAR);
  return {first: Math.max(0, last - (SAMPLES - 1)), last: last};
};


GraphsWindow.prototype._clampYears = function(from, to) {
  var years = this._years();
  from = MiscUtils.clamp(from, years.first, years.last);
  return {from: from, to: MiscUtils.clamp(to, from, years.last)};
};


// Shows the years of the custom period, chosen among those of the city's history
GraphsWindow.prototype._showCustom = function() {
  var custom = this._range === 'custom';
  $('#graphsCustom').toggleClass('hidden', !custom);
  if (!custom)
    return;

  var years = this._years();
  var startingYear = this._data.startingYear;
  var options = [];
  for (var year = years.first; year <= years.last; year++)
    options.push('<option value="' + year + '">' + (startingYear + year) + '</option>');

  $('#graphsFrom').html(options.join('')).val(String(this._custom.from));
  $('#graphsTo').html(options.join('')).val(String(this._custom.to));
};


// The period shown, in city time: {from, to}. The last 10 or 120 years end with the last census; the year to date and
// the custom period end with their last year.
GraphsWindow.prototype._view = function() {
  var time = this._data.historyTime;
  var year = Math.floor(time / TIME_PER_YEAR);

  switch (this._range) {
    case '120':
      return {from: (year - (SAMPLES - 1)) * TIME_PER_YEAR, to: year * TIME_PER_YEAR};

    case 'ytd':
      return {from: year * TIME_PER_YEAR, to: (year + 1) * TIME_PER_YEAR};

    case 'custom':
      return {from: this._custom.from * TIME_PER_YEAR, to: (this._custom.to + 1) * TIME_PER_YEAR};

    default:
      var month = Math.floor(time / TIME_PER_MONTH);
      return {from: (month - (SAMPLES - 1)) * TIME_PER_MONTH, to: month * TIME_PER_MONTH};
  }
};


// The canvas coordinate of a pointer event, in CSS pixels of the drawing (the canvas may be scaled down)
GraphsWindow.prototype._canvasX = function(e) {
  var rect = $(canvasID)[0].getBoundingClientRect();
  return (e.clientX - rect.left) * CANVAS_WIDTH / (rect.width || CANVAS_WIDTH);
};


// Shows the years under the part of the graph dragged across, from x1 to x2
GraphsWindow.prototype._chooseDragged = function(x1, x2) {
  var view = this._view();
  var left = MARGIN.left;
  var width = CANVAS_WIDTH - MARGIN.right - left;
  var time = function(x) {
    return view.from + (x - left) * (view.to - view.from) / width;
  };

  // A year barely started at the end of the drag is left out
  var from = Math.floor(time(x1) / TIME_PER_YEAR);
  var to = Math.max(from, Math.floor((time(x2) - TIME_PER_MONTH / 2) / TIME_PER_YEAR));
  this._custom = this._clampYears(from, to);
  this._range = 'custom';
  this._showRange();
  this._paint();
};


// The samples of a series taken during the period, oldest first: {time, value}. Monthly samples are used when the
// period is short enough, and yearly samples for the years before the monthly history begins.
var samplesInView = function(census, key, view, time) {
  var points = [];
  var lastMonth = Math.floor(time / TIME_PER_MONTH);
  var months = Math.min(SAMPLES, lastMonth + 1);
  var monthly = view.to - view.from <= MONTHLY_SPAN * TIME_PER_YEAR;
  var monthlyFrom = monthly ? (lastMonth - months + 1) * TIME_PER_MONTH : Infinity;

  var lastYear = Math.floor(time / TIME_PER_YEAR);
  var years = Math.min(SAMPLES, lastYear + 1);
  var add = function(history, last, count, period, before) {
    for (var i = count - 1; i >= 0; i--) {
      var t = (last - i) * period;
      if (t >= view.from && t <= view.to && t < before)
        points.push({time: t, value: Math.max(0, history[i] || 0)});
    }
  };

  add(census[key + 'Hist120'], lastYear, years, TIME_PER_YEAR, monthlyFrom);
  if (monthly)
    add(census[key + 'Hist10'], lastMonth, months, TIME_PER_MONTH, Infinity);

  return points;
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
  var view = this._view();
  var left = MARGIN.left;
  var right = CANVAS_WIDTH - MARGIN.right;
  var top = MARGIN.top;
  var bottom = CANVAS_HEIGHT - MARGIN.bottom;
  var xOf = function(t) {
    return Math.round(left + (t - view.from) * (right - left) / (view.to - view.from));
  };

  // Background, with a dark inset frame
  ctx.fillStyle = '#0e1546';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = '#121b58';
  ctx.fillRect(left, top, right - left, bottom - top);

  this._paintAxis(ctx, view, xOf, right);

  var series = {};
  SERIES.forEach(function(s) {
    series[s.key] = samplesInView(census, s.key, view, this._data.historyTime);
  }, this);

  // The populations share a scale that fits them; crime, pollution and the cash flow are indexes from 0 to 255
  var populationMax = 32;
  ['res', 'com', 'ind'].forEach(function(key) {
    series[key].forEach(function(point) {
      populationMax = Math.max(populationMax, point.value);
    });
  });
  var height = bottom - top;
  var populationScale = height / (populationMax * 1.15);
  var indexScale = height / 256;

  // The cash flow is recorded around 128: mark its zero line
  if (this._shown.money) {
    var zero = Math.round(bottom - 128 * indexScale);
    ctx.fillStyle = 'rgba(110, 224, 208, 0.35)';
    for (var x = left; x < right; x += 6)
      ctx.fillRect(x, zero, 3, 1);
  }

  ctx.lineWidth = 2;
  ctx.lineJoin = 'miter';
  SERIES.forEach(function(s) {
    if (!this._shown[s.key])
      return;

    var points = series[s.key];
    var yScale = s.key === 'res' || s.key === 'com' || s.key === 'ind' ? populationScale : indexScale;
    tracePath(ctx, points, xOf, bottom, yScale, 1, 'rgba(7, 10, 31, 0.8)');
    tracePath(ctx, points, xOf, bottom, yScale, 0, s.colour);
  }, this);

  // The period being chosen
  if (this._drag !== null) {
    var start = Math.round(Math.min(this._drag.start, this._drag.end));
    var end = Math.round(Math.max(this._drag.start, this._drag.end));
    ctx.fillStyle = 'rgba(248, 200, 56, 0.2)';
    ctx.fillRect(start, top, end - start, bottom - top);
    ctx.fillStyle = '#f8c838';
    ctx.fillRect(start, top, 1, bottom - top);
    ctx.fillRect(end, top, 1, bottom - top);
  }

  // The frame on top
  ctx.strokeStyle = '#070a1f';
  ctx.lineWidth = 2;
  ctx.strokeRect(left - 1, top - 1, right - left + 2, bottom - top + 2);
};


// The time axis: a line at the start of each month (named, January by its year) over a year or less, or else at the
// start of each year or group of years (labelled with the year), with faint lines for the months when there is room
GraphsWindow.prototype._paintAxis = function(ctx, view, xOf, right) {
  var top = MARGIN.top;
  var bottom = CANVAS_HEIGHT - MARGIN.bottom;
  var span = view.to - view.from;
  var width = right - MARGIN.left;
  var startingYear = this._data.startingYear;
  // Nothing is marked before the city was founded, nor at the very end of the period
  var first = Math.max(0, view.from);
  var labelEnd = -Infinity;

  ctx.font = '12px DotGothic16, monospace';
  ctx.textBaseline = 'top';

  var line = function(t, colour) {
    ctx.fillStyle = colour;
    ctx.fillRect(xOf(t), top, 1, bottom - top);
  };

  // Labels are kept apart, and inside the graph
  var label = function(t, text) {
    var textWidth = ctx.measureText(text).width;
    var x = Math.min(xOf(t) + 2, right - textWidth - 2);
    if (x < labelEnd + 4)
      return;

    ctx.fillStyle = '#b4bdee';
    ctx.fillText(text, x, 6);
    labelEnd = x + textWidth;
  };

  var t;
  if (span <= TIME_PER_YEAR) {
    for (t = Math.ceil(first / TIME_PER_MONTH) * TIME_PER_MONTH; t < view.to; t += TIME_PER_MONTH) {
      var month = Math.floor((t % TIME_PER_YEAR) / TIME_PER_MONTH);
      line(t, '#2d419c');
      label(t, month === 0 ? String(startingYear + t / TIME_PER_YEAR) : I18n.t(Text.months[month]));
    }
    return;
  }

  if (width * TIME_PER_MONTH / span >= 8) {
    for (t = Math.ceil(first / TIME_PER_MONTH) * TIME_PER_MONTH; t < view.to; t += TIME_PER_MONTH) {
      if (t % TIME_PER_YEAR !== 0)
        line(t, '#1a2670');
    }
  }

  var years = span / TIME_PER_YEAR;
  var step = YEAR_STEPS.find(function(s) { return years / s <= MAX_MARKS; }) || YEAR_STEPS[YEAR_STEPS.length - 1];
  var spacing = width * step / years;
  var labelStep = YEAR_STEPS.find(function(s) { return s % step === 0 && spacing * s / step >= LABEL_SPACING; }) ||
                  YEAR_STEPS[YEAR_STEPS.length - 1];

  for (var year = Math.ceil(first / TIME_PER_YEAR); year * TIME_PER_YEAR < view.to; year++) {
    var calendarYear = startingYear + year;
    if (calendarYear % step !== 0)
      continue;

    line(year * TIME_PER_YEAR, '#2d419c');
    if (calendarYear % labelStep === 0)
      label(year * TIME_PER_YEAR, String(calendarYear));
  }
};


// Draws a series (offset by a pixel or two for its shadow); a single sample is drawn as a dot
var tracePath = function(ctx, points, xOf, bottom, yScale, offset, colour) {
  if (points.length === 0)
    return;

  var y = function(value) {
    return Math.round(bottom - Math.min(value * yScale, bottom - MARGIN.top)) + offset;
  };

  if (points.length === 1) {
    ctx.fillStyle = colour;
    ctx.fillRect(xOf(points[0].time) + offset - 2, y(points[0].value) - 2, 4, 4);
    return;
  }

  ctx.beginPath();
  points.forEach(function(point, i) {
    if (i === 0)
      ctx.moveTo(xOf(point.time) + offset, y(point.value));
    else
      ctx.lineTo(xOf(point.time) + offset, y(point.value));
  });
  ctx.strokeStyle = colour;
  ctx.stroke();
};


GraphsWindow.samplesInView = samplesInView;


export { GraphsWindow };
