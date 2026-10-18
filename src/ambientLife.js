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

import { EMITTERS } from './isoArt.js';
import { IsoTiles } from './isoTiles.js';
import { BIT_MASK, ZONEBIT } from "./tileFlags.ts";
import { CHANNEL, COMBASE, FIRE, GASPLANT, HHTHR, HOUSE, HRAILROAD, INDBASE, LASTFIRE, LASTROAD, NUCLEAR, PORTBASE, POWERPLANT,
         RIVER, ROADBASE, VRAILROAD } from "./tileValues.ts";
import { ZoneUtils } from './zoneUtils.js';

/*
 *
 * Ambient life: purely decorative cars, pedestrians, boats, birds, smoke, clouds and lights that make the city feel
 * alive. None of it has any effect on the simulation, but it follows it: cars drive on the roads, more of them where
 * the simulation measures more traffic and as the population grows; people walk along the streets of inhabited and
 * commercial areas; factories and power plants smoke; dust rises where buildings go up; day turns to night and the
 * windows light up. Vehicles, people and smoke stop while the game is paused. Only the area in view (plus a margin)
 * is populated. Positions are in world pixels (16 per tile).
 *
 * A particle rises from a point of the map (ax, ay), at a height az: its x and y are where it has moved to from
 * there, as seen on the screen (y going up as it rises). In the view from above, that is simply where it is; the
 * isometric view draws it from where it rose from (see IsoView.particlePosition).
 *
 */

var TILE = 16;

// Directions: north, east, south, west
var DX = [0, 1, 0, -1];
var DY = [-1, 0, 1, 0];

// Cars keep to the right. Roads span pixels 2 to 12 of a tile horizontally, and 3 to 13 vertically: these are the
// positions of the middle of each lane within a tile, for each direction of travel.
var LANE_X = [11, 8, 5, 8];
var LANE_Y = [8, 10, 8, 4];

// People walk on the verges just beside the road: their position within the tile for each side of the road
var SIDEWALK_X = [0, 14, 0, 1];
var SIDEWALK_Y = [1, 0, 14, 0];

var CAR_COLOURS = ['#d83c30', '#3c6ad8', '#f2f0e6', '#f8c838', '#3ca850', '#e07830', '#9094a8', '#58c4d4',
                   '#a050c0', '#f2f0e6', '#d83c30', '#3c6ad8'];
var CLOTHES = ['#d83c30', '#3c6ad8', '#f8c838', '#3ca850', '#a050c0', '#f2f0e6', '#e07830', '#30303c'];
var SKIN = ['#f0c8a0', '#d8a078', '#a87050', '#704830'];
var FIREWORK_COLOURS = [[255, 96, 80], [255, 220, 90], [120, 220, 255], [150, 255, 140], [255, 140, 240],
                        [255, 255, 255]];

var MAX_CARS = 160;
var MAX_PEDESTRIANS = 90;
var MAX_BOATS = 4;
var MAX_PARTICLES = 800;
var MARGIN_TILES = 3;
var SURVEY_INTERVAL = 1000;

// A full day lasts this many seconds of play
var DAY_LENGTH = 360;

// Sky colour (multiplied over the map) and how bright the lights are, through the day. Times are fractions of a day.
var SKY = [
  {time: 0.00, tint: [255, 255, 255], lights: 0},
  {time: 0.50, tint: [255, 255, 255], lights: 0},
  {time: 0.57, tint: [255, 196, 150], lights: 0.25},
  {time: 0.64, tint: [104, 112, 182], lights: 1},
  {time: 0.89, tint: [104, 112, 182], lights: 1},
  {time: 0.95, tint: [236, 200, 206], lights: 0.2},
  {time: 1.00, tint: [255, 255, 255], lights: 0}
];


var isRoad = function(value) {
  return (value >= ROADBASE && value <= LASTROAD) || value === HRAILROAD || value === VRAILROAD;
};


// Open water, away from the shore
var isOpenWater = function(value) {
  return value >= RIVER && value <= CHANNEL;
};


// Where people go: houses, flats, shops and offices (but not empty zones)
var isBusy = function(value) {
  return (value >= HOUSE && value < COMBASE) || (value >= COMBASE + 9 && value < INDBASE);
};


