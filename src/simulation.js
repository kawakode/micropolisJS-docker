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
import { BlockMapUtils } from './blockMapUtils.js';
import { Budget } from './budget.js';
import { Census } from './census.js';
import { Commercial } from './commercial.js';
import { DisasterManager } from './disasterManager.js';
import { EventEmitter } from './eventEmitter.js';
import { EmergencyServices } from './emergencyServices.js';
import { Evaluation } from './evaluation.js';
import { Industrial } from './industrial.js';
import { MapScanner } from './mapScanner.js';
import * as Messages from './messages.ts';
import { MiscTiles } from './miscTiles.js';
import { MiscUtils } from './miscUtils.js';
import { PowerManager } from './powerManager.js';
import { RepairManager } from './repairManager.js';
import { Residential } from './residential.js';
import { Road } from './road.js';
import { SpriteManager } from './spriteManager.js';
import { Stadia } from './stadia.js';
import { Traffic } from './traffic.js';
import { Transport } from './transport.js';
import { Valves } from './valves.js';

var Simulation = EventEmitter(function (gameMap, gameLevel, speed, savedGame) {
  this._map = gameMap;
  this.setLevel(gameLevel);
  this.setSpeed(speed);

  this._phaseCycle = 0;
  this._simCycle = 0;
  this._cityTime = 0;
  this._cityPopLast = 0;
  this._cityClassLive = null;

  // The scenario being played, if any (see Scenarios)
  this._scenario = null;
  this._messageLast = undefined;
  this._startingYear = 1900;

  // Last date sent to front end
  this._cityYearLast = -1;
  this._cityMonthLast = -1;

  // Last time we relayed a message from PowerManager to the front-end
  this._lastPowerMessage = null;

  // And now, the main cast of characters
  this.evaluation = new Evaluation(this._gameLevel);
  this._valves = new Valves();
  this.budget = new Budget();
  this._census = new Census();
  this._powerManager = new PowerManager(this._map);
  this.spriteManager = new SpriteManager(this._map);
  this._mapScanner = new MapScanner(this._map);
  this._repairManager = new RepairManager(this._map);
  this._traffic = new Traffic(this._map, this.spriteManager);
  this.disasterManager = new DisasterManager(this._map, this.spriteManager, this._gameLevel);

  this.blockMaps = {
    // Holds a "distance score" for the block from the city centre, range  -64 to 64
    cityCentreDistScoreMap: new BlockMap(this._map.width, this._map.height, 8),

    // Holds a score representing how dangerous an area is, in range 0-250 (larger is worse)
    crimeRateMap: new BlockMap(this._map.width, this._map.height, 2),

    // A map used to note positions of fire stations during the map scan, range 0-1000
    fireStationMap: new BlockMap(this._map.width, this._map.height, 8),

    // Holds a value containing a score representing the effect of fire cover in this neighborhood, range 0-1000
    fireStationEffectMap: new BlockMap(this._map.width, this._map.height, 8),

    // Holds scores representing the land value in the range 0-250
    landValueMap: new BlockMap(this._map.width, this._map.height, 2),

    // A map used to note positions of police stations during the map scan, range 0-1000
    policeStationMap: new BlockMap(this._map.width, this._map.height, 8),

    // Holds a value containing a score representing how much crime is dampened in this block, range 0-1000
    policeStationEffectMap: new BlockMap(this._map.width, this._map.height, 8),

    // Holds a value representing the amount of pollution in a neighbourhood, in the range 0-255
    pollutionDensityMap: new BlockMap(this._map.width, this._map.height, 2),

    // Holds a value representing population density of a block, in the range 0-510
    populationDensityMap: new BlockMap(this._map.width, this._map.height, 2),

    // Holds a value representing the rate of growth of a neighbourhood in the range -200 to +200
    rateOfGrowthMap: new BlockMap(this._map.width, this._map.height, 8),

    // Scores a block on how undeveloped/unspoilt it is, range 0-240
    terrainDensityMap: new BlockMap(this._map.width, this._map.height, 4),

    // Scores the volume of traffic in this cluster, range 0-240
    trafficDensityMap: new BlockMap(this._map.width, this._map.height, 2),

    // Temporary maps
    tempMap1: new BlockMap(this._map.width, this._map.height, 2),
    tempMap2: new BlockMap(this._map.width, this._map.height, 2),
    tempMap3: new BlockMap(this._map.width, this._map.height, 4)
  };

  this._clearCensus();

  if (savedGame) {
    this.load(savedGame);
  } else {
    // As in the original game, harder levels start with less money
    this.budget.setFunds([20000, 10000, 5000][this._gameLevel] || 20000);
    this._census.totalPop = 1;
  }

  this.init();
});


