/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { GROUND_CELLS, OBJECTS } from './isoArt.js';
import * as TileValues from "./tileValues.ts";

// What the isometric view draws for each tile of the map (see IsoView): the ground of the tile, a cell of the ground
// image, and what stands on it: a picture of its own (a tree, a house, a pole...), or its part of a building, whose
// picture covers all of its tiles.

var TILE_COUNT = TileValues.TILE_COUNT;

var cell = {};
GROUND_CELLS.forEach(function(name, index) {
  cell[name] = index;
});

// The ground of most tiles is a given cell. Some depend on where the tile is, or on its neighbours:
var GRASS = -1;  // One of the grass cells, the same for a tile each time
var WATER = -2;  // Water, with a shore on the sides with land beyond
var ROAD = -3;   // A road, of the kind of road at the tile (see GameMap.getRoadClass), its shape in ROAD_SHAPE
var FLOOD = -4;  // Flood water, which moves

var ground = new Int16Array(TILE_COUNT).fill(GRASS);

// The roads' shapes: the mask of the sides they lead to (north 1, east 2, south 4, west 8), or a bridge along X (16)
// or Y (17)
var roadShape = new Int8Array(TILE_COUNT);
var BRIDGE_X = 16;
var BRIDGE_Y = 17;

// Pictures on single tiles: an index in OBJECT_NAMES, or one of the animations below (-1 for none)
var OBJECT_NAMES = [];
var objectIndex = {};
var object = new Int16Array(TILE_COUNT).fill(-1);

var FIRE = -2;       // Flames, drawn from the frame of the animation
var EXPLOSION = -3;
var WIND = -4;       // A wind turbine, its rotor turning
var TREES = -5;      // Woods: a few trees, or many
var WOODS = -6;

// Buildings: an index in BUILDINGS, where each building has its picture's name, size and first tile
var BUILDINGS = [];
var building = new Int16Array(TILE_COUNT).fill(-1);

// The tiles that may be drawn over water (bridges, power lines...) and so count as water for its shores
var overWater = new Uint8Array(TILE_COUNT);

// Some tiles of buildings are replaced on the map by the frames of their animations (the smoke of the factories, the
// radar of the airport, a football match...): each is drawn as the tile it stands for
var standsFor = new Int16Array(TILE_COUNT);
for (var t = 0; t < TILE_COUNT; t++)
  standsFor[t] = t;

[[TileValues.SMOKEBASE, 8, TileValues.IND1], [884, 4, 641], [888, 4, 644], [892, 4, 649], [896, 4, 650],
 [900, 4, 676], [904, 4, 677], [908, 4, 686], [912, 4, 689], [TileValues.COALSMOKE1, 4, 747],
 [TileValues.COALSMOKE2, 4, 748], [TileValues.COALSMOKE3, 4, 751], [TileValues.COALSMOKE4, 4, 752],
 [TileValues.NUKESWIRL1, 4, 820], [TileValues.RADAR0, 8, TileValues.RADAR], [TileValues.FOOTBALLGAME1, 8, 801],
 [TileValues.FOOTBALLGAME2, 8, 805]].forEach(function(frames) {
  for (var k = 0; k < frames[1]; k++)
    standsFor[frames[0] + k] = frames[2];
});


var named = function(name) {
  if (!(name in objectIndex)) {
    if (!OBJECTS[name])
      throw new Error('No picture ' + name);
    objectIndex[name] = OBJECT_NAMES.length;
    OBJECT_NAMES.push(name);
  }
  return objectIndex[name];
};


var range = function(first, last, fn) {
  for (var tile = first; tile <= last; tile++)
    fn(tile, tile - first);
};


// The shapes of roads, rails and power lines, in the order of their tiles (see Connector)
var SHAPES = [10, 5, 3, 6, 12, 9, 11, 7, 14, 13, 15];

var ROAD_CLASSES = ['street', 'dirt', 'avenue', 'highway'];


var addBuilding = function(name, size, first) {
  var index = BUILDINGS.length;
  BUILDINGS.push({name: name, size: size, first: first, picture: OBJECTS[name]});
  if (!OBJECTS[name])
    throw new Error('No picture ' + name);
  range(first, first + size * size - 1, function(tile) {
    building[tile] = index;
  });
};


var addLot = function(first, last, lot) {
  range(first, last, function(tile) {
    ground[tile] = cell['lot_' + lot];
  });
};