var isDevelopedIndustry = function(value) {
  return value >= INDBASE + 9 && value < PORTBASE;
};


var randomBetween = function(min, max) {
  return min + Math.random() * (max - min);
};


var pick = function(list) {
  return list[Math.floor(Math.random() * list.length)];
};


var mix = function(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
};


function AmbientLife(map, simulation) {
  this._map = map;
  this._simulation = simulation;

  this.cars = [];
  this.pedestrians = [];
  this.boats = [];
  this.birds = [];
  this.clouds = [];
  this.particles = [];

  // What is in view, surveyed periodically
  this._lastSurvey = -Infinity;
  this._roadCount = 0;
  this._waterTiles = [];
  this._sidewalks = [];
  this._sidewalkSet = new Set();
  this._emitters = [];

  // The tile values seen at the last survey, to notice buildings going up
  var size = map.width * map.height;
  this._seen = new Int32Array(size).fill(-1);
  this._seenAt = new Int32Array(size).fill(-1);
  this._surveys = 0;

  this._nextFlock = randomBetween(4000, 12000);

  // Clouds drift with the wind, which changes from game to game
  var wind = Math.random() * Math.PI * 2;
  this._wind = {x: Math.cos(wind) * 7, y: Math.sin(wind) * 4};
  this._nextCloud = 0;
  this._lastUpdate = null;

  // Time of day, as a fraction of a day: start in the morning
  this.dayNight = true;
  this._time = 0.2;
  this._fireworks = [];

  // Whether the map is seen in the isometric view, where chimneys are elsewhere
  this.isometric = false;
}


// Follows the view of the map: smoke rises from the chimneys of the buildings as they are drawn
AmbientLife.prototype.setIsometric = function(isometric) {
  if (this.isometric === !!isometric)
    return;

  this.isometric = !!isometric;
  this.particles = [];
  this._lastSurvey = -Infinity;
};


AmbientLife.prototype._tileValue = function(x, y) {
  if (!this._map.testBounds(x, y))
    return -1;

  return this._map.getTileValue(x, y);
};


// Returns the area to populate, in tiles: the view plus a margin
AmbientLife.prototype._tileBounds = function(view) {
  return {
    minX: Math.max(0, Math.floor(view.x / TILE) - MARGIN_TILES),
    minY: Math.max(0, Math.floor(view.y / TILE) - MARGIN_TILES),
    maxX: Math.min(this._map.width - 1, Math.floor((view.x + view.width) / TILE) + MARGIN_TILES),
    maxY: Math.min(this._map.height - 1, Math.floor((view.y + view.height) / TILE) + MARGIN_TILES)
  };
};


AmbientLife.prototype._inBounds = function(tx, ty, bounds) {
  return tx >= bounds.minX && tx <= bounds.maxX && ty >= bounds.minY && ty <= bounds.maxY;
};


// --- Survey of the area in view -----------------------------------------------------------------------------------

AmbientLife.prototype._survey = function(bounds, reportChanges) {
  var map = this._map;
  var width = map.width;
  var roads = 0;
  var water = [];
  var sidewalks = [];
  var emitters = [];
  var survey = ++this._surveys;

  for (var y = bounds.minY; y <= bounds.maxY; y++) {
    for (var x = bounds.minX; x <= bounds.maxX; x++) {
      var raw = map.getTile(x, y).getRawValue();
      var value = raw & BIT_MASK;
      var index = y * width + x;

      // Dust rises where a building has just gone up (or been rebuilt)
      if (reportChanges && this._seenAt[index] === survey - 1 && this._seen[index] !== value) {
        if (raw & ZONEBIT)
          this._dust(x, y, ZoneUtils.getZoneSize(value) || 3, true);
        else if (value >= HOUSE && value <= HHTHR)
          this._dust(x, y, 1, false);
      }

      this._seen[index] = value;
      this._seenAt[index] = survey;

      if (isRoad(value)) {
        roads++;
        this._findSidewalks(x, y, sidewalks);
      } else if (isOpenWater(value)) {
        water.push(index);
      } else if (value >= FIRE && value <= LASTFIRE) {
        emitters.push({x: x * TILE + 8, y: y * TILE + 6, z: this.isometric ? 6 : 0, rate: 2.5, kind: 'fire'});
      } else if (raw & ZONEBIT) {
        this._findEmitters(x, y, value, emitters);
      }
    }
  }

  this._roadCount = roads;
  this._waterTiles = water;
  this._sidewalks = sidewalks;
  this._sidewalkSet = new Set(sidewalks.map(function(s) { return s.key; }));
  this._emitters = emitters;
};


