/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { BaseTool } from './baseTool.js';
import { EventEmitter } from './eventEmitter.js';
import { GameMap } from './gameMap.js';
import * as Messages from './messages.ts';
import { Scenarios } from './scenarios.js';
import { Simulation } from './simulation.js';
import * as SpriteConstants from './spriteConstants.ts';
import { ALLBITS, BIT_MASK, CONDBIT, POWERBIT } from './tileFlags.ts';

// The copy of a shared city that each player's game keeps. The server simulates the city and sends what changes (see
// server/game/cityState.ts): this module applies its messages to a GameMap and to an inert Simulation (one that never
// changes the city by itself). The game then shows the copy as it shows a city of its own: the same objects, read the
// same way, with the same events. Nothing here touches the page.
//
// The messages, as the server sends them (each has been through JSON):
// - welcome: {save, state, stats, maps, sprites}: the whole city (see fromWelcome and applyWelcome)
// - tiles: {c: [index, raw value, ...], r: [index, road class, ...]}, the tiles that changed (see applyTiles)
// - state: the figures that change often, only those that changed (see applyState)
// - stats: the evaluation, the budget, the census and the neighbours (see applyStats)
// - maps: the overlays of the minimap that changed (see applyMaps)
// - sprites: [[id, type, frame, x, y], ...], the moving things (see RemoteSprites)
// - msg: {subject, data}, the news, its data naming a sprite by spriteId (see resolveMessage)

var WIDTH = 120;
var HEIGHT = 100;

// The overlays of the minimap the server sends (the power overlay is read from the tiles' POWERBIT)
var MAP_NAMES = ['populationDensityMap', 'trafficDensityMap', 'pollutionDensityMap', 'crimeRateMap', 'landValueMap',
                 'policeStationEffectMap', 'fireStationEffectMap', 'rateOfGrowthMap', 'educationEffectMap'];

// What the stats hold of the evaluation (with problemVotes and problemOrder), of the budget (the funds and the
// automatic budget come with the state) and of the census (the averages, then the histories when they changed)
var EVALUATION_FIELDS = ['cityYes', 'cityPop', 'cityPopDelta', 'cityAssessedValue', 'cityClass', 'cityScore',
                         'cityScoreDelta'];
var BUDGET_FIELDS = ['policePercent', 'roadPercent', 'firePercent', 'roadSpend', 'policeSpend', 'fireSpend',
                     'roadMaintenanceBudget', 'policeMaintenanceBudget', 'fireMaintenanceBudget', 'cityTax',
                     'roadEffect', 'policeEffect', 'fireEffect', 'dealsFund', 'upkeepFund', 'debt', 'debtPayment',
                     'loanFund', 'ordinances', 'ordinanceFund', 'taxFund',
                     'cashFlow'];
var CENSUS_FIELDS = ['resPop', 'comPop', 'indPop', 'crimeRamp', 'pollutionRamp', 'landValueAverage',
                     'pollutionAverage', 'crimeAverage', 'totalPop'];
var HISTORY_FIELDS = ['resHist10', 'resHist120', 'comHist10', 'comHist120', 'indHist10', 'indHist120', 'crimeHist10',
                      'crimeHist120', 'moneyHist10', 'moneyHist120', 'pollutionHist10', 'pollutionHist120'];
var HISTORY_LENGTH = 120;

// The figures of the state, in the order they are applied
var STATE_KEYS = ['cityTime', 'date', 'funds', 'population', 'cityClass', 'score', 'valves', 'speed', 'paused',
                  'autoBudget', 'autoBulldoze', 'disasters', 'level', 'scenario'];

// The sprites are drawn this long after the server's positions arrive, moving between the last two
var SPRITE_DELAY = 100;

// A sprite that moved further than this between two positions (in pixels) jumps there
var SNAP_DISTANCE = 64;

// How long a sprite named by a message waits for its first position, in milliseconds
var PENDING_LIFETIME = 1000;

