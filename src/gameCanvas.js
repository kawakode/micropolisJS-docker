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
 * KawaCity: rewritten in 2026 to support zooming, smooth (per-pixel) scrolling, high density displays and
 * tool previews. The whole view is repainted each frame.
 *
 */

import $ from "jquery";

import { AnimationManager } from './animationManager.js';
import { MiscUtils } from './miscUtils.js';
import { Position } from './position.ts';
import { TILE_INVALID } from "./tileValues.ts";

// World coordinates are expressed in "world pixels": each tile is TILE_SIZE world pixels square
var TILE_SIZE = 16;

// Sprites are laid out in a sheet of 48px cells
var SPRITE_CELL = 48;

var ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3, 4];

var BACKGROUND_COLOUR = '#16232a';


function GameCanvas(id, parentNode) {
  if (!(this instanceof GameCanvas))
    return new GameCanvas(id, parentNode);

  if (arguments.length < 1)
    throw new Error('Attempt to construct a GameCanvas with no parameters');

  // Argument shuffling
  if (parentNode === undefined) {
    // No ID supplied
    parentNode = id;
    id = GameCanvas.DEFAULT_ID;
  }

  if (typeof(parentNode) === 'string') {
    var orig = parentNode;
    parentNode = $(MiscUtils.normaliseDOMid(parentNode));
    parentNode = parentNode.length === 0 ? null : parentNode[0];
    if (parentNode === null)
      throw new Error('Node ' + orig + ' not found');
  }

  this._canvas = document.createElement('canvas');
  this._canvas.id = id;
  this._canvas.style.margin = '0';
  this._canvas.style.padding = '0';
  this._canvas.style.display = 'block';
  this._canvas.style.width = '100%';
  this._canvas.style.height = '100%';

  this._pendingTileSet = null;

  // Remove any existing element with the same id
  var current = document.getElementById(id);
  if (current !== null) {
    if  (current.parentNode === parentNode)
      parentNode.replaceChild(this._canvas, current);
    else
      throw new Error('ID ' + id + ' already exists in document!');
  } else
    parentNode.appendChild(this._canvas);

  this.ready = false;
}


GameCanvas.prototype.init = function(map, tileSet, spriteSheet, animationManager) {
  if (arguments.length < 3)
    throw new Error('GameCanvas constructor called with too few arguments ' + [].toString.apply(arguments));

  if (!tileSet.isValid)
    throw new Error('TileSet not ready!');

  this._spriteSheet = spriteSheet;
  this._tileSet = tileSet;
  this._map = map;
  this.animationManager = animationManager || new AnimationManager(map);

  // Whether to allow off-map scrolling
  this._allowScrolling = true;

  // The world pixel coordinate at the top left of the canvas, and the number of CSS pixels per world pixel
  this._viewX = 0;
  this._viewY = 0;
  this._zoom = 1;

  // Reused between paints to avoid allocations
  this._tileValues = [];

  this.cssWidth = 0;
  this.cssHeight = 0;
  this._dpr = 1;
  this._calculateDimensions();

  // Order is important here. ready must be set before the call to centreOn below
  this.ready = true;
  this.centreOn(Math.floor(this._map.width / 2), Math.floor(this._map.height / 2));

  this.paint(null, null);
};


// Synchronise the canvas' backing store with its on-screen size. Returns true if anything changed.
GameCanvas.prototype._calculateDimensions = function() {
  var parent = this._canvas.parentNode;
  var cssWidth = parent.clientWidth;
  var cssHeight = parent.clientHeight;
  var dpr = window.devicePixelRatio || 1;

  if (cssWidth === this.cssWidth && cssHeight === this.cssHeight && dpr === this._dpr)
    return false;

  this.cssWidth = cssWidth;
  this.cssHeight = cssHeight;
  this._dpr = dpr;
  this._canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  this._canvas.height = Math.max(1, Math.round(cssHeight * dpr));

  // Retained for compatibility: the size of the canvas in CSS pixels
  this.canvasWidth = cssWidth;
  this.canvasHeight = cssHeight;

  if (this.ready)
    this._clampView();

  return true;
};


