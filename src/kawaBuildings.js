/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { Ordinances } from './ordinances.js';
import { TileUtils } from './tileUtils.js';
import * as TileValues from "./tileValues.ts";

// The buildings that KawaCity adds to those of the original game (their power plants are handled by
// PowerManager).
//
// Schools and universities educate the neighbourhood: they add to the education map, which, once smoothed (see
// BlockMapUtils.crimeScan), raises land values and lowers crime around them. Like police stations, they work at
// half strength without power or without a road. Hospitals do the same with the health map, which makes homes grow
// better and raises land values (see Residential.evalResidential). Libraries are small schools. Monuments add their
// prestige to the landmark map, which raises land values more than anything. Recycling centres (when the city
// recycles) and water treatment plants clean up the pollution around them, and the plants make the waterfront
// sought after (see BlockMapUtils.pollutionTerrainLandValueScan). Bus stops and depots take cars off the roads around
// them, once the city has a depot (see Traffic.addToTrafficDensityMap). Parks, gardens and plazas count as green space for land values
// (see BlockMapUtils.pollutionTerrainLandValueScan).

var SCHOOL_STRENGTH = 800;
var UNIVERSITY_STRENGTH = 1600;
var HOSPITAL_STRENGTH = 1000;
var LIBRARY_STRENGTH = 400;
// The prestige of the monuments (see Monuments)
var STATUE_PRESTIGE = 400;
var TOWNHALL_PRESTIGE = 1200;
var TOWER_PRESTIGE = 2400;
// How much the recycling centre and the water treatment plant clean up their neighbourhood's pollution, and how much
// the plant makes the waterfront sought after
var RECYCLING_CLEANUP = 1200;
var WATERWORKS_CLEANUP = 500;
var WATERWORKS_WATERFRONT = 1000;
// How many people the buses carry instead of cars, around each stop and the depot (only once there is a depot: see
// BlockMapUtils.crimeScan)
var BUSSTOP_TRANSIT = 300;
var BUSDEPOT_TRANSIT = 600;


// Whether there is a road or rail along the edge of a building of the given size, whose centre is at (x, y)
var hasRoadAlongside = function(map, x, y, size) {
  var left = x - 1;
  var top = y - 1;

  for (var i = 0; i < size; i++) {
    var edges = [[left + i, top - 1], [left + i, top + size], [left - 1, top + i], [left + size, top + i]];
    for (var j = 0; j < edges.length; j++) {
      var ex = edges[j][0];
      var ey = edges[j][1];
      if (map.testBounds(ex, ey) && TileUtils.isDriveable(map.getTileValue(ex, ey)))
        return true;
    }
  }

  return false;
};


// Adds a building's strength to one of the block maps (education, health...), halved without power (if it needs any),
// and halved again without a road
var addEffect = function(map, x, y, simData, strength, size, mapName) {
  var effect = strength;
  if (!map.getTile(x, y).isPowered() && TileUtils.needsPower(map.getTileValue(x, y)))
    effect = Math.floor(effect / 2);

  if (!hasRoadAlongside(map, x, y, size))
    effect = Math.floor(effect / 2);

  var blockMap = simData.blockMaps[mapName];
  blockMap.worldSet(x, y, blockMap.worldGet(x, y) + effect);
};


// A building counted by the census, that adds its strength to one of the block maps
var makeServiceHandler = function(counter, strength, size, mapName) {
  return function(map, x, y, simData) {
    simData.census[counter] += 1;
    addEffect(map, x, y, simData, strength, size, mapName);
  };
};


// The compact police and fire stations: like the big ones (see EmergencyServices), funded by the same budget, but
// half as strong, for half the upkeep
var makePostHandler = function(counter, budgetEffect, mapName) {
  return function(map, x, y, simData) {
    simData.census[counter] += 1;

    var effect = Math.floor(simData.budget[budgetEffect] / 2);
    if (!map.getTile(x, y).isPowered())
      effect = Math.floor(effect / 2);

    if (!hasRoadAlongside(map, x, y, 2))
      effect = Math.floor(effect / 2);

    var blockMap = simData.blockMaps[mapName];
    blockMap.worldSet(x, y, blockMap.worldGet(x, y) + effect);
  };
};


// A recycling centre only has the waste to sort when the city recycles (see Ordinances)
var recyclingFound = function(map, x, y, simData) {
  simData.census.recyclingPop += 1;
  if (Ordinances.isOn(simData.budget.ordinances, Ordinances.byId('recycling')))
    addEffect(map, x, y, simData, RECYCLING_CLEANUP, 3, 'cleanupMap');
};