Simulation.prototype.setLevel = function(l) {
  if (l !== Simulation.LEVEL_EASY &&
      l !== Simulation.LEVEL_MED &&
      l !== Simulation.LEVEL_HARD)
    throw new Error('Invalid level!');

  this._gameLevel = l;
};


Simulation.prototype.setSpeed = function(s) {
  if (s !== Simulation.SPEED_PAUSED &&
      s !== Simulation.SPEED_SLOW &&
      s !== Simulation.SPEED_MED &&
      s !== Simulation.SPEED_FAST)
    throw new Error('Invalid speed!');

  this._speed = s;
};


Simulation.prototype.isPaused = function() {
  return this._speed === Simulation.SPEED_PAUSED;
};


var saveProps = ['_cityTime', '_speed', '_gameLevel'];

Simulation.prototype.save = function(saveData) {
  for (var i = 0, l = saveProps.length; i < l; i++)
    saveData[saveProps[i]] = this[saveProps[i]];

  saveData.scenario = this._scenario ? Object.assign({}, this._scenario) : null;

  this._map.save(saveData);
  this.evaluation.save(saveData);
  this._valves.save(saveData);
  this.budget.save(saveData);
  this._census.save(saveData);
};


Simulation.prototype.load = function(saveData) {
  for (var i = 0, l = saveProps.length; i < l; i++)
    this[saveProps[i]] = saveData[saveProps[i]];

  this._scenario = saveData.scenario ? Object.assign({}, saveData.scenario) : null;

  this._map.load(saveData);
  this.evaluation.load(saveData);
  this._valves.load(saveData);
  this.budget.load(saveData);
  this._census.load(saveData);
};


Simulation.prototype.simTick = function() {
  this._simFrame();
  this._updateTime();
  // TODO Graphs
};


// The minimum number of milliseconds between simulation steps at the current speed
Simulation.prototype.getStepInterval = function() {
  switch (this._speed) {
    case Simulation.SPEED_MED:
      return 50;

    case Simulation.SPEED_FAST:
      return 10;

    default:
      return 100;
  }
};


// How long until the next simulation step is due, in milliseconds
Simulation.prototype.timeUntilNextStep = function() {
  return Math.max(0, this.getStepInterval() - (new Date() - this._lastTickTime));
};


Simulation.prototype._simFrame = function() {
  if (this.budget.awaitingValues || this._speed === Simulation.SPEED_PAUSED)
    return;

  var d = new Date();
  if (d - this._lastTickTime < this.getStepInterval())
    return;

  var simData = this._constructSimData();
  this._simulate(simData);
  this._lastTickTime = new Date();
};


Simulation.prototype._clearCensus = function() {
  this._census.clearCensus();
  this._powerManager.clearPowerStack();
  this.blockMaps.fireStationMap.clear();
  this.blockMaps.policeStationMap.clear();
};


Simulation.prototype._constructSimData = function() {
  return {
    blockMaps: this.blockMaps,
    budget: this.budget,
    census: this._census,
    cityTime: this._cityTime,
    disasterManager: this.disasterManager,
    gameLevel: this._gameLevel,
    repairManager: this._repairManager,
    powerManager: this._powerManager,
    simulator: this,
    spriteManager: this.spriteManager,
    trafficManager: this._traffic,
    valves: this._valves
  };
};


