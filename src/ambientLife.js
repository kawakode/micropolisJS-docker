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

import { CHANNEL, HRAILROAD, LASTROAD, RIVER, ROADBASE, VRAILROAD } from "./tileValues.ts";

/*
 *
 * Ambient life: purely decorative cars, boats and birds that make the city feel alive. They have no effect on the
 * simulation, but follow it: cars drive on the roads, more of them where the simulation measures more traffic and
 * as the population grows, and everything stops when the game is paused. Only the area in view (plus a margin) is
 * populated. Positions are in world pixels (16 per tile).
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

var CAR_COLOURS = ['#d83c30', '#3c6ad8', '#f2f0e6', '#f8c838', '#3ca850', '#e07830', '#9094a8', '#58c4d4',
                   '#a050c0', '#f2f0e6', '#d83c30', '#3c6ad8'];

var MAX_CARS = 160;
var MAX_BOATS = 4;
var MARGIN_TILES = 3;
var SURVEY_INTERVAL = 1000;


var isRoad = function(value) {
  return (value >= ROADBASE && value <= LASTROAD) || value === HRAILROAD || value === VRAILROAD;
};


// Open water, away from the shore
var isOpenWater = function(value) {
  return value >= RIVER && value <= CHANNEL;
};


var randomBetween = function(min, max) {
  return min + Math.random() * (max - min);
};


function AmbientLife(map, simulation) {
  this._map = map;
  this._simulation = simulation;

  this.cars = [];
  this.boats = [];
  this.birds = [];

  // What is in view, surveyed periodically: the road and open water tiles
  this._lastSurvey = -Infinity;
  this._roadCount = 0;
  this._waterTiles = [];
  this._view = null;

  this._nextFlock = randomBetween(4000, 12000);

  // Clouds drift with the wind, which changes from game to game
  this.clouds = [];
  var wind = Math.random() * Math.PI * 2;
  this._wind = {x: Math.cos(wind) * 7, y: Math.sin(wind) * 4};
  this._nextCloud = 0;
  this._lastUpdate = null;
}


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


AmbientLife.prototype._survey = function(bounds) {
  var roads = 0;
  var water = [];

  for (var y = bounds.minY; y <= bounds.maxY; y++) {
    for (var x = bounds.minX; x <= bounds.maxX; x++) {
      var value = this._map.getTileValue(x, y);
      if (isRoad(value))
        roads++;
      else if (isOpenWater(value))
        water.push(y * this._map.width + x);
    }
  }

  this._roadCount = roads;
  this._waterTiles = water;
};


AmbientLife.prototype._inBounds = function(tx, ty, bounds) {
  return tx >= bounds.minX && tx <= bounds.maxX && ty >= bounds.minY && ty <= bounds.maxY;
};


// --- Cars ---------------------------------------------------------------------------------------------------------

// How many cars the visible roads should carry
AmbientLife.prototype._carTarget = function() {
  var population = this._simulation.evaluation.cityPop;
  if (population <= 0 || this._roadCount === 0)
    return 0;

  // A busier city has more cars, up to one for every three road tiles
  var activity = Math.min(1, 0.25 + population / 20000);
  return Math.min(MAX_CARS, Math.round(this._roadCount * 0.33 * activity));
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

  var colour = CAR_COLOURS[Math.floor(Math.random() * CAR_COLOURS.length)];
  var car = {tx: tx, ty: ty, dir: options[Math.floor(Math.random() * options.length)], progress: Math.random(),
             speed: randomBetween(1.6, 2.6), colour: colour, x: 0, y: 0};
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
    return turns[Math.floor(Math.random() * turns.length)];

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

    boat.wake += seconds;

    var tx = Math.floor(boat.x / TILE);
    var ty = Math.floor(boat.y / TILE);
    if (this._inBounds(tx, ty, bounds) && isOpenWater(this._tileValue(tx, ty)))
      kept.push(boat);
  }

  this.boats = kept;

  // Only a few boats, and only on reasonably large stretches of water
  var target = Math.min(MAX_BOATS, Math.floor(this._waterTiles.length / 40));
  if (this.boats.length < target && Math.random() < seconds * 0.5) {
    var index = this._waterTiles[Math.floor(Math.random() * this._waterTiles.length)];
    var boat = {x: (index % width + 0.5) * TILE, y: (Math.floor(index / width) + 0.5) * TILE, vx: 0, vy: 0, wake: 0};
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


// Called every frame. view is the visible area in world pixels; running is false while the game is paused.
AmbientLife.prototype.update = function(elapsed, view, running) {
  // Large gaps (e.g. after the tab was hidden) are not replayed
  var seconds = Math.min(elapsed, 100) / 1000;
  var now = performance.now();
  var bounds = this._tileBounds(view);

  if (now - this._lastSurvey > SURVEY_INTERVAL) {
    this._survey(bounds);
    this._lastSurvey = now;
  }

  // Like the water, the clouds keep moving while the game is paused
  this._updateClouds(seconds, view);
  this._lastUpdate = now;

  if (!running)
    return;

  this._updateCars(seconds, bounds);
  this._updateBoats(seconds, bounds);
  this._updateBirds(seconds, view);
};


export { AmbientLife };