var waterworksFound = function(map, x, y, simData) {
  simData.census.waterworksPop += 1;
  addEffect(map, x, y, simData, WATERWORKS_CLEANUP, 3, 'cleanupMap');
  addEffect(map, x, y, simData, WATERWORKS_WATERFRONT, 3, 'waterMap');
};


var parkFound = function(map, x, y, simData) {
  simData.census.parkPop += 1;
};


// Whether a tile is part of a park, garden or plaza
var isGreenSpace = function(tileValue) {
  return (tileValue >= TileValues.BIGPARKBASE && tileValue <= TileValues.PLAZA);
};


// The size of KawaCity's buildings, from their centre tile (0 for other tiles)
var getZoneSize = function(tileValue) {
  switch (tileValue) {
    case TileValues.WINDTURBINE:
    case TileValues.STATUE:
    case TileValues.BUSSTOP:
      return 1;

    case TileValues.LIBRARY:
    case TileValues.POLICEPOST:
    case TileValues.FIREPOST:
    case TileValues.TOWER:
      return 2;

    case TileValues.GASPLANT:
    case TileValues.SOLARPLANT:
    case TileValues.SCHOOL:
    case TileValues.BIGPARK:
    case TileValues.TOWNHALL:
    case TileValues.RECYCLING:
    case TileValues.WATERWORKS:
    case TileValues.BUSDEPOT:
    case TileValues.DAM:
      return 3;

    case TileValues.UNIVERSITY:
      return 4;

    default:
      return 0;
  }
};


var KawaBuildings = {
  getZoneSize: getZoneSize,
  hasRoadAlongside: hasRoadAlongside,
  isGreenSpace: isGreenSpace,

  registerHandlers: function(mapScanner, repairManager) {
    mapScanner.addAction(TileValues.SCHOOL, makeServiceHandler('schoolPop', SCHOOL_STRENGTH, 3, 'educationMap'));
    mapScanner.addAction(TileValues.UNIVERSITY,
                         makeServiceHandler('universityPop', UNIVERSITY_STRENGTH, 4, 'educationMap'));
    mapScanner.addAction(TileValues.HOSPITAL, makeServiceHandler('hospitalPop', HOSPITAL_STRENGTH, 3, 'healthMap'));
    mapScanner.addAction(TileValues.LIBRARY, makeServiceHandler('libraryPop', LIBRARY_STRENGTH, 2, 'educationMap'));
    mapScanner.addAction(TileValues.POLICEPOST, makePostHandler('policePostPop', 'policeEffect', 'policeStationMap'));
    mapScanner.addAction(TileValues.FIREPOST, makePostHandler('firePostPop', 'fireEffect', 'fireStationMap'));
    mapScanner.addAction(TileValues.STATUE, makeServiceHandler('statuePop', STATUE_PRESTIGE, 1, 'landmarkMap'));
    mapScanner.addAction(TileValues.TOWNHALL, makeServiceHandler('townHallPop', TOWNHALL_PRESTIGE, 3, 'landmarkMap'));
    mapScanner.addAction(TileValues.TOWER, makeServiceHandler('towerPop', TOWER_PRESTIGE, 2, 'landmarkMap'));
    mapScanner.addAction(TileValues.RECYCLING, recyclingFound);
    mapScanner.addAction(TileValues.WATERWORKS, waterworksFound);
    mapScanner.addAction(TileValues.BUSSTOP, makeServiceHandler('busStopPop', BUSSTOP_TRANSIT, 1, 'transitMap'));
    mapScanner.addAction(TileValues.BUSDEPOT, makeServiceHandler('busDepotPop', BUSDEPOT_TRANSIT, 3, 'transitMap'));
    mapScanner.addAction(TileValues.BIGPARK, parkFound);

    repairManager.addAction(TileValues.SCHOOL, 15, 3);
    repairManager.addAction(TileValues.UNIVERSITY, 15, 4);
    repairManager.addAction(TileValues.HOSPITAL, 15, 3);
    repairManager.addAction(TileValues.LIBRARY, 15, 2);
    repairManager.addAction(TileValues.POLICEPOST, 7, 2);
    repairManager.addAction(TileValues.FIREPOST, 7, 2);
    repairManager.addAction(TileValues.TOWNHALL, 15, 3);
    repairManager.addAction(TileValues.TOWER, 15, 2);
    repairManager.addAction(TileValues.RECYCLING, 15, 3);
    repairManager.addAction(TileValues.WATERWORKS, 15, 3);
    repairManager.addAction(TileValues.BUSDEPOT, 15, 3);
    repairManager.addAction(TileValues.BIGPARK, 15, 3);
  }
};


export { KawaBuildings };