// The size of each kind of sprite, and where it is drawn from its position (as each sprite's constructor sets them)
var SPRITE_SIZES = {};
SPRITE_SIZES[SpriteConstants.SPRITE_TRAIN] = {width: 32, xOffset: -16, yOffset: -16};
SPRITE_SIZES[SpriteConstants.SPRITE_HELICOPTER] = {width: 32, xOffset: -16, yOffset: -16};
SPRITE_SIZES[SpriteConstants.SPRITE_AIRPLANE] = {width: 48, xOffset: -24, yOffset: -24};
SPRITE_SIZES[SpriteConstants.SPRITE_SHIP] = {width: 48, xOffset: -24, yOffset: -24};
SPRITE_SIZES[SpriteConstants.SPRITE_MONSTER] = {width: 48, xOffset: -24, yOffset: -24};
SPRITE_SIZES[SpriteConstants.SPRITE_TORNADO] = {width: 48, xOffset: -24, yOffset: -40};
SPRITE_SIZES[SpriteConstants.SPRITE_EXPLOSION] = {width: 48, xOffset: -24, yOffset: -24};

// The sprite a message is about, when it names one
var SPRITE_OF_SUBJECT = {};
SPRITE_OF_SUBJECT[Messages.MONSTER_SIGHTED] = SpriteConstants.SPRITE_MONSTER;
SPRITE_OF_SUBJECT[Messages.TORNADO_SIGHTED] = SpriteConstants.SPRITE_TORNADO;


var isOwn = function(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
};


var isObject = function(value) {
  return value !== null && typeof(value) === 'object' && !Array.isArray(value);
};


var isNumber = function(value) {
  return typeof(value) === 'number' && isFinite(value);
};


var isBoolean = function(value) {
  return value === true || value === false;
};


// A tile's raw value: its number, and its flags
var isRawValue = function(value) {
  return Number.isInteger(value) && value >= 0 && value <= (BIT_MASK | ALLBITS);
};


var copyOf = function(value) {
  return JSON.parse(JSON.stringify(value));
};


// --- The sprites ----------------------------------------------------------------------------------------------------

// A sprite of the server's city: what the game draws, and follows (see MonsterTV), in place of the sprites the
// simulation would make. x and y are where it is drawn now, in pixels.
var RemoteSprite = EventEmitter(function(id, type) {
  this.id = id;
  this.frame = 0;
  this.x = 0;
  this.y = 0;
  this._setType(type);

  // The last two positions received, and when: {x, y, time}
  this._from = null;
  this._to = null;

  // A sprite named by a message, waiting for its first position (see RemoteSprites.track)
  this._pending = false;
  this._madeAt = 0;
});


Object.defineProperties(RemoteSprite.prototype, {
  worldX: {get: function() { return this.x >> 4; }},
  worldY: {get: function() { return this.y >> 4; }}
});


RemoteSprite.prototype._setType = function(type) {
  var size = SPRITE_SIZES[type] || SPRITE_SIZES[SpriteConstants.SPRITE_EXPLOSION];
  this.type = type;
  this.width = size.width;
  this.xOffset = size.xOffset;
  this.yOffset = size.yOffset;
};


// Puts the sprite at a position at once
RemoteSprite.prototype._snap = function(x, y, now) {
  this._from = {x: x, y: y, time: now};
  this._to = {x: x, y: y, time: now};
  this.x = x;
  this.y = y;
};


// Where the sprite is drawn at the given time: between its last two positions, as they were when received
RemoteSprite.prototype._place = function(time) {
  var from = this._from;
  var to = this._to;
  var t = to.time > from.time ? (time - from.time) / (to.time - from.time) : 1;
  t = Math.max(0, Math.min(1, t));
  this.x = Math.round(from.x + (to.x - from.x) * t);
  this.y = Math.round(from.y + (to.y - from.y) * t);
};


var isSample = function(sample) {
  return Array.isArray(sample) && sample.length === 5 && Number.isInteger(sample[0]) && sample[0] > 0 &&
         Number.isInteger(sample[1]) && Number.isInteger(sample[2]) && sample[2] > 0 &&
         Number.isInteger(sample[3]) && Number.isInteger(sample[4]);
};