Simulation.prototype.init = function() {
  this._lastTickTime = -1;

  // Add various listeners that we will in turn transmit upwards
  var evaluationEvents = ['CLASSIFICATION_UPDATED', 'POPULATION_UPDATED', 'SCORE_UPDATED'].map(function(m) {
    return Messages[m];
  });
  for (var i = 0, l = evaluationEvents.length; i < l; i++)
    this.evaluation.addEventListener(evaluationEvents[i], MiscUtils.reflectEvent.bind(this, evaluationEvents[i]));

  this._powerManager.addEventListener(Messages.NOT_ENOUGH_POWER, function(e) {
    var d = new Date();

    if (this._lastPowerMessage === null || d - this._lastPowerMessage > 1000 * 60 * 2) {
      this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.NOT_ENOUGH_POWER});
      this._lastPowerMessage = d;
    }
  }.bind(this));

  this.budget.addEventListener(Messages.FUNDS_CHANGED, MiscUtils.reflectEvent.bind(this, Messages.FUNDS_CHANGED));
  this.budget.addEventListener(Messages.BUDGET_NEEDED, MiscUtils.reflectEvent.bind(this, Messages.BUDGET_NEEDED));
  this.budget.addEventListener(Messages.NO_MONEY, this._wrapMessage.bind(this, Messages.NO_MONEY));

  this._valves.addEventListener(Messages.VALVES_UPDATED, this._onValveChange.bind(this));

  for (i = 0, l = Messages.DISASTER_MESSAGES.length; i < l; i++) {
    this.spriteManager.addEventListener(Messages.DISASTER_MESSAGES[i], this._wrapMessage.bind(this, Messages.DISASTER_MESSAGES[i]));
    this.disasterManager.addEventListener(Messages.DISASTER_MESSAGES[i], this._wrapMessage.bind(this, Messages.DISASTER_MESSAGES[i]));
  }
  for (i = 0, l = Messages.CRASHES.length; i < l; i++)
    this.spriteManager.addEventListener(Messages.CRASHES[i], this._wrapMessage.bind(this, Messages.CRASHES[i]));

  this.spriteManager.addEventListener(Messages.HEAVY_TRAFFIC, this._wrapMessage.bind(this, Messages.HEAVY_TRAFFIC));

  // Register actions
  Commercial.registerHandlers(this._mapScanner, this._repairManager);
  EmergencyServices.registerHandlers(this._mapScanner, this._repairManager);
  Industrial.registerHandlers(this._mapScanner, this._repairManager);
  MiscTiles.registerHandlers(this._mapScanner, this._repairManager);
  this._powerManager.registerHandlers(this._mapScanner, this._repairManager);
  Road.registerHandlers(this._mapScanner, this._repairManager);
  Residential.registerHandlers(this._mapScanner, this._repairManager);
  Stadia.registerHandlers(this._mapScanner, this._repairManager);
  Transport.registerHandlers(this._mapScanner, this._repairManager);

  // As in the original game, the first scan starts from an empty census (a saved game holds the last counts) and
  // assumes everything is powered until the first power scan
  this._clearCensus();
  this._powerManager.powerGridMap.fill(1);

  var simData = this._constructSimData();
  this._mapScanner.mapScan(0, this._map.width, simData);
  this._powerManager.doPowerScan(this._census);
  BlockMapUtils.pollutionTerrainLandValueScan(this._map, this._census, this.blockMaps);
  BlockMapUtils.crimeScan(this._census, this.blockMaps);
  BlockMapUtils.populationDensityScan(this._map, this.blockMaps);
  BlockMapUtils.fireAnalysis(this.blockMaps);
};


var speedPowerScan = [2, 4, 5];
var speedPollutionTerrainLandValueScan = [2, 7, 17];
var speedCrimeScan = [1, 8, 18];
var speedPopulationDensityScan = [1, 9,19];
var speedFireAnalysis = [1, 10, 20];
var CENSUS_FREQUENCY_10 = 4;
// The 120 year history has a sample a year (the original took one every 10 months)
var CENSUS_FREQUENCY_120 = CENSUS_FREQUENCY_10 * 12;
var TAX_FREQUENCY = 48;