(function() {
  var v, p;

  // Water, woods, rubble...
  range(TileValues.WATER_LOW, TileValues.WATER_HIGH, function(tile) {
    ground[tile] = WATER;
    overWater[tile] = 1;
  });
  range(TileValues.WOODS_LOW, TileValues.LASTTREE, function(tile) {
    object[tile] = TREES;
  });
  range(TileValues.WOODS, TileValues.WOODS5, function(tile) {
    object[tile] = WOODS;
  });
  range(TileValues.RUBBLE, TileValues.LASTRUBBLE, function(tile, k) {
    ground[tile] = cell['rubble' + k];
  });
  range(TileValues.FLOOD, TileValues.LASTFLOOD, function(tile) {
    ground[tile] = FLOOD;
  });
  ground[TileValues.RADTILE] = cell.radiation;
  range(TileValues.UNUSED_TRASH3, TileValues.UNUSED_TRASH5, function(tile, k) {
    ground[tile] = cell['rubble' + k];
  });
  range(TileValues.FIRE, TileValues.LASTFIRE, function(tile) {
    ground[tile] = cell.scorched;
    object[tile] = FIRE;
  });

  // Roads: the same shapes again and again, with more and more traffic, and the drawbridges
  range(TileValues.ROADBASE, TileValues.BRWXXX7, function(tile) {
    var shape = (tile - TileValues.ROADBASE) % 16;
    ground[tile] = ROAD;
    if (shape === 0 || shape === 15) {
      roadShape[tile] = BRIDGE_X;
      overWater[tile] = 1;
    } else if (shape === 1) {
      roadShape[tile] = BRIDGE_Y;
      overWater[tile] = 1;
    } else if (shape === 13) {
      // A road along X, a power line across it
      roadShape[tile] = 10;
      object[tile] = named('pole_road_x');
    } else if (shape === 14) {
      roadShape[tile] = 5;
      object[tile] = named('pole_road_y');
    } else {
      roadShape[tile] = SHAPES[shape - 2];
    }
  });
  roadShape[TileValues.BRWV] = BRIDGE_Y;
  [TileValues.HBRDG0, TileValues.HBRDG1, TileValues.HBRDG2, TileValues.HBRDG3].forEach(function(tile) {
    ground[tile] = ROAD;
    roadShape[tile] = BRIDGE_X;
    overWater[tile] = 1;
  });
  [TileValues.VBRDG0, TileValues.VBRDG1, TileValues.VBRDG2, TileValues.VBRDG3].forEach(function(tile) {
    ground[tile] = ROAD;
    roadShape[tile] = BRIDGE_Y;
    overWater[tile] = 1;
  });

  // Power lines: over water, then on land
  ground[TileValues.HPOWER] = ground[TileValues.VPOWER] = WATER;
  overWater[TileValues.HPOWER] = overWater[TileValues.VPOWER] = 1;
  object[TileValues.HPOWER] = named('pole10');
  object[TileValues.VPOWER] = named('pole5');
  range(TileValues.LHPOWER, TileValues.LVPOWER10, function(tile, k) {
    object[tile] = named('pole' + SHAPES[k]);
  });
  ground[TileValues.RAILHPOWERV] = cell.rail10;
  object[TileValues.RAILHPOWERV] = named('pole_road_x');
  ground[TileValues.RAILVPOWERH] = cell.rail5;
  object[TileValues.RAILVPOWERH] = named('pole_road_y');

  // Rails
  ground[TileValues.HRAIL] = cell.railbridge_x;
  ground[TileValues.VRAIL] = cell.railbridge_y;
  overWater[TileValues.HRAIL] = overWater[TileValues.VRAIL] = 1;
  range(TileValues.LHRAIL, TileValues.LVRAIL10, function(tile, k) {
    ground[tile] = cell['rail' + SHAPES[k]];
  });
  // A rail along X, crossed by a road; and along Y
  ground[TileValues.HRAILROAD] = cell.crossing_x;
  ground[TileValues.VRAILROAD] = cell.crossing_y;
  ground[TileValues.ROADVPOWERH] = ROAD;
  roadShape[TileValues.ROADVPOWERH] = 5;
  object[TileValues.ROADVPOWERH] = named('pole_road_y');

  // Empty zones, with the zone's letter in their middle
  [['residential', TileValues.RESBASE], ['commercial', TileValues.COMBASE],
   ['industrial', TileValues.INDBASE]].forEach(function(zone) {
    range(zone[1], zone[1] + 8, function(tile, k) {
      ground[tile] = cell['zone_' + zone[0] + '_' + (k % 3) + Math.floor(k / 3)];
    });
    object[zone[1] + 4] = named('sign_' + zone[0]);
  });

  // The houses that grow on empty residential zones
  range(TileValues.HOUSE, TileValues.HHTHR, function(tile, k) {
    ground[tile] = cell.lot_lawn;
    object[tile] = named('house' + k);
  });

  // Zones
  for (v = 0; v < 4; v++) {
    for (p = 0; p < 4; p++)
      addBuilding('res_' + v + '_' + p, 3, TileValues.RZB - 4 + (v * 4 + p) * 9);
    for (p = 0; p < 5; p++)
      addBuilding('com_' + v + '_' + p, 3, TileValues.CZB - 4 + (v * 5 + p) * 9);
  }
  for (v = 0; v < 2; v++) {
    for (p = 0; p < 4; p++)
      addBuilding('ind_' + v + '_' + p, 3, TileValues.IZB - 4 + (v * 4 + p) * 9);
  }
  addLot(TileValues.RZB - 4, TileValues.RZB - 4 + 16 * 9 - 1, 'lawn');
  addLot(TileValues.CZB - 4, TileValues.COMLAST + 2, 'pavement');
  addLot(TileValues.IND1, TileValues.IND1 + 8 * 9 - 1, 'concrete');

  // Services, landmarks and power plants
  addBuilding('hospital', 3, TileValues.HOSPITALBASE);
  addLot(TileValues.HOSPITALBASE, TileValues.HOSPITALBASE + 8, 'pavement');
  addBuilding('worship0', 3, TileValues.CHURCH0BASE);
  addLot(TileValues.CHURCH0BASE, TileValues.CHURCH0BASE + 8, 'lawn');
  for (var k = 1; k < 8; k++)
    addBuilding('worship' + k, 3, TileValues.CHURCH1BASE + (k - 1) * 9);
  addLot(TileValues.CHURCH1BASE, TileValues.CHURCH7LAST, 'lawn');

  addBuilding('port', 4, TileValues.PORTBASE);
  addBuilding('airport', 6, TileValues.AIRPORTBASE);
  addBuilding('coal', 4, TileValues.COALBASE);
  addBuilding('fire_station', 3, TileValues.FIRESTBASE);
  addBuilding('police', 3, TileValues.POLICESTBASE);
  addBuilding('stadium', 4, TileValues.STADIUMBASE);
  addBuilding('stadium_full', 4, TileValues.FULLSTADIUM - 5);
  addBuilding('nuclear', 4, TileValues.NUCLEARBASE);
  addLot(TileValues.PORTBASE, TileValues.LASTPORT, 'concrete');
  addLot(TileValues.AIRPORTBASE, TileValues.AIRPORTBASE + 35, 'tarmac');
  addLot(TileValues.COALBASE, TileValues.LASTPOWERPLANT, 'concrete');
  addLot(TileValues.FIRESTBASE, TileValues.POLICESTBASE + 8, 'pavement');
  addLot(TileValues.STADIUMBASE, TileValues.FULLSTADIUM + 10, 'pavement');
  addLot(TileValues.NUCLEARBASE, TileValues.LASTZONE, 'concrete');

  object[TileValues.WINDTURBINE] = WIND;
  range(TileValues.WINDTURBINE1, TileValues.WINDTURBINE3, function(tile) {
    object[tile] = WIND;
  });
  addBuilding('gas', 3, TileValues.GASBASE);
  addBuilding('solar', 3, TileValues.SOLARBASE);
  addBuilding('school', 3, TileValues.SCHOOLBASE);
  addBuilding('university', 4, TileValues.UNIVERSITYBASE);
  addBuilding('bigpark', 3, TileValues.BIGPARKBASE);
  addLot(TileValues.GASBASE, TileValues.GASBASE + 8, 'concrete');
  addLot(TileValues.SOLARBASE, TileValues.SOLARBASE + 8, 'lawn');
  addLot(TileValues.SCHOOLBASE, TileValues.SCHOOLBASE + 8, 'lawn');
  addLot(TileValues.UNIVERSITYBASE, TileValues.UNIVERSITYBASE + 15, 'lawn');
  addLot(TileValues.BIGPARKBASE, TileValues.BIGPARKBASE + 8, 'lawn');

  ground[TileValues.GARDEN] = cell.lot_lawn;
  object[TileValues.GARDEN] = named('garden');
  ground[TileValues.PLAZA] = cell.lot_pavement;
  object[TileValues.PLAZA] = named('plaza');
  range(TileValues.FOUNTAIN, TileValues.FOUNTAIN + 3, function(tile) {
    ground[tile] = cell.lot_lawn;
    object[tile] = named('fountain');
  });

  range(TileValues.TINYEXP, TileValues.TINYEXPLAST, function(tile) {
    ground[tile] = cell.rubble0;
    object[tile] = EXPLOSION;
  });
})();


