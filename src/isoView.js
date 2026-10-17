/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { CELL_H, CELL_W, GROUND_PER_ROW, OBJECTS } from './isoArt.js';
import { IsoTiles } from './isoTiles.js';
import { BIT_MASK } from "./tileFlags.ts";
import { LIGHTNINGBOLT } from "./tileValues.ts";
import { SPRITE_AIRPLANE, SPRITE_HELICOPTER, SPRITE_SHIP, SPRITE_TRAIN } from "./spriteConstants.ts";

// The isometric view of the map, in the style of the game's pixel art (see tools/icon/map_atlas.py).
//
// The map is seen from the south-east, from above: a point (x, y) of the map, in world pixels (16 to a tile), at height
// z, is at (x - y, (x + y) / 2 - z) on the screen, in "iso pixels". Each tile is a diamond 32 pixels wide and 16
// high, its top corner at (16 (X - Y), 8 (X + Y)).
//
// The ground of every tile is drawn first. Then what stands on the tiles is drawn from the back of the map to the
// front, a diagonal of tiles (X + Y) at a time, so that what is nearer hides what is farther. A building covering
// several tiles is cut into vertical strips half a tile wide, each drawn with the front tile of the building in its
// column: so a tree or a car beside the building is drawn after the strips behind it, and before those in front.
//
// By night, the lights of the windows are drawn on a canvas of their own, where everything drawn in front of them
// rubs them out; it is laid over the map once the night has darkened it.

var TILE = 16;

// How far a picture rises above its tile, at most, in iso pixels (to find what may show on the screen)
var TALLEST = 150;

var BACKGROUND_COLOUR = '#16232a';

// How long each frame of the water lasts, in milliseconds
var WATER_FRAME_MS = 260;

// The height of the flying vehicles, in iso pixels
var PLANE_HEIGHT = 56;
var COPTER_HEIGHT = 30;

var TRAIN_PICTURES = [null, 'train_ns', 'train_ew', 'train_nwse', 'train_nesw'];


var isoX = function(x, y) {
  return x - y;
};


var isoY = function(x, y, z) {
  return (x + y) / 2 - (z || 0);
};


// The images of the art, once loaded
var images = null;

var getImages = function() {
  if (images)
    return images;

  var ground = document.getElementById('isoGround');
  var objects = document.getElementById('isoObjects');
  var lights = document.getElementById('isoLights');
  var loaded = function(image) {
    return image && image.complete && image.naturalWidth > 0;
  };

  if (!loaded(ground) || !loaded(objects) || !loaded(lights))
    return null;

  images = {ground: ground, objects: objects, lights: lights};
  return images;
};


// What one painting of the map needs: where it is drawn, and how
function Frame(canvas, ctx, viewX, viewY, scale, width, height) {
  this.canvas = canvas;
  this.ctx = ctx;
  this.viewX = viewX;
  this.viewY = viewY;
  this.scale = scale;
  this.width = width;
  this.height = height;
  this.lightsCtx = null;
}


Frame.prototype.deviceX = function(x) {
  return Math.round((x - this.viewX) * this.scale);
};


Frame.prototype.deviceY = function(y) {
  return Math.round((y - this.viewY) * this.scale);
};


// Draws the columns c0 to c1 of a picture of the atlas (see OBJECTS), its top left at (left, top) in iso pixels. By
// night, a building (hides is true) hides the lights behind it; smaller things are let off, as they hide little.
Frame.prototype.region = function(entry, c0, c1, left, top, hides) {
  var dl = this.deviceX(left + c0);
  var dr = this.deviceX(left + c1);
  var dt = this.deviceY(top);
  var db = this.deviceY(top + entry[3]);
  if (dr <= 0 || db <= 0 || dl >= this.width || dt >= this.height || dr <= dl)
    return;

  this.ctx.drawImage(images.objects, entry[0] + c0, entry[1], c1 - c0, entry[3], dl, dt, dr - dl, db - dt);

  var lights = this.lightsCtx;
  if (lights && (hides || entry[7])) {
    // What is in front rubs out the lights behind it
    lights.globalCompositeOperation = 'destination-out';
    lights.drawImage(images.objects, entry[0] + c0, entry[1], c1 - c0, entry[3], dl, dt, dr - dl, db - dt);
    lights.globalCompositeOperation = 'source-over';
    if (entry[7])
      lights.drawImage(images.lights, entry[0] + c0, entry[1], c1 - c0, entry[3], dl, dt, dr - dl, db - dt);
  }
};