// The sprites of the server's city, from its sprites messages: one RemoteSprite for each id. Times are in
// milliseconds, from any clock that goes forward (Date.now() or performance.now()), the same for every call.
function RemoteSprites() {
  this._byId = Object.create(null);
  this._list = [];
}


// A sprites message: [[id, type, frame, x, y], ...]. New sprites appear where they are; the others move from their
// last position to the new one, or jump there when it is far. Each sprite that moved tells its listeners
// (SPRITE_MOVED, with its tile: {x, y}), and each one that went says it is dying (SPRITE_DYING).
RemoteSprites.prototype.receive = function(samples, now) {
  var byId = Object.create(null);
  var list = [];
  var moved = [];

  (Array.isArray(samples) ? samples : []).forEach(function(sample) {
    if (!isSample(sample) || byId[sample[0]] !== undefined)
      return;

    var id = sample[0];
    var type = sample[1];
    var x = sample[3];
    var y = sample[4];
    var sprite = this._byId[id];

    if (sprite === undefined || (sprite.type !== type && !sprite._pending)) {
      sprite = new RemoteSprite(id, type);
      sprite._snap(x, y, now);
    } else if (sprite._pending) {
      sprite._setType(type);
      sprite._pending = false;
      sprite._snap(x, y, now);
    } else {
      var last = sprite._to;
      if (x !== last.x || y !== last.y)
        moved.push(sprite);

      if (Math.max(Math.abs(x - last.x), Math.abs(y - last.y)) > SNAP_DISTANCE) {
        sprite._snap(x, y, now);
      } else {
        sprite._from = last;
        sprite._to = {x: x, y: y, time: now};
      }
    }

    sprite.frame = sample[2];
    byId[id] = sprite;
    list.push(sprite);
  }, this);

  var gone = this._list.filter(function(sprite) {
    return byId[sprite.id] !== sprite;
  });

  this._byId = byId;
  this._list = list;
  this.animate(now);

  gone.forEach(dying);
  moved.forEach(function(sprite) {
    sprite._emitEvent(Messages.SPRITE_MOVED, {x: sprite._to.x >> 4, y: sprite._to.y >> 4});
  });
};


var dying = function(sprite) {
  sprite.frame = 0;
  sprite._emitEvent(Messages.SPRITE_DYING);
};


// Replaces every sprite (a new snapshot of the city): those there were all go, the new ones appear where they are
RemoteSprites.prototype.reset = function(samples, now) {
  var gone = this._list;
  this._byId = Object.create(null);
  this._list = [];
  gone.forEach(dying);
  this.receive(samples, now);
};


// Moves the sprites to where they are drawn at this time. A sprite named by a message that never got a position goes.
RemoteSprites.prototype.animate = function(now) {
  var expired = [];
  this._list = this._list.filter(function(sprite) {
    if (sprite._pending && now - sprite._madeAt > PENDING_LIFETIME) {
      expired.push(sprite);
      delete this._byId[sprite.id];
      return false;
    }

    if (!sprite._pending)
      sprite._place(now - SPRITE_DELAY);
    return true;
  }, this);

  expired.forEach(dying);
};


// The sprite with this id, or null
RemoteSprites.prototype.get = function(id) {
  return this._byId[id] || null;
};


// The sprite a message names (by its id, at the given tile): the sprite itself, or, when its first position has not
// arrived yet, one that waits for it and can already be followed
RemoteSprites.prototype.track = function(id, worldX, worldY, type, now) {
  var sprite = this.get(id);
  if (sprite !== null)
    return sprite;

  sprite = new RemoteSprite(id, type);
  sprite._pending = true;
  sprite._madeAt = now;
  sprite._snap((Number.isInteger(worldX) ? worldX : 0) * 16 + 8, (Number.isInteger(worldY) ? worldY : 0) * 16 + 8, now);
  this._byId[id] = sprite;
  this._list.push(sprite);
  return sprite;
};