// NOTE: Canvas must be visible when this is called
GameCanvas.prototype.disallowOffMap = function() {
  this._allowScrolling = false;
  this._calculateDimensions();
  this._clampView();
};


GameCanvas.prototype._visibleWorldWidth = function() {
  return this.cssWidth / this._zoom;
};


GameCanvas.prototype._visibleWorldHeight = function() {
  return this.cssHeight / this._zoom;
};


var clampAxis = function(value, visible, mapSize, allowOffMap) {
  if (allowOffMap) {
    // The map should always fill at least half of the view
    var min = -visible / 2;
    var max = mapSize - visible / 2;
    return MiscUtils.clamp(value, min, max);
  }

  if (visible >= mapSize)
    return (mapSize - visible) / 2;

  return MiscUtils.clamp(value, 0, mapSize - visible);
};


GameCanvas.prototype._clampView = function() {
  this._viewX = clampAxis(this._viewX, this._visibleWorldWidth(), this._map.width * TILE_SIZE, this._allowScrolling);
  this._viewY = clampAxis(this._viewY, this._visibleWorldHeight(), this._map.height * TILE_SIZE, this._allowScrolling);
};


GameCanvas.prototype._checkReady = function() {
  if (!this.ready)
    throw new Error('Not ready!');
};


// Scroll the view by the given number of CSS pixels
GameCanvas.prototype.panBy = function(dx, dy) {
  this._checkReady();

  this._viewX += dx / this._zoom;
  this._viewY += dy / this._zoom;
  this._clampView();
};


GameCanvas.prototype.moveNorth = function() {
  this.panBy(0, -TILE_SIZE * this._zoom);
};


GameCanvas.prototype.moveEast = function() {
  this.panBy(TILE_SIZE * this._zoom, 0);
};


GameCanvas.prototype.moveSouth = function() {
  this.panBy(0, TILE_SIZE * this._zoom);
};


GameCanvas.prototype.moveWest = function() {
  this.panBy(-TILE_SIZE * this._zoom, 0);
};


// Positions the given tile at the top-left of the view
GameCanvas.prototype.moveTo = function(x, y) {
  if (arguments.length < 1)
    throw new Error('GameCanvas moveTo called with no arguments');

  this._checkReady();

  this._viewX = x * TILE_SIZE;
  this._viewY = y * TILE_SIZE;
  this._clampView();
};


GameCanvas.prototype.centreOn = function(x, y) {
  if (arguments.length < 1)
    throw new Error('GameCanvas centreOn called with no arguments');

  this._checkReady();

  if (y === undefined) {
    y = x.y;
    x = x.x;
  }

  this._viewX = (Math.floor(x) + 0.5) * TILE_SIZE - this._visibleWorldWidth() / 2;
  this._viewY = (Math.floor(y) + 0.5) * TILE_SIZE - this._visibleWorldHeight() / 2;
  this._clampView();
};


GameCanvas.prototype.getZoom = function() {
  return this._zoom;
};


// Change the zoom level, keeping the world point under the given canvas coordinate (in CSS pixels) fixed. If no
// anchor is given, the centre of the view is kept fixed.
GameCanvas.prototype.setZoom = function(zoom, anchorX, anchorY) {
  this._checkReady();

  zoom = MiscUtils.clamp(zoom, ZOOM_LEVELS[0], ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);

  if (anchorX === undefined) {
    anchorX = this.cssWidth / 2;
    anchorY = this.cssHeight / 2;
  }

  var worldX = this._viewX + anchorX / this._zoom;
  var worldY = this._viewY + anchorY / this._zoom;

  this._zoom = zoom;
  this._viewX = worldX - anchorX / zoom;
  this._viewY = worldY - anchorY / zoom;
  this._clampView();
};


GameCanvas.prototype.zoomIn = function(anchorX, anchorY) {
  for (var i = 0; i < ZOOM_LEVELS.length; i++) {
    if (ZOOM_LEVELS[i] > this._zoom + 1e-6) {
      this.setZoom(ZOOM_LEVELS[i], anchorX, anchorY);
      return;
    }
  }
};