// The cells of the grounds that vary, by number rather than by name, as they are looked up for every tile shown
var grassCells = [0, 1, 2, 3].map(function(k) {
  return cell['grass' + k];
});
var floodCells = [cell.flood0, cell.flood1];
var waterCells = [];
var roadCells = [];
(function() {
  for (var land = 0; land < 16; land++) {
    for (var frame = 0; frame < 4; frame++)
      waterCells.push(cell['water' + land + '_' + frame]);
  }
  ROAD_CLASSES.forEach(function(kind) {
    for (var shape = 0; shape < 16; shape++)
      roadCells.push(cell['road_' + kind + '_' + shape]);
    roadCells.push(cell['bridge_' + kind + '_x'], cell['bridge_' + kind + '_y']);
  });
})();


// A number from a tile's position, the same each time, to vary the grass and the woods
var hash = function(x, y) {
  var h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};


var isWaterAt = function(map, x, y) {
  if (!map.testBounds(x, y))
    return true;
  return overWater[map.getTileValue(x, y)] === 1;
};


// The ground cell of the tile at (x, y) whose value (without its flags) is tile. frame counts the frames of the water's
// animation.
var groundCell = function(map, x, y, tile, frame) {
  var code = ground[standsFor[tile]];
  if (code >= 0)
    return code;

  switch (code) {
    case GRASS:
      return grassCells[hash(x, y) & 3];

    case WATER:
      var land = (isWaterAt(map, x, y - 1) ? 0 : 1) | (isWaterAt(map, x + 1, y) ? 0 : 2) |
                 (isWaterAt(map, x, y + 1) ? 0 : 4) | (isWaterAt(map, x - 1, y) ? 0 : 8);
      return waterCells[land * 4 + (frame & 3)];

    case FLOOD:
      return floodCells[(frame + x + y) & 1];

    case ROAD:
      return roadCells[(map.getRoadClass(x, y) & 3) * 18 + roadShape[tile]];
  }

  return grassCells[0];
};


