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

import * as TileValues from "./tileValues.ts";

// Tool icons are drawn from the game's own tiles. Buildings are drawn in full: the tile at the top-left of a
// building of size n with centre tile c is c - n - 1 (see BuildingTool.putBuilding).
var buildingIcon = function(centre, size) {
  return {base: centre - size - 1, size: size};
};

var iconSpecs = {
  residential: buildingIcon(TileValues.FREEZ, 3),
  commercial: buildingIcon(TileValues.COMCLR, 3),
  industrial: buildingIcon(TileValues.INDCLR, 3),
  police: buildingIcon(TileValues.POLICESTATION, 3),
  fire: buildingIcon(TileValues.FIRESTATION, 3),
  coal: buildingIcon(TileValues.POWERPLANT, 4),
  nuclear: buildingIcon(TileValues.NUCLEAR, 4),
  stadium: buildingIcon(TileValues.STADIUM, 4),
  port: buildingIcon(TileValues.PORT, 4),
  airport: buildingIcon(TileValues.AIRPORT, 6),
  road: {tiles: [TileValues.INTERSECTION]},
  rail: {tiles: [TileValues.LHRAIL]},
  wire: {tiles: [TileValues.LHPOWER]},
  park: {tiles: [TileValues.WOODS2]},
  bulldozer: {tiles: [TileValues.RUBBLE]},
  query: {glyph: '?'}
};

var ICON_SIZE = 32;
var TILE_SIZE = 16;


var drawTile = function(ctx, tileSet, tile, dx, dy, size) {
  var perRow = tileSet.tilesPerRow;
  var sx = (tile % perRow) * TILE_SIZE;
  var sy = Math.floor(tile / perRow) * TILE_SIZE;
  ctx.drawImage(tileSet.image, sx, sy, TILE_SIZE, TILE_SIZE, dx, dy, size, size);
};


var makeIcon = function(spec, tileSet) {
  var dpr = window.devicePixelRatio || 1;
  var pixels = Math.round(ICON_SIZE * dpr);
  var canvas = document.createElement('canvas');
  canvas.width = pixels;
  canvas.height = pixels;
  canvas.className = 'toolIcon';
  canvas.setAttribute('aria-hidden', 'true');

  var ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  if (spec.glyph) {
    ctx.fillStyle = '#2b8fd0';
    ctx.fillRect(0, 0, pixels, pixels);
    ctx.fillStyle = '#1a5a8c';
    ctx.fillRect(0, pixels - Math.round(pixels / 8), pixels, Math.round(pixels / 8));
    ctx.fillRect(pixels - Math.round(pixels / 8), 0, Math.round(pixels / 8), pixels);
    ctx.font = Math.round(pixels * 0.55) + 'px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#070a1f';
    ctx.fillText(spec.glyph, pixels / 2 + Math.round(pixels / 16), pixels / 2 + Math.round(pixels / 10));
    ctx.fillStyle = '#fff6c8';
    ctx.fillText(spec.glyph, pixels / 2, pixels / 2 + Math.round(pixels / 20));
    return canvas;
  }

  if (spec.tiles) {
    drawTile(ctx, tileSet, spec.tiles[0], 0, 0, pixels);
    return canvas;
  }

  var tileSize = pixels / spec.size;
  for (var y = 0; y < spec.size; y++) {
    for (var x = 0; x < spec.size; x++) {
      // Round the edges so tiles abut exactly
      var dx = Math.round(x * tileSize);
      var dy = Math.round(y * tileSize);
      var size = Math.round((x + 1) * tileSize) - dx;
      drawTile(ctx, tileSet, spec.base + y * spec.size + x, dx, dy, size);
    }
  }

  return canvas;
};


// Replaces the text of each tool button with an icon, its name, cost and keyboard shortcut
var decorateToolButtons = function(tileSet) {
  $('.toolButton').each(function() {
    var button = $(this);
    var tool = button.attr('data-tool');
    var spec = iconSpecs[tool];
    var name = button.text().trim();
    var label = button.attr('data-label') || name;
    var cost = button.attr('data-cost');
    var key = button.attr('data-key');

    button.empty();

    if (spec)
      button.append(makeIcon(spec, tileSet));

    button.append($('<span class="toolName"></span>').text(name));

    if (cost)
      button.append($('<span class="toolCost"></span>').text('$' + Number(cost).toLocaleString('en-US')));

    if (key)
      button.append($('<span class="toolKey" aria-hidden="true"></span>').text(key));

    var title = label + (cost ? ' ($' + Number(cost).toLocaleString('en-US') + ')' : '') + (key ? ' [' + key + ']' : '');
    button.attr('title', title);
    button.attr('aria-label', title);
    button.attr('aria-pressed', 'false');
  });
};


var ToolIcons = {
  decorateToolButtons: decorateToolButtons
};


export { ToolIcons };