// Draws a whole picture, its origin at (x, y) in iso pixels
Frame.prototype.picture = function(name, x, y) {
  var entry = OBJECTS[name];
  if (entry)
    this.region(entry, 0, entry[2], x - entry[4], y - entry[5], false);
};


// Draws strip k of a building of size n whose origin is at (x, y): strips are half a tile wide, numbered from -n (the
// leftmost) to n - 1. The strips at the ends take in what overhangs the building.
Frame.prototype.strip = function(entry, x, y, k, n) {
  var ax = entry[4];
  var c0 = k === -n ? 0 : Math.max(0, ax + TILE * k);
  var c1 = k === n - 1 ? entry[2] : Math.min(entry[2], ax + TILE * (k + 1));
  if (c1 > c0)
    this.region(entry, c0, c1, x - ax, y - entry[5], true);
};


// A rectangle of the screen, in iso pixels
Frame.prototype.rect = function(ctx, x, y, w, h, colour) {
  var dx = this.deviceX(x);
  var dy = this.deviceY(y);
  ctx.fillStyle = colour;
  ctx.fillRect(dx, dy, Math.max(1, this.deviceX(x + w) - dx), Math.max(1, this.deviceY(y + h) - dy));
};


// --- What moves on the ground ---------------------------------------------------------------------------------------

var drawCar = function(frame, car) {
  var x = isoX(car.x, car.y);
  var y = isoY(car.x, car.y);
  frame.picture('car' + car.dir + '_' + car.colour.slice(1).toLowerCase(), x, y);

  if (frame.lightsCtx) {
    // Headlights, and a soft beam ahead
    var dx = [0, 1, 0, -1][car.dir];
    var dy = [-1, 0, 1, 0][car.dir];
    var hx = isoX(dx, dy);
    var hy = isoY(dx, dy);
    frame.rect(frame.lightsCtx, x + hx * 9 - 2, y + hy * 9 - 2, 4, 3, 'rgba(255, 236, 170, 0.25)');
    frame.rect(frame.lightsCtx, x + hx * 4, y + hy * 4 - 1, 1, 1, '#fff3c0');
  }
};


var drawPedestrian = function(frame, p) {
  var ctx = frame.ctx;
  var x = Math.round(isoX(p.x, p.y));
  var y = Math.round(isoY(p.x, p.y));
  var stride = Math.floor(p.step) % 2 === 0;

  frame.rect(ctx, x, y, 2, 1, 'rgba(26,20,36,0.4)');
  frame.rect(ctx, x, y - 5, 1, 1, p.skin);
  frame.rect(ctx, x, y - 4, 1, 3, p.clothes);
  frame.rect(ctx, stride ? x : x - 1, y - 1, 1, 1, '#2a2430');
  frame.rect(ctx, stride ? x + 1 : x, y - 1, 1, 1, '#2a2430');
};


var drawBoat = function(frame, boat) {
  var x = isoX(boat.x, boat.y);
  var y = isoY(boat.x, boat.y);
  var right = isoX(boat.vx, boat.vy) >= 0;
  frame.rect(frame.ctx, x + (right ? -9 : 6), y, 3, 1, 'rgba(220, 238, 255, 0.6)');
  frame.picture(right ? 'sailboat_r' : 'sailboat_l', x, y);
  if (frame.lightsCtx)
    frame.rect(frame.lightsCtx, x, y - 4, 1, 1, '#ffe08a');
};