// A road tile has a sidewalk on each side that faces houses, flats or shops, along the direction of the road
AmbientLife.prototype._findSidewalks = function(x, y, sidewalks) {
  var horizontal = isRoad(this._tileValue(x - 1, y)) || isRoad(this._tileValue(x + 1, y));
  var vertical = isRoad(this._tileValue(x, y - 1)) || isRoad(this._tileValue(x, y + 1));
  var width = this._map.width;

  for (var side = 0; side < 4; side++) {
    var alongX = side === 0 || side === 2;
    if ((alongX && !horizontal) || (!alongX && !vertical))
      continue;

    if (isBusy(this._tileValue(x + DX[side], y + DY[side])))
      sidewalks.push({tx: x, ty: y, side: side, key: (y * width + x) * 4 + side});
  }
};


// Factories and power plants smoke
AmbientLife.prototype._findEmitters = function(x, y, value, emitters) {
  if (this.isometric) {
    // From the chimneys of the zone's building (x and y is its centre)
    var building = IsoTiles.buildingOf(value);
    var points = building ? EMITTERS[building.name] : null;
    if (!points)
      return;

    var rate = {smoke: 2.6, steam: 2}[points[0][3]];
    for (var i = 0; i < points.length; i++) {
      emitters.push({x: (x - 1) * TILE + points[i][0], y: (y - 1) * TILE + points[i][1], z: points[i][2],
                     rate: rate / points.length * 1.5, kind: points[i][3]});
    }
    return;
  }

  if (isDevelopedIndustry(value)) {
    // Somewhere along the top of the zone, the same place every time for a given zone
    var offset = ((x * 7 + y * 13) % 5) * 6 - 12;
    emitters.push({x: x * TILE + 8 + offset, y: (y - 1) * TILE + 5, rate: 2.2, kind: 'smoke'});
  } else if (value === POWERPLANT) {
    // From the roof of the coal power plant's main building
    var left = (x - 1) * TILE;
    var top = (y - 1) * TILE;
    emitters.push({x: left + 18, y: top + 4, rate: 3, kind: 'smoke'});
    emitters.push({x: left + 30, y: top + 4, rate: 3, kind: 'smoke'});
  } else if (value === NUCLEAR) {
    // From the nuclear power plant's two cooling towers
    left = (x - 1) * TILE;
    top = (y - 1) * TILE;
    emitters.push({x: left + 30, y: top + 9, rate: 2.5, kind: 'steam'});
    emitters.push({x: left + 53, y: top + 9, rate: 2.5, kind: 'steam'});
  } else if (value === GASPLANT) {
    // A light plume from the gas plant's chimney
    emitters.push({x: (x - 1) * TILE + 41, y: (y - 1) * TILE + 3, rate: 1.6, kind: 'steam'});
  }
};


// --- Particles: smoke, steam, dust and fireworks --------------------------------------------------------------------

AmbientLife.prototype._addParticle = function(p) {
  if (this.particles.length >= MAX_PARTICLES)
    return;

  if (p.ax === undefined) {
    p.ax = p.x;
    p.ay = p.y;
  }
  p.az = p.az || 0;
  p.age = 0;
  this.particles.push(p);
};


AmbientLife.prototype._emit = function(emitter) {
  var wind = this._wind;

  switch (emitter.kind) {
    case 'smoke':
    case 'fire':
      var fire = emitter.kind === 'fire';
      this._addParticle({x: emitter.x + randomBetween(-1.5, 1.5), y: emitter.y, az: emitter.z,
                         vx: wind.x * 0.7 + randomBetween(-1.5, 1.5),
                         vy: -randomBetween(6, 9) + wind.y * 0.4, gravity: 0, life: randomBetween(3, 4.5),
                         size0: 2, size1: fire ? 8 : 7, c0: fire ? [52, 44, 44] : [72, 72, 82],
                         c1: fire ? [126, 118, 116] : [184, 186, 196], a0: 0.85, a1: 0, fade: true});
      break;

    case 'steam':
      this._addParticle({x: emitter.x + randomBetween(-4, 4), y: emitter.y, az: emitter.z,
                         vx: wind.x * 0.6 + randomBetween(-1, 1),
                         vy: -randomBetween(4, 6) + wind.y * 0.3, gravity: 0, life: randomBetween(3.5, 5),
                         size0: 3, size1: 9, c0: [250, 252, 255], c1: [222, 228, 238], a0: 0.8, a1: 0, fade: true});
      break;
  }
};