GameCanvas.prototype.zoomOut = function(anchorX, anchorY) {
  for (var i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
    if (ZOOM_LEVELS[i] < this._zoom - 1e-6) {
      this.setZoom(ZOOM_LEVELS[i], anchorX, anchorY);
      return;
    }
  }
};


GameCanvas.prototype.getTileOrigin = function() {
  this._checkReady();

  return {x: Math.floor(this._viewX / TILE_SIZE), y: Math.floor(this._viewY / TILE_SIZE)};
};


GameCanvas.prototype.getMaxTile = function() {
  this._checkReady();

  return {x: Math.floor((this._viewX + this._visibleWorldWidth() - 1) / TILE_SIZE),
          y: Math.floor((this._viewY + this._visibleWorldHeight() - 1) / TILE_SIZE)};
};


// The visible area, in world pixels
GameCanvas.prototype.getVisibleWorldRect = function() {
  this._checkReady();

  return {x: this._viewX, y: this._viewY, width: this._visibleWorldWidth(), height: this._visibleWorldHeight()};
};


// The centre of the view, in tile coordinates
GameCanvas.prototype.getViewCentre = function() {
  return {x: (this._viewX + this._visibleWorldWidth() / 2) / TILE_SIZE,
          y: (this._viewY + this._visibleWorldHeight() / 2) / TILE_SIZE};
};


// Converts a coordinate relative to the canvas (in CSS pixels) to tile coordinates. The tile may be off the map.
GameCanvas.prototype.canvasCoordinateToTileCoordinate = function(x, y) {
  if (arguments.length < 2)
    throw new Error('GameCanvas canvasCoordinateToTileCoordinate called with too few arguments ' + [].toString.apply(arguments));

  this._checkReady();

  if (x < 0 || y < 0 || x >= this.cssWidth || y >= this.cssHeight)
    return null;

  return {x: Math.floor((this._viewX + x / this._zoom) / TILE_SIZE),
          y: Math.floor((this._viewY + y / this._zoom) / TILE_SIZE)};
};


GameCanvas.prototype.canvasCoordinateToPosition = function(x, y) {
  if (arguments.length < 2)
    throw new Error('GameCanvas canvasCoordinateToPosition called with too few arguments ' + [].toString.apply(arguments));

  var tile = this.canvasCoordinateToTileCoordinate(x, y);
  if (tile === null || !this._map.testBounds(tile.x, tile.y))
    return null;

  return new Position(tile.x, tile.y);
};


GameCanvas.prototype.positionToCanvasCoordinate = function(p) {
  if (arguments.length < 1)
    throw new Error('GameCanvas positionToCanvasCoordinate called with too few arguments ' + [].toString.apply(arguments));

  return this.tileToCanvasCoordinate(p);
};


// Returns the canvas coordinate (in CSS pixels) of the top-left of the given tile, or null if it is not visible
GameCanvas.prototype.tileToCanvasCoordinate = function(x, y) {
  if (arguments.length < 1)
    throw new Error('GameCanvas tileToCanvasCoordinate  called with too few arguments ' + [].toString.apply(arguments));

  this._checkReady();

  if (y === undefined) {
    y = x.y;
    x = x.x;
  }

  var canvasX = (x * TILE_SIZE - this._viewX) * this._zoom;
  var canvasY = (y * TILE_SIZE - this._viewY) * this._zoom;
  var size = TILE_SIZE * this._zoom;

  if (canvasX + size <= 0 || canvasY + size <= 0 || canvasX >= this.cssWidth || canvasY >= this.cssHeight)
    return null;

  return {x: canvasX, y: canvasY};
};


GameCanvas.prototype.changeTileSet = function(tileSet) {
  this._checkReady();

  if (!tileSet.isValid)
    throw new Error('new tileset not loaded');

  this._pendingTileSet = tileSet;
};