var isShown = function(sprite) {
  return !sprite._pending && sprite.frame !== 0;
};


// As SpriteManager.getSpriteList
RemoteSprites.prototype.getSpriteList = function() {
  return this._list.filter(isShown);
};


// As SpriteManager.getSprite: the first sprite of the given type, or null
RemoteSprites.prototype.getSprite = function(type) {
  var found = this._list.filter(function(sprite) {
    return isShown(sprite) && sprite.type === type;
  });

  return found.length > 0 ? found[0] : null;
};


// As SpriteManager.getSpritesInView: the sprites in the area, from the given tile, of the given size in pixels
RemoteSprites.prototype.getSpritesInView = function(startX, startY, pixelWidth, pixelHeight) {
  startX = startX * 16;
  startY = startY * 16;
  var lastX = startX + pixelWidth;
  var lastY = startY + pixelHeight;

  return this._list.filter(function(s) {
    if (!isShown(s))
      return false;

    var spriteLeft = s.x + s.xOffset;
    var spriteTop = s.y + s.yOffset;
    var spriteRight = s.x + s.xOffset + s.width;
    var spriteBottom = s.y + s.yOffset + s.width;

    var leftInBounds = spriteLeft >= startX && spriteLeft < lastX;
    var rightInBounds = spriteRight >= startX && spriteRight < lastX;
    var topInBounds = spriteTop >= startY && spriteTop < lastY;
    var bottomInBounds = spriteBottom >= startY && spriteBottom < lastY;

    return (leftInBounds || rightInBounds) && (topInBounds || bottomInBounds);
  });
};


// --- The city -------------------------------------------------------------------------------------------------------

// The copy of a shared city, around a GameMap of 120x100 tiles and an inert Simulation made from a save of the city
// (see fromWelcome). The simulation's view of the city then follows the server: what the game reads of it (the
// population, the history time, the city's status for the news, the neighbours, the sprites) is what the server last
// sent, and the events it gives are those the server's figures call for.
function RemoteCity(map, simulation) {
  this.map = map;
  this.simulation = simulation;
  this.sprites = new RemoteSprites();

  // What the server says beyond what the simulation holds: the speed the city runs at when it is not paused, the
  // automatic bulldozer, the time of the census histories, the city's status, and its neighbours (see
  // Neighbours.describe)
  this.speed = simulation._speed || Simulation.SPEED_MED;
  this.paused = simulation._speed === Simulation.SPEED_PAUSED;
  this.autoBulldoze = BaseTool.getAutoBulldoze();
  this.historyTime = simulation.getHistoryTime();
  this.cityStatus = simulation.getCityStatus();
  this.neighbours = simulation.neighbours.describe();

  // The figures of the heads-up display, as the state gave them (at first, as the game shows a city it opens)
  this._hud = {cityClass: simulation.evaluation.cityClass, population: simulation.evaluation.cityPop,
               score: simulation.evaluation.cityScore};

  // How the city is doing on its scenario: at first, as the save says, then as the server says (see the state)
  this.scenarioProgress = simulation.getScenarioProgress();

  var self = this;
  simulation.getHistoryTime = function() {
    return self.historyTime;
  };
  simulation.getCityStatus = function() {
    return copyOf(self.cityStatus);
  };
  var ownWeather = simulation.getWeather.bind(simulation);
  simulation.getWeather = function() {
    return isObject(self.cityStatus.weather) ? copyOf(self.cityStatus.weather) : ownWeather();
  };
  simulation.neighbours.describe = function() {
    return copyOf(self.neighbours);
  };
  simulation.getScenarioProgress = function() {
    return simulation._scenario === null ? null : copyOf(self.scenarioProgress);
  };

  var spriteManager = simulation.spriteManager;
  spriteManager.getSprite = this.sprites.getSprite.bind(this.sprites);
  spriteManager.getSpriteList = this.sprites.getSpriteList.bind(this.sprites);
  spriteManager.getSpritesInView = this.sprites.getSpritesInView.bind(this.sprites);
}