// A puff of dust around a building that has just been built: x and y are its centre tile
AmbientLife.prototype._dust = function(x, y, size, isZone) {
  var left = (isZone ? x - 1 : x) * TILE;
  var top = (isZone ? y - 1 : y) * TILE;
  var extent = size * TILE;
  var count = isZone ? 10 + size * 4 : 6;

  for (var i = 0; i < count; i++) {
    // Mostly around the edges of the site
    var edge = Math.floor(Math.random() * 4);
    var t = Math.random() * extent;
    var px = edge === 0 ? left + t : (edge === 1 ? left + extent : (edge === 2 ? left + t : left));
    var py = edge === 0 ? top : (edge === 1 ? top + t : (edge === 2 ? top + extent : top + t));
    this._addParticle({x: px, y: py, vx: randomBetween(-9, 9), vy: -randomBetween(3, 12), gravity: 14,
                       life: randomBetween(0.7, 1.4), size0: 1, size1: 3, c0: [176, 156, 120], c1: [226, 214, 186],
                       a0: 0.9, a1: 0});
  }
};


AmbientLife.prototype._burst = function(rocket) {
  var colour = pick(FIREWORK_COLOURS);
  var second = pick(FIREWORK_COLOURS);
  var count = Math.floor(randomBetween(36, 52));
  var x = rocket.x;
  var y = rocket.y;

  this._addParticle({x: x, y: y, ax: rocket.ax, ay: rocket.ay, az: rocket.az, vx: 0, vy: 0, gravity: 0, life: 0.25,
                     size0: 10, size1: 16, c0: [255, 250, 230], c1: colour, a0: 0.55, a1: 0, glow: true});

  for (var i = 0; i < count; i++) {
    var angle = (i / count) * Math.PI * 2 + randomBetween(-0.1, 0.1);
    var speed = randomBetween(30, 62);
    this._addParticle({x: x, y: y, ax: rocket.ax, ay: rocket.ay, az: rocket.az, vx: Math.cos(angle) * speed,
                       vy: Math.sin(angle) * speed, gravity: 22,
                       drag: 1.6, life: randomBetween(1.3, 2.1), size0: 2, size1: 1, c0: colour,
                       c1: i % 3 === 0 ? second : colour, a0: 1, a1: 0, glow: true, fade: true, twinkle: i % 4 === 0});
  }
};


AmbientLife.prototype._updateParticles = function(seconds) {
  var kept = [];

  for (var i = 0; i < this.particles.length; i++) {
    var p = this.particles[i];
    p.age += seconds;

    if (p.age >= p.life) {
      if (p.rocket)
        this._burst(p);
      continue;
    }

    if (p.drag) {
      var damping = Math.max(0, 1 - p.drag * seconds);
      p.vx *= damping;
      p.vy *= damping;
    }

    p.vy += p.gravity * seconds;
    p.x += p.vx * seconds;
    p.y += p.vy * seconds;

    // Rockets leave a trail of sparks
    if (p.rocket && Math.random() < 0.8)
      this._addParticle({x: p.x, y: p.y, ax: p.ax, ay: p.ay, az: p.az, vx: randomBetween(-2, 2), vy: randomBetween(2, 6),
                         gravity: 0, life: 0.4,
                         size0: 1, size1: 1, c0: [255, 236, 180], c1: [255, 160, 80], a0: 0.9, a1: 0, glow: true});

    kept.push(p);
  }

  this.particles = kept;

  for (i = 0; i < this._emitters.length; i++) {
    var emitter = this._emitters[i];
    if (Math.random() < emitter.rate * seconds)
      this._emit(emitter);
  }
};