var simulate = function(simData) {
  this._phaseCycle &= 15;
  var speedIndex = this._speed - 1;

  switch (this._phaseCycle)  {
    case 0:
      if (++this._simCycle > 1023)
          this._simCycle = 0;

      this._cityTime++;

      if ((this._simCycle & 1) === 0)
        this._valves.setValves(this._gameLevel, this._census, this.budget);

      this._clearCensus();
      break;

    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
    case 7:
    case 8:
      this._mapScanner.mapScan((this._phaseCycle - 1) * this._map.width / 8,
                                this._phaseCycle * this._map.width / 8, simData);
      break;

    case 9:
      if (this._cityTime % CENSUS_FREQUENCY_10 === 0)
        this._census.take10Census(this.budget);

      if (this._cityTime % CENSUS_FREQUENCY_120 === 0)
        this._census.take120Census(this.budget);

      if (this._cityTime % TAX_FREQUENCY === 0)  {
        this.budget.collectTax(this._gameLevel, this._census);
        this.evaluation.cityEvaluation(simData);
      }

      break;

    case 10:
      if ((this._simCycle % 5) === 0)
        BlockMapUtils.neutraliseRateOfGrowthMap(simData.blockMaps);

      BlockMapUtils.neutraliseTrafficMap(this.blockMaps);
      this._sendMessages();
      break;

    case 11:
      if ((this._simCycle % speedPowerScan[speedIndex]) === 0)
        this._powerManager.doPowerScan(this._census);
      break;

    case 12:
      if ((this._simCycle % speedPollutionTerrainLandValueScan[speedIndex]) === 0)
        BlockMapUtils.pollutionTerrainLandValueScan(this._map, this._census, this.blockMaps);
      break;

    case 13:
      if ((this._simCycle % speedCrimeScan[speedIndex]) === 0)
        BlockMapUtils.crimeScan(this._census, this.blockMaps);
      break;

    case 14:
      if ((this._simCycle % speedPopulationDensityScan[speedIndex]) === 0)
        BlockMapUtils.populationDensityScan(this._map, this.blockMaps);
      break;

    case 15:
      if ((this._simCycle % speedFireAnalysis[speedIndex]) === 0)
        BlockMapUtils.fireAnalysis(this.blockMaps);

      // A scenario's disasters strike whether or not disasters are enabled
      this._scenarioDisaster();
      this.disasterManager.doDisasters(this._census);
      break;
  }

  // Go on the the next phase.
  this._phaseCycle = (this._phaseCycle + 1) & 15;
};


Simulation.prototype._simulate = function(simData) {
  // This is actually a wrapper function that will only be called once, to perform the initial
  // evaluation. Once that has completed, it will supplant itself with the standard "simulate"
  // procedure defined above
  this.evaluation.cityEvaluation(simData);
  this._simulate = simulate;
  this._simulate(simData);
};


Simulation.prototype._wrapMessage = function(message, data) {
  this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: message, data: data});
};


Simulation.prototype._sendMessages = function() {
  // When a scenario's time is up, the city is judged
  var scenario = this._scenario;
  if (scenario && scenario.scoreWait > 0) {
    scenario.scoreWait--;
    if (scenario.scoreWait === 0)
      this._scenarioScore();
  }

  this._checkGrowth();

  var totalZonePop = this._census.resZonePop + this._census.comZonePop +
                     this._census.indZonePop;
  var powerPop = this._census.nuclearPowerPop + this._census.coalPowerPop;

  switch (this._cityTime & 63) {
    case 1:
      if (Math.floor(totalZonePop / 4) >= this._census.resZonePop)
        this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.NEED_MORE_RESIDENTIAL});
      break;

    case 5:
      if (Math.floor(totalZonePop / 8) >= this._census.comZonePop)
        this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.NEED_MORE_COMMERCIAL});
      break;

    case 10:
      if (Math.floor(totalZonePop / 8) >= this._census.indZonePop)
        this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.NEED_MORE_INDUSTRIAL});
      break;

    case 14:
      if (totalZonePop > 10 && totalZonePop * 2 > this._census.roadTotal)
        this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.NEED_MORE_ROADS});
      break;

    case 18:
      if (totalZonePop > 50 && totalZonePop > this._census.railTotal)
        this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.NEED_MORE_RAILS});
      break;

    case 22:
      if (totalZonePop > 10 && powerPop === 0)
        this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.NEED_ELECTRICITY});
      break;

    case 26:
      if (this._census.resPop > 500 && this._census.stadiumPop === 0) {
        this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.NEED_STADIUM});
        this._valves.resCap = true;
      } else {
        this._valves.resCap = false;
      }
      break;

    case 28:
      if (this._census.indPop > 70 && this._census.seaportPop === 0) {
          this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.NEED_SEAPORT});
        this._valves.indCap = true;
      } else {
        this._valves.indCap = false;
      }
      break;

    case 30:
      if (this._census.comPop > 100 && this._census.airportPop === 0) {
          this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.NEED_AIRPORT});
        this._valves.comCap = true;
      } else {
        this._valves.comCap = false;
      }
      break;

    case 32:
      var zoneCount = this._census.unpoweredZoneCount + this._census.poweredZoneCount;
      if (zoneCount > 0) {
        if (this._census.poweredZoneCount / zoneCount < 0.7 && powerPop > 0) {
          var d = new Date();
          // Not more than once a minute
          if (!this._lastBlackoutMessage || d - this._lastBlackoutMessage > 1000 * 60) {
            this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.BLACKOUTS_REPORTED});
            this._lastBlackoutMessage = d;
          }
        }
      }
      break;

    case 35:
      if (this._census.pollutionAverage > 60)
        this._emitEvent(Messages.FRONT_END_MESSAGE,
                       {subject: Messages.HIGH_POLLUTION, data: {x: this._map.pollutionMaxX, y: this._map.pollutionMaxY}});
      break;

    case 42:
      if (this._census.crimeAverage > 100)
        this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.HIGH_CRIME});
      break;

    case 45:
      if (this._census.totalPop > 60 && this._census.fireStationPop === 0)
        this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.NEED_FIRE_STATION});
      break;

    case 48:
      if (this._census.totalPop > 60 && this._census.policeStationPop === 0)
        this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.NEED_POLICE_STATION});
      break;

    case 51:
      if (this.budget.cityTax > 12)
        this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.TAX_TOO_HIGH});
      break;

    case 54:
      if (this.budget.roadEffect < Math.floor(5 * this.budget.MAX_ROAD_EFFECT / 8) && this._census.roadTotal > 30)
        this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.ROAD_NEEDS_FUNDING});
      break;

    case 57:
      if (this.budget.fireEffect < Math.floor(7 * this.budget.MAX_FIRE_STATION_EFFECT / 10) && this._census.totalPop > 20)
        this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.FIRE_STATION_NEEDS_FUNDING});
      break;

    case 60:
      if (this.budget.policeEffect < Math.floor(7 * this.budget.MAX_POLICE_STATION_EFFECT / 10) && this._census.totalPop > 20)
        this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.POLICE_NEEDS_FUNDING});
      break;

  case 63:
    if (this._census.trafficAverage > 60)
      this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: Messages.TRAFFIC_JAMS});
    break;
  }
};