// The name of the picture standing on the tile at (x, y), or null. tile is the value of the tile, and animated the
// value shown at this moment (see AnimationManager); time is in milliseconds.
var objectName = function(x, y, tile, animated, time) {
  var code = object[standsFor[tile]];
  if (code >= 0)
    return OBJECT_NAMES[code];

  switch (code) {
    case FIRE:
      var flame = animated >= TileValues.FIRE && animated <= TileValues.LASTFIRE ? animated - TileValues.FIRE :
                  Math.floor(time / 120);
      return 'fire' + (flame & 3);

    case EXPLOSION:
      var stage = animated >= TileValues.TINYEXP && animated <= TileValues.TINYEXPLAST ? animated - TileValues.TINYEXP :
                  tile - TileValues.TINYEXP;
      return 'explosion' + Math.min(3, Math.floor((stage % 8) / 2));

    case WIND:
      return 'wind' + (Math.floor(time / 140 + hash(x, y)) & 3);

    case TREES:
      return 'trees_sparse' + (hash(x, y) & 3);

    case WOODS:
      return 'trees_dense' + (hash(x, y) & 3);
  }

  return null;
};


// Whether the tile is a road with street lamps (dirt roads have none)
var isLitRoad = function(map, x, y, tile) {
  return ground[tile] === ROAD && roadShape[tile] < BRIDGE_X && map.getRoadClass(x, y) !== 1;
};


// The building that the tile is part of: {name, size, first, picture}, or null
var buildingOf = function(tile) {
  var index = building[standsFor[tile]];
  return index >= 0 ? BUILDINGS[index] : null;
};


// The tile that the tile is drawn as
var drawnAs = function(tile) {
  return standsFor[tile];
};


var IsoTiles = {
  buildingOf: buildingOf,
  drawnAs: drawnAs,
  groundCell: groundCell,
  isLitRoad: isLitRoad,
  objectName: objectName
};


export { IsoTiles };