// Launches fireworks over the area in view, to celebrate a milestone
AmbientLife.prototype.celebrate = function(view) {
  for (var i = 0; i < 12; i++)
    this._fireworks.push({delay: i * 0.35 + randomBetween(0, 0.3), view: view});
};


AmbientLife.prototype._updateFireworks = function(seconds) {
  var pending = [];

  for (var i = 0; i < this._fireworks.length; i++) {
    var f = this._fireworks[i];
    f.delay -= seconds;
    if (f.delay > 0) {
      pending.push(f);
      continue;
    }

    // In the isometric view, the rockets are launched from the bottom of the screen, from the point of the map there
    var view = f.view.screen || f.view;
    var height = randomBetween(0.45, 0.65) * view.height;
    var x = view.x + randomBetween(0.2, 0.8) * view.width;
    var y = view.y + view.height * 0.85;
    var ground = f.view.screen ? f.view.toMap(x, y) : {x: x, y: y};
    var life = randomBetween(0.9, 1.3);
    // Launch fast enough to reach the bursting height as gravity slows the rocket down
    var gravity = 30;
    var vy = -(height / life + gravity * life / 2);
    this._addParticle({x: ground.x, y: ground.y, vx: randomBetween(-6, 6), vy: vy, gravity: gravity, life: life,
                       size0: 2, size1: 2,
                       c0: [255, 244, 210], c1: [255, 200, 120], a0: 1, a1: 1, rocket: true, glow: true});
  }

  this._fireworks = pending;
};


// --- Cars ---------------------------------------------------------------------------------------------------------

// How busy the city is, from 0 (empty) to 1
AmbientLife.prototype._activity = function() {
  var population = this._simulation.getPopulation();
  if (population <= 0)
    return 0;

  return Math.min(1, 0.25 + population / 20000);
};


// How many cars the visible roads should carry: up to one for every three road tiles
AmbientLife.prototype._carTarget = function() {
  return Math.min(MAX_CARS, Math.round(this._roadCount * 0.33 * this._activity()));
};


AmbientLife.prototype._spawnCar = function(bounds) {
  var tx = Math.floor(randomBetween(bounds.minX, bounds.maxX + 1));
  var ty = Math.floor(randomBetween(bounds.minY, bounds.maxY + 1));
  if (!isRoad(this._tileValue(tx, ty)))
    return;

  // Busier roads get more cars
  var traffic = this._simulation.blockMaps.trafficDensityMap.worldGet(tx, ty);
  if (Math.random() > 0.3 + 0.7 * traffic / 240)
    return;

  var options = [];
  for (var dir = 0; dir < 4; dir++) {
    if (isRoad(this._tileValue(tx + DX[dir], ty + DY[dir])))
      options.push(dir);
  }

  if (options.length === 0)
    return;

  var car = {tx: tx, ty: ty, dir: pick(options), progress: Math.random(), speed: randomBetween(1.6, 2.6),
             colour: pick(CAR_COLOURS), x: 0, y: 0};
  positionCar(car);
  this.cars.push(car);
};


// Drive from the current tile towards the next one, keeping to the right
var positionCar = function(car) {
  car.x = (car.tx + DX[car.dir] * car.progress) * TILE + LANE_X[car.dir];
  car.y = (car.ty + DY[car.dir] * car.progress) * TILE + LANE_Y[car.dir];
};


// Picks the direction to take on arriving at a new tile, or -1 if the car has nowhere to go
AmbientLife.prototype._chooseDirection = function(car) {
  var straight = -1;
  var turns = [];

  for (var dir = 0; dir < 4; dir++) {
    if (dir === (car.dir + 2) % 4)
      continue;

    if (!isRoad(this._tileValue(car.tx + DX[dir], car.ty + DY[dir])))
      continue;

    if (dir === car.dir)
      straight = dir;
    else
      turns.push(dir);
  }

  if (straight !== -1 && (turns.length === 0 || Math.random() < 0.65))
    return straight;

  if (turns.length > 0)
    return pick(turns);

  // A dead end: turn around
  var back = (car.dir + 2) % 4;
  return isRoad(this._tileValue(car.tx + DX[back], car.ty + DY[back])) ? back : -1;
};