GameCanvas.prototype._drawTile = function(ctx, tileVal, dx, dy, dw, dh) {
  if (tileVal === TILE_INVALID || tileVal < 0) {
    ctx.fillStyle = BACKGROUND_COLOUR;
    ctx.fillRect(dx, dy, dw, dh);
    return;
  }

  var tileSet = this._tileSet;
  var perRow = tileSet.tilesPerRow;
  var sx = (tileVal % perRow) * TILE_SIZE;
  var sy = Math.floor(tileVal / perRow) * TILE_SIZE;
  ctx.drawImage(tileSet.image, sx, sy, TILE_SIZE, TILE_SIZE, dx, dy, dw, dh);
};


GameCanvas.prototype._screenshot = function(onlyVisible) {
  if (onlyVisible)
    return this._canvas.toDataURL();

  var tempCanvas = document.createElement('canvas');
  tempCanvas.width = this._map.width * TILE_SIZE;
  tempCanvas.height = this._map.height * TILE_SIZE;
  var ctx = tempCanvas.getContext('2d');

  for (var x = 0; x < this._map.width; x++) {
    for (var y = 0; y < this._map.height; y++)
      this._drawTile(ctx, this._map.getTileValue(x, y), x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  }

  return tempCanvas.toDataURL();
};


GameCanvas.prototype.screenshotMap = function() {
  return this._screenshot(false);
};


GameCanvas.prototype.screenshotVisible = function() {
  return this._screenshot(true);
};


GameCanvas.prototype.shoogle = function() {
  // TODO Earthquakes
};


// Converts a world pixel coordinate to a device pixel coordinate on the canvas. Rounding ensures adjacent tiles
// share edges exactly, so no seams appear at fractional scales.
GameCanvas.prototype._toDeviceX = function(worldX) {
  return Math.round((worldX - this._viewX) * this._scale);
};


GameCanvas.prototype._toDeviceY = function(worldY) {
  return Math.round((worldY - this._viewY) * this._scale);
};


GameCanvas.prototype._paintTiles = function(ctx, isPaused) {
  var firstX = Math.floor(this._viewX / TILE_SIZE);
  var firstY = Math.floor(this._viewY / TILE_SIZE);
  var lastX = Math.floor((this._viewX + this._visibleWorldWidth()) / TILE_SIZE);
  var lastY = Math.floor((this._viewY + this._visibleWorldHeight()) / TILE_SIZE);
  var width = lastX - firstX + 1;
  var height = lastY - firstY + 1;

  var tileValues = this._map.getTileValuesForPainting(firstX, firstY, width, height, this._tileValues);
  this._tileValues = tileValues;

  // Adjust for animations
  this.animationManager.getTiles(tileValues, firstX, firstY, width, height, isPaused);

  for (var y = 0; y < height; y++) {
    var mapY = firstY + y;
    var dy = this._toDeviceY(mapY * TILE_SIZE);
    var dh = this._toDeviceY((mapY + 1) * TILE_SIZE) - dy;

    for (var x = 0; x < width; x++) {
      var mapX = firstX + x;
      var dx = this._toDeviceX(mapX * TILE_SIZE);
      var dw = this._toDeviceX((mapX + 1) * TILE_SIZE) - dx;

      this._drawTile(ctx, tileValues[y * width + x], dx, dy, dw, dh);
    }
  }
};


GameCanvas.prototype._paintSprites = function(ctx, spriteList) {
  for (var i = 0, l = spriteList.length; i < l; i++) {
    var sprite = spriteList[i];
    var worldX = sprite.x + sprite.xOffset;
    var worldY = sprite.y + sprite.yOffset;
    var dx = this._toDeviceX(worldX);
    var dy = this._toDeviceY(worldY);
    var size = this._toDeviceX(worldX + sprite.width) - dx;

    try {
      ctx.drawImage(this._spriteSheet,
                    (sprite.frame - 1) * SPRITE_CELL,
                    (sprite.type - 1) * SPRITE_CELL,
                    sprite.width,
                    sprite.width,
                    dx, dy, size, size);
    } catch (e) {
      throw new Error('Failed to draw sprite ' + sprite.type + ' frame ' + sprite.frame + ' at ' + sprite.x +  ', ' + sprite.y);
    }
  }
};


var roundedRect = function(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};


// Paints the tool preview. The overlay is an object with:
//   - rects: an array of {x, y, width, height, colour, valid} in tile units, outlining where the tool will act
//   - label: optionally, {x, y, text, valid} with tile coordinates: a caption painted next to that tile
GameCanvas.prototype._paintOverlay = function(ctx, overlay) {
  var dpr = this._dpr;
  var rects = overlay.rects || [];

  for (var i = 0, l = rects.length; i < l; i++) {
    var r = rects[i];
    var x = this._toDeviceX(r.x * TILE_SIZE);
    var y = this._toDeviceY(r.y * TILE_SIZE);
    var w = this._toDeviceX((r.x + r.width) * TILE_SIZE) - x;
    var h = this._toDeviceY((r.y + r.height) * TILE_SIZE) - y;

    ctx.globalAlpha = 0.35;
    ctx.fillStyle = r.valid === false ? '#ff3b30' : (r.colour || '#ffd60a');
    ctx.fillRect(x, y, w, h);

    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1, Math.round(2 * dpr));
    ctx.strokeStyle = r.valid === false ? '#ff3b30' : '#ffffff';
    var inset = ctx.lineWidth / 2;
    ctx.strokeRect(x + inset, y + inset, w - ctx.lineWidth, h - ctx.lineWidth);
  }

  var label = overlay.label;
  if (label && label.text) {
    var fontSize = Math.round(13 * dpr);
    ctx.font = '600 ' + fontSize + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    var textWidth = ctx.measureText(label.text).width;
    var padX = Math.round(6 * dpr);
    var boxH = Math.round(fontSize + 8 * dpr);
    var lx = this._toDeviceX((label.x + 1) * TILE_SIZE) + Math.round(6 * dpr);
    var ly = this._toDeviceY(label.y * TILE_SIZE) - boxH - Math.round(4 * dpr);

    // Keep the label on screen
    lx = MiscUtils.clamp(lx, 0, Math.max(0, this._canvas.width - textWidth - 2 * padX));
    ly = MiscUtils.clamp(ly, 0, Math.max(0, this._canvas.height - boxH));

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = label.valid === false ? '#7f1d1d' : '#0f172a';
    roundedRect(ctx, lx, ly, textWidth + 2 * padX, boxH, Math.round(4 * dpr));
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.text, lx + padX, ly + boxH / 2);
  }
};