Simulation.prototype._checkGrowth = function() {
  if ((this._cityTime & 3) !== 0)
    return;

  var message = '';
  var cityPop = this.evaluation.computePopulation(this._census);

  // The heads-up display follows the population month by month, the evaluation only once a year
  if (cityPop !== this._cityPopLast) {
    this._emitEvent(Messages.POPULATION_UPDATED, cityPop);
    var cityClass = this.evaluation.classify(cityPop);
    if (cityClass !== this._cityClassLive) {
      this._cityClassLive = cityClass;
      this._emitEvent(Messages.CLASSIFICATION_UPDATED, cityClass);
    }
  }

  // No message for the first count after the city was founded or loaded
  if (this._cityPopLast > 0 && cityPop !== this._cityPopLast) {
    var lastClass = this.evaluation.classify(this._cityPopLast);
    var newClass = this.evaluation.classify(cityPop);

    if (lastClass !== newClass) {
      switch (newClass) {
        case Evaluation.CC_VILLAGE:
          // Don't mention it.
          break;

        case Evaluation.CC_TOWN:
          message = Messages.REACHED_TOWN;
          break;

        case Evaluation.CC_CITY:
          message = Messages.REACHED_CITY;
          break;

        case Evaluation.CC_CAPITAL:
          message = Messages.REACHED_CAPITAL;
            break;

        case Evaluation.CC_METROPOLIS:
          message = Messages.REACHED_METROPOLIS;
          break;

        case Evaluation.CC_MEGALOPOLIS:
          message = Messages.REACHED_MEGALOPOLIS;
          break;

        default:
          break;
      }
    }
  }

  if (message !== '' && message !== this._messageLast) {
    this._emitEvent(Messages.FRONT_END_MESSAGE, {subject: message});
    this._messageLast = message;
  }

  this._cityPopLast = cityPop;
};


Simulation.prototype._onValveChange  = function() {
  this._resLast = this._valves.resValve;
  this._comLast = this._valves.comValve;
  this._indLast = this._valves.indValve;

  this._emitEvent(Messages.VALVES_UPDATED, {residential: this._valves.resValve,
                                            commercial: this._valves.comValve,
                                            industrial: this._valves.indValve});
};


// Lets the disasters of the scenario strike, as in the original game: the countdown is tested, then decremented
Simulation.prototype._scenarioDisaster = function() {
  var scenario = this._scenario;
  if (!scenario || !scenario.disaster)
    return;

  var wait = scenario.disasterWait;
  switch (scenario.disaster) {
    case 'earthquake':
      if (wait === 1)
        this.disasterManager.makeEarthquake();
      break;

    case 'firebombs':
      if (wait % 10 === 0)
        this.disasterManager.makeFireBombs();
      break;

    case 'monster':
      if (wait === 1)
        this.spriteManager.makeMonster();
      break;

    case 'meltdown':
      if (wait === 1)
        this.disasterManager.makeMeltdown();
      break;

    case 'flood':
      if (wait % 24 === 0)
        this.disasterManager.makeFlood();
      break;
  }

  if (wait > 0)
    scenario.disasterWait--;
  else
    scenario.disaster = null;
};