var checkWelcome = function(welcome) {
  if (!isObject(welcome) || !isObject(welcome.save) || !Array.isArray(welcome.save.map) ||
      welcome.save.map.length !== WIDTH * HEIGHT)
    throw new Error('Not the welcome of a shared city');
};


// The copy of the city a welcome message describes. The map and the simulation come from its save, read as a save is
// read by the game (inert: it neither scans the map nor makes sprites), then the state, the stats, the maps and the
// sprites are applied. now: the time, for the sprites.
RemoteCity.fromWelcome = function(welcome, now) {
  checkWelcome(welcome);

  // The census keeps the save's histories: the save must be the copy's own
  var save = copyOf(welcome.save);
  var map = new GameMap(WIDTH, HEIGHT);
  var simulation = new Simulation(map, save._gameLevel || Simulation.LEVEL_EASY, Simulation.SPEED_MED, save,
                                  {inert: true});

  var city = new RemoteCity(map, simulation);
  city._applyParts(welcome, now);
  return city;
};


// A new welcome for the same city (after reconnecting): every tile, every road class and the map's figures from its
// save, then the state, the stats and the maps, and new sprites. The objects stay the same.
RemoteCity.prototype.applyWelcome = function(welcome, now) {
  checkWelcome(welcome);

  var save = welcome.save;
  var map = this.map;
  save.map.forEach(function(tile, index) {
    if (isObject(tile))
      this._setTile(index, tile.value);
  }, this);

  var roadClass = save.roadClass;
  for (var i = 0, l = WIDTH * HEIGHT; i < l; i++)
    this._setRoadClass(i, typeof(roadClass) === 'string' && roadClass.length === l ? roadClass.charCodeAt(i) - 48 : 0);

  ['cityCentreX', 'pollutionMaxX'].forEach(function(key) {
    if (Number.isInteger(save[key]) && save[key] >= 0 && save[key] < WIDTH)
      map[key] = save[key];
  });
  ['cityCentreY', 'pollutionMaxY'].forEach(function(key) {
    if (Number.isInteger(save[key]) && save[key] >= 0 && save[key] < HEIGHT)
      map[key] = save[key];
  });

  this._applyParts(welcome, now);
};


RemoteCity.prototype._applyParts = function(welcome, now) {
  this.applyState(welcome.state);
  this.applyStats(welcome.stats);
  this.applyMaps(welcome.maps);
  this.sprites.reset(welcome.sprites, now);
};


var isIndex = function(index) {
  return Number.isInteger(index) && index >= 0 && index < WIDTH * HEIGHT;
};


// Sets a tile's number and flags, the flags included even when there are none (unlike GameMap.setTileValue, which
// would keep the flags the tile had)
RemoteCity.prototype._setTile = function(index, raw) {
  if (!isIndex(index) || !isRawValue(raw))
    return false;

  this.map.getTile(index % WIDTH, Math.floor(index / WIDTH)).set(raw & BIT_MASK, raw & ALLBITS);
  return true;
};


RemoteCity.prototype._setRoadClass = function(index, roadClass) {
  if (!isIndex(index) || !Number.isInteger(roadClass) || roadClass < 0 || roadClass > GameMap.ROAD_HIGHWAY)
    return false;

  this.map.setRoadClass(index % WIDTH, Math.floor(index / WIDTH), roadClass);
  return true;
};


// A tiles message: {c: [index, raw value, ...], r: [index, road class, ...]}. Returns how many were applied.
RemoteCity.prototype.applyTiles = function(message) {
  var count = 0;
  if (!isObject(message))
    return count;

  var pairs = function(list, apply) {
    if (!Array.isArray(list))
      return;

    for (var i = 0; i + 1 < list.length; i += 2) {
      if (apply(list[i], list[i + 1]))
        count++;
    }
  };

  pairs(message.c, this._setTile.bind(this));
  pairs(message.r, this._setRoadClass.bind(this));
  return count;
};