AmbientLife.prototype._updateCars = function(seconds, bounds) {
  var kept = [];

  for (var i = 0; i < this.cars.length; i++) {
    var car = this.cars[i];
    car.progress += car.speed * seconds;

    var alive = true;
    while (car.progress >= 1 && alive) {
      car.progress -= 1;
      car.tx += DX[car.dir];
      car.ty += DY[car.dir];

      // The road may have been bulldozed under the car
      if (!isRoad(this._tileValue(car.tx, car.ty)) || !this._inBounds(car.tx, car.ty, bounds)) {
        alive = false;
        break;
      }

      var dir = this._chooseDirection(car);
      if (dir === -1)
        alive = false;
      else
        car.dir = dir;
    }

    if (!alive)
      continue;

    positionCar(car);
    kept.push(car);
  }

  this.cars = kept;

  var target = this._carTarget();
  for (var attempts = 0; attempts < 6 && this.cars.length < target; attempts++)
    this._spawnCar(bounds);

  // If the city shrinks, let the excess drive away quietly
  if (this.cars.length > target + 10)
    this.cars.length = target + 10;
};


// --- Pedestrians --------------------------------------------------------------------------------------------------

AmbientLife.prototype._pedestrianTarget = function() {
  // Fewer people out at night
  var outdoors = 1 - 0.6 * this.getSky().lights;
  return Math.min(MAX_PEDESTRIANS, Math.round(this._sidewalks.length * 0.5 * this._activity() * outdoors));
};


var positionPedestrian = function(p) {
  var alongX = p.side === 0 || p.side === 2;
  p.x = p.tx * TILE + (alongX ? p.t : SIDEWALK_X[p.side]);
  p.y = p.ty * TILE + (alongX ? SIDEWALK_Y[p.side] : p.t);
};


AmbientLife.prototype._spawnPedestrian = function() {
  if (this._sidewalks.length === 0)
    return;

  var walk = pick(this._sidewalks);
  var p = {tx: walk.tx, ty: walk.ty, side: walk.side, t: randomBetween(0, TILE), dir: Math.random() < 0.5 ? 1 : -1,
           speed: randomBetween(4, 8), life: randomBetween(15, 40), clothes: pick(CLOTHES), skin: pick(SKIN),
           step: 0, x: 0, y: 0};
  positionPedestrian(p);
  this.pedestrians.push(p);
};


AmbientLife.prototype._updatePedestrians = function(seconds) {
  var width = this._map.width;
  var kept = [];

  for (var i = 0; i < this.pedestrians.length; i++) {
    var p = this.pedestrians[i];
    p.life -= seconds;
    if (p.life <= 0 || !this._sidewalkSet.has((p.ty * width + p.tx) * 4 + p.side))
      continue;

    p.t += p.dir * p.speed * seconds;
    p.step += seconds * p.speed;

    if (p.t < 0 || p.t >= TILE) {
      // Carry on along the next stretch of sidewalk, or turn back
      var alongX = p.side === 0 || p.side === 2;
      var nx = p.tx + (alongX ? p.dir : 0);
      var ny = p.ty + (alongX ? 0 : p.dir);
      if (this._sidewalkSet.has((ny * width + nx) * 4 + p.side)) {
        p.tx = nx;
        p.ty = ny;
        p.t -= p.dir * TILE;
      } else {
        p.dir = -p.dir;
        p.t = Math.max(0, Math.min(TILE - 0.01, p.t));
      }
    }

    positionPedestrian(p);
    kept.push(p);
  }

  this.pedestrians = kept;

  var target = this._pedestrianTarget();
  for (var attempts = 0; attempts < 3 && this.pedestrians.length < target; attempts++)
    this._spawnPedestrian();
};


// --- Boats --------------------------------------------------------------------------------------------------------

