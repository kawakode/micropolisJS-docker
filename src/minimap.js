/* KawaCity, a city simulator based on micropolisJS by Graeme McCutcheon.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 * The name/term "MICROPOLIS" is a registered trademark of Micropolis (https://www.micropolis.com) GmbH
 * (Micropolis Corporation, the "licensor") and is licensed here to the authors/publishers of the "Micropolis"
 * city simulation game and its source code (the project or "licensee(s)") as a courtesy of the owner.
 *
 */

import $ from "jquery";

import { FireCover } from './fireCover.js';
import { I18n } from './i18n.js';
import { MiscUtils } from './miscUtils.js';
import { BIT_MASK, CONDBIT } from "./tileFlags.ts";
import { TILE_COUNT } from "./tileValues.ts";

/*
 *
 * The minimap shows the whole city, with a frame marking the part of the map in view. Clicking or dragging on
 * it moves the view. It can also show data overlays (pollution, crime, land value...), which are painted on the
 * main map too.
 *
 */

var TILE_SIZE = 16;
var REFRESH_INTERVAL = 500;

// Colour ramps for the data overlays, from low to high values
var RAMP_BAD = [[34, 197, 94], [250, 204, 21], [239, 68, 68]];   // green -> yellow -> red: high is bad
var RAMP_GOOD = [[239, 68, 68], [250, 204, 21], [34, 197, 94]];  // red -> yellow -> green: high is good
var RAMP_DENSITY = [[30, 64, 175], [168, 85, 247], [244, 114, 182]];
var RAMP_COVER = [[30, 41, 59], [56, 189, 248], [224, 242, 254]];

// Each overlay reads a block map and scales its values to [0, 1]
var overlays = {
  population: {map: 'populationDensityMap', max: 255, ramp: RAMP_DENSITY, low: 'Empty', high: 'Dense'},
  traffic: {map: 'trafficDensityMap', max: 240, ramp: RAMP_BAD, low: 'Light', high: 'Heavy'},
  pollution: {map: 'pollutionDensityMap', max: 200, ramp: RAMP_BAD, low: 'Clean', high: 'Polluted'},
  crime: {map: 'crimeRateMap', max: 200, ramp: RAMP_BAD, low: 'Safe', high: 'Dangerous'},
  landValue: {map: 'landValueMap', max: 200, ramp: RAMP_GOOD, low: 'Low', high: 'High'},
  police: {map: 'policeStationEffectMap', max: 300, ramp: RAMP_COVER, low: 'None', high: 'Full'},
  fire: {map: 'fireStationEffectMap', max: FireCover.FULL_COVER, ramp: RAMP_COVER, low: 'None', high: 'Full'},
  education: {map: 'educationEffectMap', max: 300, ramp: RAMP_COVER, low: 'None', high: 'Full'},
  health: {map: 'healthEffectMap', max: 300, ramp: RAMP_COVER, low: 'None', high: 'Full'},
  // The rate of growth ranges from -max to max
  growth: {map: 'rateOfGrowthMap', max: 100, signed: true, ramp: RAMP_GOOD, low: 'Declining', high: 'Growing'},
  power: {power: true, low: 'Unpowered', high: 'Powered'}
};

var POWERED = [250, 204, 21];
var UNPOWERED = [239, 68, 68];


var interpolate = function(ramp, t) {
  t = MiscUtils.clamp(t, 0, 1);
  var scaled = t * (ramp.length - 1);
  var i = Math.min(Math.floor(scaled), ramp.length - 2);
  var f = scaled - i;
  var a = ramp[i];
  var b = ramp[i + 1];
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
};


// Computes the average colour of each tile in the tile set, for painting the map at one pixel per tile
var computeTileColours = function(tileSet) {
  var colours = new Uint8ClampedArray(TILE_COUNT * 3);
  var perRow = tileSet.tilesPerRow;

  try {
    var canvas = document.createElement('canvas');
    canvas.width = perRow * TILE_SIZE;
    canvas.height = perRow * TILE_SIZE;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(tileSet.image, 0, 0);
    var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    for (var tile = 0; tile < TILE_COUNT; tile++) {
      var ox = (tile % perRow) * TILE_SIZE;
      var oy = Math.floor(tile / perRow) * TILE_SIZE;
      var r = 0, g = 0, b = 0;

      for (var y = 0; y < TILE_SIZE; y++) {
        for (var x = 0; x < TILE_SIZE; x++) {
          var index = ((oy + y) * canvas.width + ox + x) * 4;
          r += data[index];
          g += data[index + 1];
          b += data[index + 2];
        }
      }

      var n = TILE_SIZE * TILE_SIZE;
      colours[tile * 3] = r / n;
      colours[tile * 3 + 1] = g / n;
      colours[tile * 3 + 2] = b / n;
    }
  } catch (e) {
    // The image may be unreadable (e.g. when running from the file system): fall back to a neutral colour
    for (var i = 0; i < TILE_COUNT; i++) {
      colours[i * 3] = 120;
      colours[i * 3 + 1] = 110;
      colours[i * 3 + 2] = 90;
    }
  }

  return colours;
};