var spriteCentre = function(sprite) {
  var x = sprite.x + sprite.xOffset + sprite.width / 2;
  var y = sprite.y + sprite.yOffset + sprite.width / 2;
  return {x: x, y: y};
};


var drawVehicle = function(frame, sprite) {
  var centre = spriteCentre(sprite);
  var x = isoX(centre.x, centre.y);
  var y = isoY(centre.x, centre.y);

  if (sprite.type === SPRITE_TRAIN) {
    if (TRAIN_PICTURES[sprite.frame])
      frame.picture(TRAIN_PICTURES[sprite.frame], x, y);
  } else if (sprite.type === SPRITE_SHIP && sprite.frame >= 1 && sprite.frame <= 8) {
    frame.picture('ship' + sprite.frame, x, y);
  }
};


// Planes and helicopters fly over everything, over their shadows; the monster, the tornado and the explosions are
// drawn from the sprites of the top-down view
var drawAirborne = function(frame, sprite, spriteSheet) {
  var centre = spriteCentre(sprite);
  var x = isoX(centre.x, centre.y);
  var y = isoY(centre.x, centre.y);
  var ctx = frame.ctx;

  if (sprite.type === SPRITE_AIRPLANE || sprite.type === SPRITE_HELICOPTER) {
    if (sprite.frame < 1)
      return;
    var plane = sprite.type === SPRITE_AIRPLANE;
    var heading = plane && sprite.frame > 8 ? 3 : sprite.frame;
    var name = (plane ? 'plane' : 'copter') + heading;
    var height = plane ? (sprite.frame > 8 ? (12 - sprite.frame) * 8 : PLANE_HEIGHT) : COPTER_HEIGHT;

    ctx.globalAlpha = 0.3;
    frame.picture(name + '_shadow', x, y);
    ctx.globalAlpha = 1;
    frame.picture(name, x, y - height);
    return;
  }

  if (sprite.frame < 1)
    return;

  var size = sprite.width;
  var dx = frame.deviceX(x - size / 2);
  var dy = frame.deviceY(y - size * 0.8);
  var dw = frame.deviceX(x + size / 2) - dx;
  ctx.drawImage(spriteSheet, (sprite.frame - 1) * 48, (sprite.type - 1) * 48, size, size, dx, dy, dw, dw);
};


// --- Painting -------------------------------------------------------------------------------------------------------

// The ground is drawn in chunks of CHUNK x CHUNK tiles, each kept on a canvas of its own, where only the tiles that
// change are drawn again (and the water, as it moves)
var CHUNK = 8;
var CHUNK_W = 2 * TILE * CHUNK + 2;
var CHUNK_H = TILE * CHUNK + 2;

function GroundChunk() {
  this.canvas = document.createElement('canvas');
  this.canvas.width = CHUNK_W;
  this.canvas.height = CHUNK_H;
  this.ctx = this.canvas.getContext('2d');
  this.ctx.imageSmoothingEnabled = false;
  this.cells = new Int16Array(CHUNK * CHUNK).fill(-1);
}


// Draws again the tiles of the chunk whose ground has changed. The chunk's top tile is (x0, y0).
GroundChunk.prototype.update = function(map, x0, y0, waterFrame) {
  var cells = this.cells;
  for (var j = 0; j < CHUNK; j++) {
    for (var i = 0; i < CHUNK; i++) {
      var x = x0 + i;
      var y = y0 + j;
      if (x >= map.width || y >= map.height)
        continue;

      var cell = IsoTiles.groundCell(map, x, y, map.getTileValue(x, y), waterFrame);
      var k = j * CHUNK + i;
      if (cells[k] === cell)
        continue;

      cells[k] = cell;
      this.ctx.drawImage(images.ground, (cell % GROUND_PER_ROW) * CELL_W, Math.floor(cell / GROUND_PER_ROW) * CELL_H,
                         CELL_W, CELL_H, CHUNK_W / 2 + TILE * (i - j) - TILE - 1, 8 * (i + j), CELL_W, CELL_H);
    }
  }
};