// How each figure of the state is applied (value already checked): its field, and the event the game listens to
var STATE = {
  cityTime: {
    valid: function(v) { return Number.isInteger(v) && v >= 0; },
    apply: function(city, v) {
      city.simulation._cityTime = v;
      city.simulation._updateTime();
    }
  },

  // The date follows from the city time
  date: {
    valid: function() { return false; }
  },

  funds: {
    valid: isNumber,
    apply: function(city, v) {
      // Not with setFunds, whose warnings the server sends itself
      city.simulation.budget.totalFunds = v;
      city.simulation._emitEvent(Messages.FUNDS_CHANGED, v);
    }
  },

  population: {
    valid: isNumber,
    apply: function(city, v) {
      city.simulation._cityPopLast = v;
      city._hud.population = v;
      city.simulation._emitEvent(Messages.POPULATION_UPDATED, v);
    }
  },

  cityClass: {
    valid: function(v) { return typeof(v) === 'string'; },
    apply: function(city, v) {
      city.simulation._cityClassLive = v;
      city._hud.cityClass = v;
      city.simulation._emitEvent(Messages.CLASSIFICATION_UPDATED, v);
    }
  },

  score: {
    valid: isNumber,
    apply: function(city, v) {
      city.simulation.evaluation.cityScore = v;
      city._hud.score = v;
      city.simulation._emitEvent(Messages.SCORE_UPDATED, v);
    }
  },

  valves: {
    valid: function(v) { return isObject(v) && isNumber(v.res) && isNumber(v.com) && isNumber(v.ind); },
    apply: function(city, v) {
      var valves = city.simulation._valves;
      valves.resValve = v.res;
      valves.comValve = v.com;
      valves.indValve = v.ind;
      city.simulation._emitEvent(Messages.VALVES_UPDATED, {residential: v.res, commercial: v.com, industrial: v.ind});
    }
  },

  speed: {
    valid: function(v) {
      return v === Simulation.SPEED_SLOW || v === Simulation.SPEED_MED || v === Simulation.SPEED_FAST;
    },
    apply: function(city, v) { city.speed = v; }
  },

  paused: {
    valid: isBoolean,
    apply: function(city, v) { city.paused = v; }
  },

  autoBudget: {
    valid: isBoolean,
    apply: function(city, v) { city.simulation.budget.autoBudget = v; }
  },

  autoBulldoze: {
    valid: isBoolean,
    apply: function(city, v) {
      // The game's tools follow the city's setting (their preview, and the settings window)
      city.autoBulldoze = v;
      BaseTool.setAutoBulldoze(v);
    }
  },

  disasters: {
    valid: isBoolean,
    apply: function(city, v) { city.simulation.disasterManager.disastersEnabled = v; }
  },

  level: {
    valid: function(v) {
      return v === Simulation.LEVEL_EASY || v === Simulation.LEVEL_MED || v === Simulation.LEVEL_HARD;
    },
    apply: function(city, v) { city.simulation.changeLevel(v); }
  },

  // The scenario the city plays (null in free play). Its time being up, as the server sees it, ends it here too.
  scenario: {
    valid: function(v) {
      return v === null ||
             (isObject(v) && typeof(v.id) === 'string' && Scenarios.get(v.id) !== null &&
              Number.isInteger(v.scoreWait) && v.scoreWait >= 0 && isBoolean(v.ended) && isBoolean(v.won) &&
              isNumber(v.value) && isNumber(v.target) && isBoolean(v.met));
    },
    apply: function(city, v) {
      var simulation = city.simulation;
      var running = simulation._scenario !== null && simulation._scenario.ended !== true;
      if (v === null) {
        simulation._scenario = null;
        city.scenarioProgress = null;
        return;
      }

      var definition = Scenarios.get(v.id);
      simulation._scenario = {id: definition.id, goal: definition.goal, scoreWait: v.scoreWait, ended: v.ended,
                              won: v.won};
      city.scenarioProgress = {value: v.value, target: v.target, met: v.met};
      if (running && v.ended)
        simulation._emitEvent(Messages.SCENARIO_ENDED, {id: definition.id, won: v.won});
    }
  }
};


