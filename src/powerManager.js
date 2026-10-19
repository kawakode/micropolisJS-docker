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

import { BlockMap } from './blockMap.ts';
import { forEachCardinalDirection } from './direction.ts';
import { EventEmitter } from './eventEmitter.js';
import { Position } from './position.ts';
import { NOT_ENOUGH_POWER } from './messages.ts';
import { Random } from './random.ts';
import { ANIMBIT, BURNBIT, CONDBIT, POWERBIT } from "./tileFlags.ts";
import { DAM, GASPLANT, NUCLEAR, POWERPLANT, SOLARPLANT, WINDTURBINE } from "./tileValues.ts";

var COAL_POWER_STRENGTH = 700;
var NUCLEAR_POWER_STRENGTH = 2000;
// KawaCity's power plants: cleaner, but smaller
var GAS_POWER_STRENGTH = 500;
var SOLAR_POWER_STRENGTH = 400;
var WIND_POWER_STRENGTH = 50;
// A dam gives as much whatever the weather
var HYDRO_POWER_STRENGTH = 600;

// The tiles that produce power
var isPowerSource = function(tileValue) {
  return tileValue === NUCLEAR || tileValue === POWERPLANT || tileValue === GASPLANT || tileValue === SOLARPLANT ||
         tileValue === WINDTURBINE || tileValue === DAM;
};


var PowerManager = EventEmitter(function(map) {
  this._map = map;
  this._powerStack = [];
  this.powerGridMap = new BlockMap(this._map.width, this._map.height, 1);

  // The power left over at the last scan
  this.spare = 0;
});


PowerManager.prototype.setTilePower = function(x, y) {
  var tile = this._map.getTile(x, y);
  var tileValue = tile.getValue();

  if (isPowerSource(tileValue) || this.powerGridMap.worldGet(x, y) > 0) {
    tile.addFlags(POWERBIT);
    return;
  }

  tile.removeFlags(POWERBIT);
};


PowerManager.prototype.clearPowerStack = function() {
  this._powerStackPointer = 0;
  this._powerStack = [];
};


PowerManager.prototype.testForConductive = function(pos, testDir) {
  var movedPos = Position.move(pos, testDir);

  if (this._map.isPositionInBounds(movedPos)) {
    if (this._map.getTile(movedPos.x, movedPos.y).isConductive()) {
      if (this.powerGridMap.worldGet(movedPos.x, movedPos.y) === 0)
          return true;
    }
  }

  return false;
};


// Note: the algorithm is buggy: if you have two adjacent power
// plants, the second will be regarded as drawing power from the first
// rather than as a power source itself
//
// KawaCity: supply is the power bought from the neighbouring cities, {capacity, sources} (see Neighbours), if any: it
// enters the grid by the power lines at their edges of the map. The power left over is noted in spare. The weather
// (see Weather), if given, says how much the solar farms and the wind turbines give.
PowerManager.prototype.doPowerScan = function(census, supply, weather) {
  // Clear power this._map.
  this.powerGridMap.clear();

  // Power that the combined coal and nuclear power plants can deliver.
  var maxPower = census.coalPowerPop * COAL_POWER_STRENGTH +
                 census.nuclearPowerPop * NUCLEAR_POWER_STRENGTH +
                 census.gasPowerPop * GAS_POWER_STRENGTH +
                 census.solarPowerPop * Math.round(SOLAR_POWER_STRENGTH * (weather ? weather.solarFactor() : 1)) +
                 census.windPowerPop * Math.round(WIND_POWER_STRENGTH * (weather ? weather.windFactor() : 1)) +
                 (census.hydroPowerPop || 0) * HYDRO_POWER_STRENGTH;

  if (supply) {
    maxPower += supply.capacity;
    supply.sources.forEach(pos => this._powerStack.push(new Position(pos.x, pos.y)));
  }

  var powerConsumption = 0; // Amount of power used.
  this.spare = 0;

  while (this._powerStack.length > 0) {
    var pos = this._powerStack.pop();
    var anyDir = undefined;
    var conNum;
    do {
      powerConsumption++;
      if (powerConsumption > maxPower) {
        this._emitEvent(NOT_ENOUGH_POWER);
        return;
      }

      if (anyDir)
        pos = Position.move(pos, anyDir);

      this.powerGridMap.worldSet(pos.x, pos.y, 1);
      conNum = 0;

      forEachCardinalDirection(dir => {
        if (conNum >= 2) {
          return;
        }

        if (this.testForConductive(pos, dir)) {
          conNum++;
          anyDir = dir;
        }
      });

      if (conNum > 1)
        this._powerStack.push(new Position(pos.x, pos.y));
    } while (conNum);
  }

  this.spare = maxPower - powerConsumption;
};


PowerManager.prototype.coalPowerFound = function(map, x, y, simData) {
  simData.census.coalPowerPop += 1;

  this._powerStack.push(new Position(x, y));

  // Ensure animation runs
  var dX = [-1, 2, 1, 2];
  var dY = [-1, -1, 0, 0];

  for (var i = 0; i < 4; i++)
    map.addTileFlags(x + dX[i], y + dY[i], ANIMBIT);
};


var dX = [1, 2, 1, 2];
var dY = [-1, -1, 0, 0];
var meltdownTable = [30000, 20000, 10000];

PowerManager.prototype.nuclearPowerFound = function(map, x, y, simData) {
  // TODO With the auto repair system, zone gets repaired before meltdown
  // In original Micropolis code, we bail and don't repair if melting down
  if (simData.disasterManager.disastersEnabled &&
      Random.getRandom(meltdownTable[simData.gameLevel]) === 0) {
    simData.disasterManager.doMeltdown(x, y);
    return;
  }

  simData.census.nuclearPowerPop += 1;
  this._powerStack.push(new Position(x, y));

  // Ensure animation bits set
  for (var i = 0; i < 4; i++)
    map.addTileFlags(x, y, ANIMBIT | CONDBIT | POWERBIT | BURNBIT);
};


// KawaCity's power plants simply feed the grid
var makePlantHandler = function(counter) {
  return function(map, x, y, simData) {
    simData.census[counter] += 1;
    this._powerStack.push(new Position(x, y));
  };
};

PowerManager.prototype.gasPowerFound = makePlantHandler('gasPowerPop');
PowerManager.prototype.solarPowerFound = makePlantHandler('solarPowerPop');
PowerManager.prototype.windPowerFound = makePlantHandler('windPowerPop');
PowerManager.prototype.hydroPowerFound = makePlantHandler('hydroPowerPop');


PowerManager.prototype.registerHandlers = function(mapScanner, repairManager) {
  mapScanner.addAction(POWERPLANT, this.coalPowerFound.bind(this));
  mapScanner.addAction(NUCLEAR, this.nuclearPowerFound.bind(this));
  mapScanner.addAction(GASPLANT, this.gasPowerFound.bind(this));
  mapScanner.addAction(SOLARPLANT, this.solarPowerFound.bind(this));
  mapScanner.addAction(WINDTURBINE, this.windPowerFound.bind(this));
  mapScanner.addAction(DAM, this.hydroPowerFound.bind(this));
  repairManager.addAction(GASPLANT, 7, 3);
  repairManager.addAction(SOLARPLANT, 7, 3);
  repairManager.addAction(DAM, 7, 3);
  repairManager.addAction(POWERPLANT, 7, 4);
  repairManager.addAction(NUCLEAR, 7, 4);
};


export { PowerManager };