function IsoState() {
  this.raw = [];
  this.animated = [];
  this.movers = new Map();
  this.lights = null;
  this.bolts = [];
  this.chunks = new Map();
}


// Draws the ground seen, chunk by chunk
IsoState.prototype.paintGround = function(frame, map, left, top, right, bottom, waterFrame) {
  var columns = Math.ceil(map.width / CHUNK);
  var rows = Math.ceil(map.height / CHUNK);
  var size = TILE * CHUNK;

  // The chunks are a map of diamonds too: chunk (a, b) has its top corner at (size (a - b), size (a + b) / 2)
  var sMin = Math.max(0, Math.floor(top / (size / 2)) - 2);
  var sMax = Math.min(columns + rows - 2, Math.ceil(bottom / (size / 2)));
  var ctx = frame.ctx;

  for (var s = sMin; s <= sMax; s++) {
    for (var a = Math.max(0, s - rows + 1); a <= Math.min(columns - 1, s); a++) {
      var b = s - a;
      var x = size * (a - b);
      if (x + size < left || x - size > right)
        continue;

      var key = b * columns + a;
      var chunk = this.chunks.get(key);
      if (!chunk) {
        chunk = new GroundChunk();
        this.chunks.set(key, chunk);
      }
      chunk.update(map, a * CHUNK, b * CHUNK, waterFrame);

      var gx = x - CHUNK_W / 2;
      var gy = size * (a + b) / 2 - 1;
      var dx = frame.deviceX(gx);
      var dy = frame.deviceY(gy);
      ctx.drawImage(chunk.canvas, 0, 0, CHUNK_W, CHUNK_H, dx, dy, frame.deviceX(gx + CHUNK_W) - dx,
                    frame.deviceY(gy + CHUNK_H) - dy);
    }
  }
};


IsoState.prototype.lightsCanvas = function(width, height) {
  if (this.lights === null)
    this.lights = document.createElement('canvas');
  if (this.lights.width !== width || this.lights.height !== height) {
    this.lights.width = width;
    this.lights.height = height;
  }
  return this.lights;
};


var addMover = function(movers, map, x, y, kind, thing) {
  var tx = Math.floor(x / TILE);
  var ty = Math.floor(y / TILE);
  if (!map.testBounds(tx, ty))
    return;

  var key = ty * map.width + tx;
  var list = movers.get(key);
  if (!list) {
    list = [];
    movers.set(key, list);
  }
  list.push(kind, thing);
};