function Minimap(parentID, map, simulation, gameCanvas, tileSet) {
  this._map = map;
  this._simulation = simulation;
  this._gameCanvas = gameCanvas;
  this._overlay = 'none';
  this._lastRefresh = 0;

  // Where the power reaches (see setPowerSource): by default, the power manager's grid
  this._powerSource = null;
  this._colours = computeTileColours(tileSet);

  this._parent = $(MiscUtils.normaliseDOMid(parentID))[0];
  this._canvas = document.createElement('canvas');
  this._canvas.setAttribute('aria-label', I18n.t('Map of the city: click to move the view'));
  this._parent.appendChild(this._canvas);

  // The map is painted at one pixel per tile into an offscreen canvas, then scaled up
  this._mapCanvas = document.createElement('canvas');
  this._mapCanvas.width = map.width;
  this._mapCanvas.height = map.height;
  this._mapContext = this._mapCanvas.getContext('2d');
  this._imageData = this._mapContext.createImageData(map.width, map.height);

  // Cached overlay colours (or null) per tile, and the same painted at one pixel per tile for the main map
  this._overlayColours = null;
  this._overlayCanvas = document.createElement('canvas');
  this._overlayCanvas.width = map.width;
  this._overlayCanvas.height = map.height;
  this._overlayContext = this._overlayCanvas.getContext('2d');

  var self = this;
  var dragging = false;
  var moveView = function(e) {
    var rect = self._canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width * self._map.width;
    var y = (e.clientY - rect.top) / rect.height * self._map.height;
    self._gameCanvas.centreOn(MiscUtils.clamp(Math.floor(x), 0, self._map.width - 1),
                              MiscUtils.clamp(Math.floor(y), 0, self._map.height - 1));
  };

  this._canvas.addEventListener('pointerdown', function(e) {
    dragging = true;
    try {
      self._canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      // Ignore
    }
    moveView(e);
    e.preventDefault();
  });

  this._canvas.addEventListener('pointermove', function(e) {
    if (dragging)
      moveView(e);
  });

  var stop = function() {
    dragging = false;
  };
  this._canvas.addEventListener('pointerup', stop);
  this._canvas.addEventListener('pointercancel', stop);

  this._legend = $('<div class="overlayLegend hidden"><span class="low"></span><span class="ramp"></span><span class="high"></span></div>');
  $(this._parent).parent().append(this._legend);

  $('#overlaySelect').on('change', function() {
    self.setOverlay($(this).val());
  });
}


Minimap.prototype.setOverlay = function(name) {
  this._overlay = overlays[name] ? name : 'none';
  this._lastRefresh = 0;

  var overlay = overlays[this._overlay];
  if (!overlay) {
    this._legend.addClass('hidden');
    return;
  }

  var ramp = overlay.power ? [UNPOWERED, POWERED] : overlay.ramp;
  var stops = ramp.map(function(c) { return 'rgb(' + c.join(',') + ')'; }).join(', ');
  this._legend.find('.low').text(I18n.t('legend|' + overlay.low));
  this._legend.find('.high').text(I18n.t('legend|' + overlay.high));
  this._legend.find('.ramp').css('background', 'linear-gradient(90deg, ' + stops + ')');
  this._legend.removeClass('hidden');
};


// Shows the texts again, in the current language
Minimap.prototype.translate = function() {
  this._canvas.setAttribute('aria-label', I18n.t('Map of the city: click to move the view'));
  this.setOverlay(this._overlay);
};


// For a shared city, whose power grid the server keeps: source() gives the tiles the power reaches, as a Uint8Array of
// the map's tiles, row by row (see RemoteCity.poweredTiles)
Minimap.prototype.setPowerSource = function(source) {
  this._powerSource = source;
  this._lastRefresh = 0;
};


// Returns a canvas with the current data overlay at one pixel per tile, or null if there is no overlay
Minimap.prototype.getOverlayCanvas = function() {
  return this._overlay === 'none' ? null : this._overlayCanvas;
};


