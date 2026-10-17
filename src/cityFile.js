/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { Evaluation } from './evaluation.js';
import { Simulation } from './simulation.js';

// Reads the city files of the original game (.cty, and the scenario files), and turns them into a saved game
//
// A city file holds 16 bit big-endian values: six histories of 240 values (residential, commercial, industrial,
// crime, pollution and cash flow: 120 for the last 10 years, then 120 for the last 120 years), 120 miscellaneous
// values, then the 120x100 map, column by column. The map values use the same layout as ours: a tile number in the
// low 10 bits, and the flags above.

var WIDTH = 120;
var HEIGHT = 100;
var HISTORY_LENGTH = 240;
var MISC_LENGTH = 120;
var FILE_SIZE = (6 * HISTORY_LENGTH + MISC_LENGTH + WIDTH * HEIGHT) * 2;

var HISTORIES = ['res', 'com', 'ind', 'crime', 'pollution', 'money'];
var CLASSES = [Evaluation.CC_VILLAGE, Evaluation.CC_TOWN, Evaluation.CC_CITY, Evaluation.CC_CAPITAL,
               Evaluation.CC_METROPOLIS, Evaluation.CC_MEGALOPOLIS];
var MILESTONES = ['_reachedTown', '_reachedCity', '_reachedCapital', '_reachedMetropolis', '_reachedMegalopolis'];


var isCityFile = function(buffer) {
  return buffer.byteLength === FILE_SIZE;
};


// options: {name, cityTime, funds, gameLevel} override the values held in the file (scenarios set them)
var read = function(buffer, options) {
  options = options || {};

  if (!isCityFile(buffer))
    throw new Error('Not a city file');

  var view = new DataView(buffer);
  var offset = 0;
  var readShort = function() {
    var value = view.getInt16(offset, false);
    offset += 2;
    return value;
  };

  var histories = {};
  HISTORIES.forEach(function(name) {
    var values = [];
    for (var i = 0; i < HISTORY_LENGTH; i++)
      values.push(Math.max(0, readShort()));
    histories[name] = values;
  });

  var misc = [];
  for (var i = 0; i < MISC_LENGTH; i++)
    misc.push(readShort());

  // Long values are stored as two shorts, the high one first
  var readLong = function(index) {
    return ((misc[index] & 0xffff) << 16) | (misc[index + 1] & 0xffff);
  };

  var map = new Array(WIDTH * HEIGHT);
  for (var x = 0; x < WIDTH; x++) {
    for (var y = 0; y < HEIGHT; y++)
      map[y * WIDTH + x] = {value: readShort() & 0xffff};
  }

  var clamp = function(value, min, max, fallback) {
    return (typeof(value) !== 'number' || isNaN(value) || value < min || value > max) ? fallback : value;
  };

  // Some of the original files hold junk in their statistics: only trust them for maps that have been built on
  var built = map.some(function(tile) { return (tile.value & 0x0400) !== 0; });
  if (!built) {
    HISTORIES.forEach(function(name) {
      histories[name] = histories[name].map(function() { return 0; });
    });
    misc = misc.map(function() { return 0; });
  }

  var gameLevel = clamp(options.gameLevel !== undefined ? options.gameLevel : misc[15], 0, 2, Simulation.LEVEL_EASY);
  var cityTime = options.cityTime !== undefined ? options.cityTime : clamp(readLong(8), 0, 2000 * 48, 0);
  var funds = options.funds !== undefined ? options.funds : clamp(readLong(50), 0, 100000000, 20000);
  var classIndex = clamp(misc[16], 0, CLASSES.length - 1, 0);
  var percent = function(index) {
    return clamp(readLong(index) / 65536, 0, 1, 1);
  };

  var savedGame = {
    isSavedGame: true,
    name: options.name || 'MyTown',
    everClicked: false,

    // Game, simulation and map
    _cityTime: cityTime,
    _speed: Simulation.SPEED_MED,
    _gameLevel: gameLevel,
    autoBulldoze: options.funds !== undefined ? true : misc[52] !== 0,
    width: WIDTH,
    height: HEIGHT,
    cityCentreX: Math.floor(WIDTH / 2),
    cityCentreY: Math.floor(HEIGHT / 2),
    pollutionMaxX: Math.floor(WIDTH / 2),
    pollutionMaxY: Math.floor(HEIGHT / 2),
    map: map,

    // Evaluation
    cityClass: CLASSES[classIndex],
    cityScore: clamp(misc[17], 1, 999, 500),

    // Demand
    resValve: clamp(misc[5], -2000, 2000, 0),
    comValve: clamp(misc[6], -1500, 1500, 0),
    indValve: clamp(misc[7], -1500, 1500, 0),

    // Budget
    autoBudget: options.funds !== undefined ? true : misc[53] !== 0,
    totalFunds: funds,
    cityTax: clamp(options.funds !== undefined ? 7 : misc[56], 0, 20, 7),
    policePercent: options.funds !== undefined ? 1 : percent(58),
    firePercent: options.funds !== undefined ? 1 : percent(60),
    roadPercent: options.funds !== undefined ? 1 : percent(62),
    roadSpend: 0,
    policeSpend: 0,
    fireSpend: 0,
    roadMaintenanceBudget: 0,
    policeMaintenanceBudget: 0,
    fireMaintenanceBudget: 0,
    roadEffect: 32,
    policeEffect: 1000,
    fireEffect: 1000,

    // Census
    resPop: clamp(misc[2], 0, 30000, 0),
    comPop: clamp(misc[3], 0, 30000, 0),
    indPop: clamp(misc[4], 0, 30000, 0),
    crimeRamp: clamp(misc[10], 0, 255, 0),
    pollutionRamp: clamp(misc[11], 0, 255, 0),
    landValueAverage: clamp(misc[12], 0, 255, 0),
    crimeAverage: clamp(misc[13], 0, 255, 0),
    pollutionAverage: clamp(misc[14], 0, 255, 0),
    totalPop: 1
  };

  HISTORIES.forEach(function(name) {
    savedGame[name + 'Hist10'] = histories[name].slice(0, 120);
    savedGame[name + 'Hist120'] = histories[name].slice(120, 240);
  });

  // Don't congratulate the player for milestones the city had already reached
  for (i = 0; i < MILESTONES.length; i++)
    savedGame[MILESTONES[i]] = classIndex > i;

  return savedGame;
};


var CityFile = {
  FILE_SIZE: FILE_SIZE,
  isCityFile: isCityFile,
  read: read
};


export { CityFile };