// Paints the map and what moves on it. options: sprites (the game's sprites), life (see AmbientLife), night (the sky,
// when lights are on), isPaused, animate (false for a still picture)
var paintMap = function(frame, options) {
  var canvas = frame.canvas;
  var map = canvas._map;
  var state = canvas._isoState || (canvas._isoState = new IsoState());
  var ctx = frame.ctx;
  var now = performance.now();
  var mapWidth = map.width;
  var mapHeight = map.height;

  ctx.fillStyle = BACKGROUND_COLOUR;
  ctx.fillRect(0, 0, frame.width, frame.height);

  // The area seen, in iso pixels
  var left = frame.viewX;
  var top = frame.viewY;
  var right = left + frame.width / frame.scale;
  var bottom = top + frame.height / frame.scale;

  // The diagonals (s = X + Y) and columns (d = X - Y) of the tiles that may show
  var sMin = Math.max(0, Math.floor((top - 24) / 8));
  var sMax = Math.min(mapWidth + mapHeight - 2, Math.ceil((bottom + TALLEST) / 8));
  var dMin = Math.floor((left - 56) / TILE);
  var dMax = Math.ceil((right + 56) / TILE);
  if (sMax < sMin)
    return;

  var x0 = Math.max(0, Math.floor((sMin + dMin) / 2));
  var x1 = Math.min(mapWidth - 1, Math.ceil((sMax + dMax) / 2));
  var y0 = Math.max(0, Math.floor((sMin - dMax) / 2));
  var y1 = Math.min(mapHeight - 1, Math.ceil((sMax - dMin) / 2));
  if (x1 < x0 || y1 < y0)
    return;

  var bw = x1 - x0 + 1;
  var bh = y1 - y0 + 1;
  var raw = map.getTileValuesForPainting(x0, y0, bw, bh, state.raw);
  state.raw = raw;
  var animated = state.animated;
  for (var i = 0, l = bw * bh; i < l; i++)
    animated[i] = raw[i];
  if (options.animate !== false)
    canvas.animationManager.getTiles(animated, x0, y0, bw, bh, options.isPaused);
  else
    for (i = 0; i < bw * bh; i++)
      animated[i] = animated[i] & BIT_MASK;

  var s, x, y, index, tile;
  var first = function(s) {
    return Math.max(x0, s - y1, Math.ceil((s + dMin) / 2));
  };
  var last = function(s) {
    return Math.min(x1, s - y0, Math.floor((s + dMax) / 2));
  };

  // The ground
  var waterFrame = options.animate === false ? 0 : Math.floor(now / WATER_FRAME_MS);
  state.paintGround(frame, map, left, top, right, bottom, waterFrame);

  // By night, the lights have a canvas of their own
  if (options.night) {
    var lightsCanvas = state.lightsCanvas(frame.width, frame.height);
    frame.lightsCtx = lightsCanvas.getContext('2d');
    frame.lightsCtx.imageSmoothingEnabled = false;
    frame.lightsCtx.clearRect(0, 0, frame.width, frame.height);
  }

  // What moves on the ground goes with the tile it is on
  var movers = state.movers;
  movers.clear();
  var life = options.life;
  var k;
  if (life) {
    for (k = 0; k < life.cars.length; k++)
      addMover(movers, map, life.cars[k].x, life.cars[k].y, 0, life.cars[k]);
    for (k = 0; k < life.pedestrians.length; k++)
      addMover(movers, map, life.pedestrians[k].x, life.pedestrians[k].y, 1, life.pedestrians[k]);
    for (k = 0; k < life.boats.length; k++)
      addMover(movers, map, life.boats[k].x, life.boats[k].y, 2, life.boats[k]);
  }
  var sprites = options.sprites || [];
  var airborne = [];
  for (k = 0; k < sprites.length; k++) {
    if (sprites[k].type === SPRITE_TRAIN || sprites[k].type === SPRITE_SHIP) {
      var centre = spriteCentre(sprites[k]);
      addMover(movers, map, centre.x, centre.y, 3, sprites[k]);
    } else {
      airborne.push(sprites[k]);
    }
  }

  // What stands on the tiles, from the back to the front
  var bolts = state.bolts;
  bolts.length = 0;
  var lamps = frame.lightsCtx !== null;
  for (s = sMin; s <= sMax; s++) {
    for (x = first(s), y = s - x; x <= last(s); x++, y--) {
      index = (y - y0) * bw + (x - x0);
      tile = raw[index] & BIT_MASK;
      var shown = animated[index];
      var ox = TILE * (x - y);
      var oy = 8 * (x + y);

      var name = IsoTiles.objectName(x, y, tile, shown, now);
      if (name !== null)
        frame.picture(name, ox, oy);

      var building = IsoTiles.buildingOf(tile);
      if (building !== null) {
        var n = building.size;
        var offset = IsoTiles.drawnAs(tile) - building.first;
        var bi = offset % n;
        var bj = Math.floor(offset / n);
        if (bi === n - 1 || bj === n - 1) {
          var bx = ox - TILE * (bi - bj);
          var by = oy - 8 * (bi + bj);
          if (bi === n - 1)
            frame.strip(building.picture, bx, by, n - 1 - bj, n);
          if (bj === n - 1)
            frame.strip(building.picture, bx, by, bi - n, n);
        }
      }

      if (shown === LIGHTNINGBOLT)
        bolts.push(ox, oy);

      // Street lamps light the roads by night
      if (lamps && ((x + y) & 1) === 0 && IsoTiles.isLitRoad(map, x, y, tile)) {
        frame.rect(frame.lightsCtx, ox - 5, oy + 6, 10, 5, 'rgba(255, 214, 140, 0.16)');
        frame.rect(frame.lightsCtx, ox - 1, oy + 8, 2, 1, 'rgba(255, 236, 190, 0.8)');
      }

      var list = movers.size ? movers.get(y * mapWidth + x) : undefined;
      if (list) {
        for (k = 0; k < list.length; k += 2) {
          switch (list[k]) {
            case 0:
              drawCar(frame, list[k + 1]);
              break;
            case 1:
              drawPedestrian(frame, list[k + 1]);
              break;
            case 2:
              drawBoat(frame, list[k + 1]);
              break;
            default:
              drawVehicle(frame, list[k + 1]);
          }
        }
      }
    }
  }

  frame.airborne = airborne;
};