AmbientLife.prototype._updateBoats = function(seconds, bounds) {
  var width = this._map.width;
  var kept = [];

  for (var i = 0; i < this.boats.length; i++) {
    var boat = this.boats[i];
    var nx = boat.x + boat.vx * seconds;
    var ny = boat.y + boat.vy * seconds;

    // Look a little ahead, so boats turn before reaching the shore
    var aheadX = Math.floor((nx + Math.sign(boat.vx) * 10) / TILE);
    var aheadY = Math.floor((ny + Math.sign(boat.vy) * 10) / TILE);

    if (isOpenWater(this._tileValue(aheadX, aheadY))) {
      boat.x = nx;
      boat.y = ny;
    } else {
      this._steerBoat(boat);
    }

    var tx = Math.floor(boat.x / TILE);
    var ty = Math.floor(boat.y / TILE);
    if (this._inBounds(tx, ty, bounds) && isOpenWater(this._tileValue(tx, ty)))
      kept.push(boat);
  }

  this.boats = kept;

  // Only a few boats, and only on reasonably large stretches of water
  var target = Math.min(MAX_BOATS, Math.floor(this._waterTiles.length / 40));
  if (this.boats.length < target && Math.random() < seconds * 0.5) {
    var index = pick(this._waterTiles);
    var boat = {x: (index % width + 0.5) * TILE, y: (Math.floor(index / width) + 0.5) * TILE, vx: 0, vy: 0};
    this._steerBoat(boat);
    this.boats.push(boat);
  }
};


AmbientLife.prototype._steerBoat = function(boat) {
  var angle = Math.random() * Math.PI * 2;
  var speed = randomBetween(5, 9);
  boat.vx = Math.cos(angle) * speed;
  boat.vy = Math.sin(angle) * speed * 0.6;
};


// --- Birds --------------------------------------------------------------------------------------------------------

AmbientLife.prototype._spawnFlock = function(view) {
  // Fly across the view from one side to the other
  var fromLeft = Math.random() < 0.5;
  var speed = randomBetween(26, 38);
  var startX = fromLeft ? view.x - 40 : view.x + view.width + 40;
  var startY = view.y + randomBetween(0.15, 0.85) * view.height;
  var vx = fromLeft ? speed : -speed;
  var vy = randomBetween(-0.3, 0.3) * speed;
  var count = Math.floor(randomBetween(3, 7));

  for (var i = 0; i < count; i++) {
    // A loose V formation
    var rank = Math.ceil(i / 2);
    var side = i % 2 === 0 ? 1 : -1;
    this.birds.push({x: startX - Math.sign(vx) * rank * 7 + randomBetween(-1.5, 1.5), y: startY + side * rank * 6,
                     vx: vx, vy: vy, phase: Math.random() * Math.PI * 2, flap: 0});
  }
};


AmbientLife.prototype._updateBirds = function(seconds, view) {
  var kept = [];

  for (var i = 0; i < this.birds.length; i++) {
    var bird = this.birds[i];
    bird.phase += seconds * 9;
    bird.x += bird.vx * seconds;
    bird.y += bird.vy * seconds + Math.sin(bird.phase * 0.3) * 0.15;
    bird.flap = Math.sin(bird.phase) > 0 ? 1 : 0;

    if (bird.x > view.x - 80 && bird.x < view.x + view.width + 80 &&
        bird.y > view.y - 80 && bird.y < view.y + view.height + 80)
      kept.push(bird);
  }

  this.birds = kept;

  this._nextFlock -= seconds * 1000;
  if (this._nextFlock <= 0) {
    // Birds roost at night
    if (this.getSky().lights < 0.5)
      this._spawnFlock(view);
    this._nextFlock = randomBetween(15000, 35000);
  }
};


// --- Clouds ---------------------------------------------------------------------------------------------------------