// A state message: the figures that changed (all of them in a welcome). Returns the names of those applied.
RemoteCity.prototype.applyState = function(state) {
  var applied = [];
  if (!isObject(state))
    return applied;

  STATE_KEYS.forEach(function(key) {
    if (isOwn(state, key) && STATE[key].valid(state[key])) {
      STATE[key].apply(this, state[key]);
      applied.push(key);
    }
  }, this);

  // A paused city's simulation is at speed 0, as in a city played alone
  if (applied.indexOf('speed') !== -1 || applied.indexOf('paused') !== -1)
    this.simulation.setSpeed(this.paused ? Simulation.SPEED_PAUSED : this.speed);

  return applied;
};


var copyNumbers = function(target, source, fields) {
  fields.forEach(function(field) {
    if (isOwn(source, field) && isNumber(source[field]))
      target[field] = source[field];
  });
};


var isHistory = function(values) {
  return Array.isArray(values) && values.length === HISTORY_LENGTH && values.every(isNumber);
};


var copyEvaluation = function(evaluation, source) {
  EVALUATION_FIELDS.forEach(function(field) {
    var value = source[field];
    if (isOwn(source, field) && (field === 'cityClass' ? typeof(value) === 'string' : isNumber(value)))
      evaluation[field] = value;
  });

  if (Array.isArray(source.problemVotes) && source.problemVotes.every(function(vote) {
        return isObject(vote) && Number.isInteger(vote.index) && isNumber(vote.voteCount);
      })) {
    evaluation.problemVotes = source.problemVotes.map(function(vote) {
      return {index: vote.index, voteCount: vote.voteCount};
    });
  }

  if (Array.isArray(source.problemOrder) && source.problemOrder.every(function(problem) {
        return problem === null || Number.isInteger(problem);
      }))
    evaluation.problemOrder = source.problemOrder.slice();
};


// A stats message: {evaluation, budget, census, historyTime, cityStatus, neighbours}, each part optional
RemoteCity.prototype.applyStats = function(stats) {
  if (!isObject(stats))
    return;

  var simulation = this.simulation;
  if (isObject(stats.evaluation))
    copyEvaluation(simulation.evaluation, stats.evaluation);

  if (isObject(stats.budget))
    copyNumbers(simulation.budget, stats.budget, BUDGET_FIELDS);

  if (isObject(stats.census)) {
    var census = simulation.getCensus();
    copyNumbers(census, stats.census, CENSUS_FIELDS);
    HISTORY_FIELDS.forEach(function(field) {
      if (isOwn(stats.census, field) && isHistory(stats.census[field]))
        census[field] = stats.census[field].slice();
    });
  }

  if (isNumber(stats.historyTime))
    this.historyTime = stats.historyTime;

  if (isObject(stats.cityStatus))
    this.cityStatus = stats.cityStatus;

  if (Array.isArray(stats.neighbours))
    this.neighbours = stats.neighbours;
};


// A maps message: {name: values, ...}, each map's values row by row
RemoteCity.prototype.applyMaps = function(maps) {
  if (!isObject(maps))
    return;

  MAP_NAMES.forEach(function(name) {
    var values = maps[name];
    var blockMap = this.simulation.blockMaps[name];
    if (!isOwn(maps, name) || !Array.isArray(values) || values.length !== blockMap.width * blockMap.height)
      return;

    for (var y = 0; y < blockMap.height; y++) {
      for (var x = 0; x < blockMap.width; x++) {
        var value = values[y * blockMap.width + x];
        if (isNumber(value))
          blockMap.set(x, y, value);
      }
    }
  }, this);
};


// A sprites message: [[id, type, frame, x, y], ...] (see RemoteSprites.receive)
RemoteCity.prototype.applySprites = function(samples, now) {
  this.sprites.receive(samples, now);
};