var CLASS_ORDER = [Evaluation.CC_VILLAGE, Evaluation.CC_TOWN, Evaluation.CC_CITY, Evaluation.CC_CAPITAL,
                   Evaluation.CC_METROPOLIS, Evaluation.CC_MEGALOPOLIS];

// How the city is doing on the scenario's goal: {value, target, met}
Simulation.prototype.getScenarioProgress = function() {
  var scenario = this._scenario;
  if (!scenario)
    return null;

  switch (scenario.goal) {
    case 'metropolis':
      // The population as the player sees it (before the first count, the one the city was saved with)
      var population = this._cityPopLast || this.evaluation.cityPop;
      var cityClass = this.evaluation.classify(population);
      return {value: population, target: 100000,
              met: CLASS_ORDER.indexOf(cityClass) >= CLASS_ORDER.indexOf(Evaluation.CC_METROPOLIS)};

    case 'traffic':
      // Measured as the evaluation does, but up to date
      var traffic = this.evaluation.computeTrafficAverage(this.blockMaps);
      return {value: traffic, target: 80, met: traffic < 80};

    case 'crime':
      return {value: this._census.crimeAverage, target: 60, met: this._census.crimeAverage < 60};

    default:
      return {value: this.evaluation.cityScore, target: 500, met: this.evaluation.cityScore > 500};
  }
};


Simulation.prototype._scenarioScore = function() {
  var progress = this.getScenarioProgress();
  var scenario = this._scenario;
  scenario.ended = true;
  scenario.won = progress.met;

  this._emitEvent(Messages.SCENARIO_ENDED, {id: scenario.id, won: progress.met});
};


// The scenario being played (null in free play): {id, goal, disaster, disasterWait, scoreWait, ended, won}
Simulation.prototype.getScenario = function() {
  return this._scenario;
};


// After a scenario is won, the player may carry on building the city freely
Simulation.prototype.endScenario = function() {
  this._scenario = null;
};


// The population of the city, as of the last monthly count
Simulation.prototype.getPopulation = function() {
  return this._cityPopLast;
};


Simulation.prototype.getCensus = function() {
  return this._census;
};


Simulation.prototype.getCityTime = function() {
  return this._cityTime;
};


Simulation.prototype.getStartingYear = function() {
  return this._startingYear;
};


Simulation.prototype.getDate = function() {
  var year = Math.floor(this._cityTime / 48) + this._startingYear;
  var month = Math.floor(this._cityTime % 48) >> 2;
  return {month: month, year: year};
};


Simulation.prototype._setYear = function(year) {
  if (year < this._startingYear)
    year = this._startingYear;

  year = (year - this._startingYear) - (this._cityTime / 48);
  this._cityTime += year * 48;
  this._updateTime();
};


Simulation.prototype._updateTime = function() {
  var megalinium = 1000000;
  var cityYear = Math.floor(this._cityTime / 48) + this._startingYear;
  var cityMonth = Math.floor(this._cityTime % 48) >> 2;

  if (cityYear >= megalinium) {
    this._setYear(this._startingYear);
    return;
  }

  if (this._cityYearLast !== cityYear || this._cityMonthLast !== cityMonth) {
    this._cityYearLast = cityYear;
    this._cityMonthLast = cityMonth;
    this._emitEvent(Messages.DATE_UPDATED, {month: cityMonth, year: cityYear});
  }
};


Object.defineProperties(Simulation,
  {LEVEL_EASY: MiscUtils.makeConstantDescriptor(0),
  LEVEL_MED:  MiscUtils.makeConstantDescriptor(1),
  LEVEL_HARD: MiscUtils.makeConstantDescriptor(2),
  SPEED_PAUSED: MiscUtils.makeConstantDescriptor(0),
  SPEED_SLOW:  MiscUtils.makeConstantDescriptor(1),
  SPEED_MED: MiscUtils.makeConstantDescriptor(2),
  SPEED_FAST: MiscUtils.makeConstantDescriptor(3),
});


export { Simulation };