// Paints what flies, and the bolts over the zones without power
var paintAbove = function(frame, spriteSheet) {
  var airborne = frame.airborne || [];
  airborne.sort(function(a, b) {
    return (a.x + a.y) - (b.x + b.y);
  });
  for (var i = 0; i < airborne.length; i++)
    drawAirborne(frame, airborne[i], spriteSheet);

  var bolts = frame.canvas._isoState.bolts;
  for (i = 0; i < bolts.length; i += 2)
    frame.picture('bolt', bolts[i], bolts[i + 1] - 22);
};


// Lays the lights over the map, darkened by the night
var paintLights = function(frame, strength) {
  var state = frame.canvas._isoState;
  if (!frame.lightsCtx || !state.lights)
    return;

  frame.ctx.globalAlpha = strength;
  frame.ctx.drawImage(state.lights, 0, 0);
  frame.ctx.globalAlpha = 1;
  frame.lightsCtx = null;
};


// The transform that draws a map of one pixel per unit of the map (unit world pixels) onto its tiles
var groundTransform = function(frame, unit) {
  var s = frame.scale * unit;
  return [s, s / 2, -s, s / 2, -frame.viewX * frame.scale, -frame.viewY * frame.scale];
};


var paintDataOverlay = function(frame, dataOverlay, map) {
  var ctx = frame.ctx;
  var t = groundTransform(frame, TILE);
  ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(dataOverlay, 0, 0, dataOverlay.width, dataOverlay.height, 0, 0, map.width, map.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
};


var paintCloudShadows = function(frame, life, alpha) {
  var ctx = frame.ctx;
  var t = groundTransform(frame, 1);
  ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
  ctx.globalAlpha = alpha;
  for (var i = 0; i < life.clouds.length; i++) {
    var cloud = life.clouds[i];
    ctx.drawImage(cloud.shape, cloud.x, cloud.y, cloud.shape.width * 4, cloud.shape.height * 4);
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
};


var paintBirds = function(frame, life) {
  var ctx = frame.ctx;
  for (var i = 0; i < life.birds.length; i++) {
    var bird = life.birds[i];
    var x = Math.round(isoX(bird.x, bird.y));
    var y = Math.round(isoY(bird.x, bird.y));

    frame.rect(ctx, x, y + 4, 5, 1, 'rgba(0, 0, 0, 0.16)');
    y -= 46;
    if (bird.flap) {
      frame.rect(ctx, x, y, 1, 1, '#24202c');
      frame.rect(ctx, x + 1, y + 1, 1, 1, '#24202c');
      frame.rect(ctx, x + 2, y + 2, 1, 1, '#24202c');
      frame.rect(ctx, x + 3, y + 1, 1, 1, '#24202c');
      frame.rect(ctx, x + 4, y, 1, 1, '#24202c');
    } else {
      frame.rect(ctx, x, y + 1, 5, 1, '#24202c');
      frame.rect(ctx, x + 2, y + 2, 1, 1, '#24202c');
    }
  }
};


// Where a particle is on the screen: particles rise from a point of the map (see AmbientLife), their movement drawn
// as it is seen
var particlePosition = function(p) {
  var ax = p.ax === undefined ? p.x : p.ax;
  var ay = p.ay === undefined ? p.y : p.ay;
  return {x: isoX(ax, ay) + p.x - ax, y: isoY(ax, ay, p.az || 0) + p.y - ay};
};


// The outline of a rectangle of tiles, in iso pixels: its corners, clockwise from the top
var tileQuad = function(x, y, w, h) {
  return [[TILE * (x - y), 8 * (x + y)], [TILE * (x + w - y), 8 * (x + w + y)],
          [TILE * (x + w - y - h), 8 * (x + w + y + h)], [TILE * (x - y - h), 8 * (x + y + h)]];
};


var quadPath = function(frame, quad) {
  var ctx = frame.ctx;
  ctx.beginPath();
  for (var i = 0; i < 4; i++) {
    if (i === 0)
      ctx.moveTo(frame.deviceX(quad[i][0]), frame.deviceY(quad[i][1]));
    else
      ctx.lineTo(frame.deviceX(quad[i][0]), frame.deviceY(quad[i][1]));
  }
  ctx.closePath();
};


// The tool's preview: rectangles of tiles become diamonds
var paintOverlayRects = function(frame, rects, dpr) {
  var ctx = frame.ctx;
  for (var i = 0, l = rects.length; i < l; i++) {
    var r = rects[i];
    var quad = tileQuad(r.x, r.y, r.width, r.height);
    var lineWidth = Math.max(1, Math.round(2 * dpr));
    ctx.lineWidth = lineWidth;

    quadPath(frame, quad);
    if (r.outline) {
      ctx.setLineDash([4 * lineWidth, 2 * lineWidth]);
      ctx.lineWidth = lineWidth * 2;
      ctx.strokeStyle = '#070a1f';
      ctx.stroke();
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = r.colour || '#f8f8ff';
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }

    ctx.globalAlpha = 0.35;
    ctx.fillStyle = r.valid === false ? '#ff3b30' : (r.colour || '#ffd60a');
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = r.valid === false ? '#ff4a36' : '#f8f8ff';
    ctx.stroke();
  }
};


// The world pixel of the map at a point of the screen, in iso pixels, on the ground
var toMap = function(x, y) {
  return {x: y + x / 2, y: y - x / 2};
};


// The view chosen in the settings, remembered by the browser: the isometric view, unless the view from above was
// chosen
var STORAGE_KEY = 'kawacityView';

var isPreferred = function() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'top';
  } catch (e) {
    return true;
  }
};


var setPreferred = function(isometric) {
  try {
    window.localStorage.setItem(STORAGE_KEY, isometric ? 'isometric' : 'top');
  } catch (e) {
    // Not remembered
  }
};


var IsoView = {
  BACKGROUND_COLOUR: BACKGROUND_COLOUR,
  TALLEST: TALLEST,
  Frame: Frame,
  getImages: getImages,
  isoX: isoX,
  isoY: isoY,
  isPreferred: isPreferred,
  paintAbove: paintAbove,
  paintBirds: paintBirds,
  paintCloudShadows: paintCloudShadows,
  paintDataOverlay: paintDataOverlay,
  paintLights: paintLights,
  paintMap: paintMap,
  paintOverlayRects: paintOverlayRects,
  particlePosition: particlePosition,
  setPreferred: setPreferred,
  toMap: toMap
};


export { IsoView };