// Draws a cloud's shadow as a small black bitmap: a cluster of overlapping discs
var makeCloudShape = function() {
  var width = Math.floor(randomBetween(28, 46));
  var height = Math.floor(width * randomBetween(0.45, 0.6));
  var canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';

  var puffs = Math.floor(randomBetween(4, 7));
  for (var i = 0; i < puffs; i++) {
    var r = randomBetween(height * 0.25, height * 0.45);
    var x = randomBetween(r, width - r);
    var y = randomBetween(r, height - r);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Remove the anti-aliasing, for crisp pixel edges
  var image = ctx.getImageData(0, 0, width, height);
  for (var p = 3; p < image.data.length; p += 4)
    image.data[p] = image.data[p] > 110 ? 255 : 0;
  ctx.putImageData(image, 0, 0);
  return canvas;
};


AmbientLife.prototype._updateClouds = function(seconds, view) {
  var wind = this._wind;
  var kept = [];

  for (var i = 0; i < this.clouds.length; i++) {
    var cloud = this.clouds[i];
    cloud.x += wind.x * seconds;
    cloud.y += wind.y * seconds;
    var w = cloud.shape.width * 4;
    var h = cloud.shape.height * 4;
    if (cloud.x + w > view.x - 200 && cloud.x < view.x + view.width + 200 &&
        cloud.y + h > view.y - 200 && cloud.y < view.y + view.height + 200)
      kept.push(cloud);
  }

  this.clouds = kept;

  this._nextCloud -= seconds * 1000;
  if (this._nextCloud <= 0 && this.clouds.length < 4) {
    var shape = makeCloudShape();
    var w = shape.width * 4;
    var h = shape.height * 4;
    var first = this._lastUpdate === null;
    var x, y;

    if (first || Math.random() < 0.2) {
      // Somewhere in view (always so for the first cloud, so that the sky is not empty to begin with)
      x = view.x + randomBetween(-w / 2, view.width - w / 2);
      y = view.y + randomBetween(-h / 2, view.height - h / 2);
    } else if (Math.abs(wind.x) > Math.abs(wind.y)) {
      // Upwind of the view, so the cloud drifts in
      x = wind.x > 0 ? view.x - w - 20 : view.x + view.width + 20;
      y = view.y + randomBetween(-h / 2, view.height - h / 2);
    } else {
      x = view.x + randomBetween(-w / 2, view.width - w / 2);
      y = wind.y > 0 ? view.y - h - 20 : view.y + view.height + 20;
    }

    this.clouds.push({x: x, y: y, shape: shape});
    this._nextCloud = randomBetween(9000, 20000);
  }
};


// --- Day and night ----------------------------------------------------------------------------------------------

// The colour to multiply the map by, and how bright the lights are (0 to 1), at the current time of day
AmbientLife.prototype.getSky = function() {
  if (!this.dayNight)
    return {tint: null, lights: 0};

  var time = this._time % 1;
  for (var i = 1; i < SKY.length; i++) {
    var to = SKY[i];
    if (time <= to.time) {
      var from = SKY[i - 1];
      var t = (time - from.time) / (to.time - from.time);
      var tint = mix(from.tint, to.tint, t);
      var lights = from.lights + (to.lights - from.lights) * t;
      var daylight = tint[0] > 254 && tint[1] > 254 && tint[2] > 254;
      return {tint: daylight ? null : tint, lights: lights};
    }
  }

  return {tint: null, lights: 0};
};


AmbientLife.prototype.setDayNight = function(enabled) {
  this.dayNight = !!enabled;
};


// The time of day, as a fraction of a day from midnight... well, from the morning (see SKY)
AmbientLife.prototype.getTimeOfDay = function() {
  return this._time % 1;
};


AmbientLife.prototype.setTimeOfDay = function(time) {
  if (typeof(time) === 'number' && isFinite(time))
    this._time = ((time % 1) + 1) % 1;
};


// --- Main loop ----------------------------------------------------------------------------------------------------

// Called every frame. view is the visible area in world pixels; running is false while the game is paused.
AmbientLife.prototype.update = function(elapsed, view, running) {
  // Large gaps (e.g. after the tab was hidden) are not replayed
  var seconds = Math.min(elapsed, 100) / 1000;
  var now = performance.now();
  var bounds = this._tileBounds(view);

  if (now - this._lastSurvey > SURVEY_INTERVAL) {
    // Changes are only reported while the game runs: the player's own building work while paused would otherwise
    // all appear at once
    this._survey(bounds, running);
    this._lastSurvey = now;
  }

  // Like the water, the clouds keep moving while the game is paused
  this._updateClouds(seconds, view);
  this._lastUpdate = now;

  if (!running)
    return;

  if (this.dayNight)
    this._time = (this._time + seconds / DAY_LENGTH) % 1;

  this._updateCars(seconds, bounds);
  this._updatePedestrians(seconds);
  this._updateBoats(seconds, bounds);
  this._updateBirds(seconds, view);
  this._updateParticles(seconds);
  this._updateFireworks(seconds);
};


export { AmbientLife };