Minimap.prototype._computeOverlay = function() {
  var overlay = overlays[this._overlay];
  var map = this._map;
  var count = map.width * map.height;

  if (this._overlayColours === null || this._overlayColours.length !== count * 4)
    this._overlayColours = new Uint8ClampedArray(count * 4);

  var result = this._overlayColours;
  var x, y, i, colour;

  if (overlay.power) {
    var powerGrid = this._simulation._powerManager.powerGridMap;
    var powered = this._powerSource !== null ? this._powerSource() : null;

    for (y = 0; y < map.height; y++) {
      for (x = 0; x < map.width; x++) {
        i = (y * map.width + x) * 4;
        var raw = map.getTile(x, y).getRawValue();

        if (!(raw & CONDBIT)) {
          result[i + 3] = 0;
          continue;
        }

        if (powered !== null)
          colour = powered[y * map.width + x] ? POWERED : UNPOWERED;
        else
          colour = powerGrid.worldGet(x, y) > 0 ? POWERED : UNPOWERED;
        result[i] = colour[0];
        result[i + 1] = colour[1];
        result[i + 2] = colour[2];
        result[i + 3] = 170;
      }
    }

    return;
  }

  var blockMap = this._simulation.blockMaps[overlay.map];

  for (y = 0; y < map.height; y++) {
    for (x = 0; x < map.width; x++) {
      i = (y * map.width + x) * 4;
      var value = blockMap.worldGet(x, y);

      if (value === 0 || (value < 0 && !overlay.signed)) {
        result[i + 3] = 0;
        continue;
      }

      colour = interpolate(overlay.ramp, overlay.signed ? (value + overlay.max) / (2 * overlay.max) : value / overlay.max);
      result[i] = colour[0];
      result[i + 1] = colour[1];
      result[i + 2] = colour[2];
      result[i + 3] = 150;
    }
  }
};


Minimap.prototype._refreshMap = function() {
  var map = this._map;
  var data = this._imageData.data;
  var colours = this._colours;
  var overlay = this._overlay !== 'none';

  if (overlay) {
    this._computeOverlay();
    var overlayImage = new ImageData(this._overlayColours, map.width, map.height);
    this._overlayContext.putImageData(overlayImage, 0, 0);
  }

  var overlayColours = this._overlayColours;

  for (var y = 0; y < map.height; y++) {
    for (var x = 0; x < map.width; x++) {
      var tile = map.getTile(x, y).getRawValue() & BIT_MASK;
      var i = (y * map.width + x) * 4;
      var c = tile * 3;
      var r = colours[c], g = colours[c + 1], b = colours[c + 2];

      if (overlay) {
        // Darken and desaturate the map, so the overlay stands out
        var grey = (r + g + b) / 3;
        r = g = b = grey * 0.45;

        var alpha = overlayColours[i + 3] / 255;
        if (alpha > 0) {
          r = r * (1 - alpha) + overlayColours[i] * alpha;
          g = g * (1 - alpha) + overlayColours[i + 1] * alpha;
          b = b * (1 - alpha) + overlayColours[i + 2] * alpha;
        }
      }

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }

  this._mapContext.putImageData(this._imageData, 0, 0);
};


// Called every frame
Minimap.prototype.paint = function(force) {
  var now = Date.now();
  if (force || now - this._lastRefresh > REFRESH_INTERVAL) {
    this._refreshMap();
    this._lastRefresh = now;
  }

  var dpr = window.devicePixelRatio || 1;
  var cssWidth = this._parent.clientWidth;
  var cssHeight = this._parent.clientHeight;
  if (cssWidth === 0 || cssHeight === 0)
    return;

  var width = Math.round(cssWidth * dpr);
  var height = Math.round(cssHeight * dpr);
  if (this._canvas.width !== width || this._canvas.height !== height) {
    this._canvas.width = width;
    this._canvas.height = height;
  }

  var ctx = this._canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(this._mapCanvas, 0, 0, width, height);

  // Frame the visible area
  var view = this._gameCanvas.getVisibleWorldRect();
  var scaleX = width / (this._map.width * TILE_SIZE);
  var scaleY = height / (this._map.height * TILE_SIZE);
  var lineWidth = Math.max(1, Math.round(1.5 * dpr));

  var frame = [Math.round(view.x * scaleX), Math.round(view.y * scaleY), Math.round(view.width * scaleX),
               Math.round(view.height * scaleY)];
  ctx.lineWidth = lineWidth;

  if (view.screen) {
    // The isometric view sees a diamond of the map
    var screen = view.screen;
    var corners = [view.toMap(screen.x, screen.y), view.toMap(screen.x + screen.width, screen.y),
                   view.toMap(screen.x + screen.width, screen.y + screen.height),
                   view.toMap(screen.x, screen.y + screen.height)];
    [['#070a1f', lineWidth], ['#f8c838', 0]].forEach(function(style) {
      ctx.beginPath();
      corners.forEach(function(corner, i) {
        var px = Math.round(corner.x * scaleX) + style[1];
        var py = Math.round(corner.y * scaleY) + style[1];
        if (i === 0)
          ctx.moveTo(px, py);
        else
          ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.strokeStyle = style[0];
      ctx.stroke();
    });
    return;
  }

  ctx.strokeStyle = '#070a1f';
  ctx.strokeRect(frame[0] + lineWidth * 1.5, frame[1] + lineWidth * 1.5, frame[2] - lineWidth, frame[3] - lineWidth);
  ctx.strokeStyle = '#f8c838';
  ctx.strokeRect(frame[0] + lineWidth / 2, frame[1] + lineWidth / 2, frame[2] - lineWidth, frame[3] - lineWidth);
};


export { Minimap };