// What the heads-up display shows (see InfoBar: its initial values), as the state gave it: the evaluation itself
// holds the figures of the last yearly evaluation
RemoteCity.prototype.infoBarValues = function() {
  return {
    classification: this._hud.cityClass,
    population: this._hud.population,
    score: this._hud.score,
    funds: this.simulation.budget.totalFunds,
    date: this.simulation.getDate()
  };
};


// The tiles the power reaches, as far as the tiles tell (the server keeps the power grid, see the minimap's power
// overlay): the conductive tiles (CONDBIT) joined, through other conductive tiles, to a powered one (POWERBIT: the
// power plants, and the zones the power reached). A Uint8Array of the map's tiles, row by row: 1 where the power is.
RemoteCity.prototype.poweredTiles = function() {
  var count = WIDTH * HEIGHT;
  var powered = new Uint8Array(count);
  var conductive = new Uint8Array(count);
  var queue = new Int32Array(count);
  var head = 0;
  var tail = 0;

  for (var i = 0; i < count; i++) {
    var raw = this.map.getTile(i % WIDTH, Math.floor(i / WIDTH)).getRawValue();
    if (!(raw & CONDBIT))
      continue;

    conductive[i] = 1;
    if (raw & POWERBIT) {
      powered[i] = 1;
      queue[tail++] = i;
    }
  }

  var reach = function(j) {
    if (conductive[j] && !powered[j]) {
      powered[j] = 1;
      queue[tail++] = j;
    }
  };

  while (head < tail) {
    var index = queue[head++];
    var x = index % WIDTH;
    if (x > 0)
      reach(index - 1);
    if (x < WIDTH - 1)
      reach(index + 1);
    if (index >= WIDTH)
      reach(index - WIDTH);
    if (index < count - WIDTH)
      reach(index + WIDTH);
  }

  return powered;
};


// Moves the sprites to where they are drawn now (each frame)
RemoteCity.prototype.animate = function(now) {
  this.sprites.animate(now);
};


// A message of the city ({subject, data}), as the game's own city would give it: a sprite named by data.spriteId is
// in data.sprite (see RemoteSprites.track). null for something that is not a message.
RemoteCity.prototype.resolveMessage = function(message, now) {
  if (!isObject(message) || typeof(message.subject) !== 'string')
    return null;

  var resolved = {subject: message.subject};
  if (isObject(message.data)) {
    var data = {};
    Object.keys(message.data).forEach(function(key) {
      if (key !== 'sprite')
        data[key] = message.data[key];
    });

    if (Number.isInteger(data.spriteId) && data.spriteId > 0) {
      var type = isOwn(SPRITE_OF_SUBJECT, message.subject) ? SPRITE_OF_SUBJECT[message.subject] : 0;
      data.sprite = this.sprites.track(data.spriteId, data.x, data.y, type, now);
    }

    resolved.data = data;
  }

  return resolved;
};


// The tables the server's messages follow (the server makes them with the same tables)
RemoteCity.WIDTH = WIDTH;
RemoteCity.HEIGHT = HEIGHT;
RemoteCity.MAP_NAMES = MAP_NAMES;
RemoteCity.EVALUATION_FIELDS = EVALUATION_FIELDS;
RemoteCity.BUDGET_FIELDS = BUDGET_FIELDS;
RemoteCity.CENSUS_FIELDS = CENSUS_FIELDS;
RemoteCity.HISTORY_FIELDS = HISTORY_FIELDS;
RemoteCity.HISTORY_LENGTH = HISTORY_LENGTH;
RemoteCity.STATE_KEYS = STATE_KEYS;

RemoteSprites.DELAY = SPRITE_DELAY;
RemoteSprites.SNAP_DISTANCE = SNAP_DISTANCE;
RemoteSprites.PENDING_LIFETIME = PENDING_LIFETIME;
RemoteSprites.SIZES = SPRITE_SIZES;


export { RemoteCity, RemoteSprite, RemoteSprites };