// Paints a data overlay: a canvas with one pixel per map tile
GameCanvas.prototype._paintDataOverlay = function(ctx, dataOverlay) {
  var left = this._toDeviceX(0);
  var top = this._toDeviceY(0);
  var width = this._toDeviceX(this._map.width * TILE_SIZE) - left;
  var height = this._toDeviceY(this._map.height * TILE_SIZE) - top;

  ctx.drawImage(dataOverlay, 0, 0, dataOverlay.width, dataOverlay.height, left, top, width, height);
};


GameCanvas.prototype.paint = function(overlay, sprites, isPaused, dataOverlay) {
  this._checkReady();

  this._calculateDimensions();

  if (this._pendingTileSet !== null) {
    this._tileSet = this._pendingTileSet;
    this._pendingTileSet = null;
  }

  this._scale = this._zoom * this._dpr;

  var ctx = this._canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;

  this._paintTiles(ctx, isPaused);

  if (dataOverlay)
    this._paintDataOverlay(ctx, dataOverlay);

  if (sprites)
    this._paintSprites(ctx, sprites);

  if (overlay)
    this._paintOverlay(ctx, overlay);
};


GameCanvas.DEFAULT_ID = 'MicropolisCanvas';
GameCanvas.TILE_SIZE = TILE_SIZE;
GameCanvas.ZOOM_LEVELS = ZOOM_LEVELS;


export { GameCanvas };
