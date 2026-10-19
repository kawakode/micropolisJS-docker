/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// Where a tool acts when it is dragged across the map, from the tile where the drag started (the anchor) to the tile
// where it ends (current): the same for the game (see InputStatus) and for the server of the shared cities, which works
// it out again from the tool's name and the two tiles. This module only computes: it touches no map and no page.
//
// The positions come in the order the tool is applied: it matters, as each placement is applied before the next one is
// worked out (a bridge needs the road before it). Positions off the map are left out. However far apart the two tiles
// are, and whatever they hold, the work done is bounded: a drag gives at most LIMITS[category] placements.

// How the tools behave when dragged
var LINE = 'line';         // Lays an L-shaped path of tiles from the start of the drag (roads, rails, wires)
var AREA = 'area';         // Fills the dragged rectangle (bulldozer, parks), widened by the tool's brush
var BUILDING = 'building'; // Places a grid of buildings over the dragged rectangle
var SINGLE = 'single';     // Acts on a single tile on click (query)

var CATEGORIES = {
  road: LINE,
  dirtroad: LINE,
  avenue: LINE,
  highway: LINE,
  rail: LINE,
  wire: LINE,
  bulldozer: AREA,
  bulldozer3: AREA,
  bulldozer5: AREA,
  bulldozer7: AREA,
  park: AREA,
  garden: AREA,
  plaza: AREA,
  trees: AREA,
  water: AREA,
  landfill: AREA,
  query: SINGLE
};

// The width of each building, in tiles (as GameTools builds them: see BuildingTool)
var SIZES = {
  airport: 6,
  coal: 4,
  commercial: 3,
  fire: 3,
  industrial: 3,
  nuclear: 4,
  police: 3,
  port: 4,
  residential: 3,
  stadium: 4,
  wind: 1,
  solar: 3,
  gas: 3,
  school: 3,
  hospital: 3,
  library: 2,
  policepost: 2,
  firepost: 2,
  statue: 1,
  townhall: 3,
  tower: 2,
  recycling: 3,
  waterworks: 3,
  university: 4,
  bigpark: 3
};

// The bulldozer's sizes are one tool, applied over a wider area: its brush (the side of the square it clears)
var BRUSHES = {
  bulldozer3: 3,
  bulldozer5: 5,
  bulldozer7: 7
};

// The tools that change the map, and so may be applied for a player: every tool of GameTools but the query tool,
// which only looks
var TOOL_NAMES = Object.keys(CATEGORIES).concat(Object.keys(SIZES)).filter(function(name) {
  return name !== 'query';
}).sort();

// Limit how much can be done in a single drag
var MAX_AREA_SIDE = 64;
var MAX_BUILDINGS = 100;

// The most placements a drag gives, by category: a line across the whole of a 120x100 map, the largest area, the most
// buildings
/** @type {Object<string, number>} */
var LIMITS = {};
LIMITS[LINE] = 221;
LIMITS[AREA] = MAX_AREA_SIDE * MAX_AREA_SIDE;
LIMITS[BUILDING] = MAX_BUILDINGS;
LIMITS[SINGLE] = 1;


var isOwn = function(table, name) {
  return typeof(name) === 'string' && Object.prototype.hasOwnProperty.call(table, name);
};


var isKnownTool = function(toolName) {
  return isOwn(CATEGORIES, toolName) || isOwn(SIZES, toolName);
};


/**
 * The way a tool is dragged: LINE, AREA, SINGLE, or BUILDING (also for a name that is not a tool's)
 * @param {string} toolName
 * @returns {string}
 */
var getToolCategory = function(toolName) {
  return isOwn(CATEGORIES, toolName) ? CATEGORIES[toolName] : BUILDING;
};


/**
 * Whether the tool may be applied to the map for a player (see TOOL_NAMES)
 * @param {unknown} toolName
 * @returns {boolean}
 */
var isApplicable = function(toolName) {
  return isKnownTool(toolName) && toolName !== 'query';
};


/**
 * The side of the square a tool acts on around each tile of a drag: more than 1 for the bigger bulldozers
 * @param {string} toolName
 * @returns {number}
 */
var brushOf = function(toolName) {
  return isOwn(BRUSHES, toolName) ? BRUSHES[toolName] : 1;
};


/**
 * The width of what the tool places, in tiles: a building's size, else 1
 * @param {string} toolName
 * @returns {number}
 */
var sizeOf = function(toolName) {
  return isOwn(SIZES, toolName) ? SIZES[toolName] : 1;
};


var isTile = function(p) {
  return p !== null && typeof(p) === 'object' && Number.isInteger(p.x) && Number.isInteger(p.y);
};


var isSize = function(n) {
  return Number.isInteger(n) && n > 0;
};


// The positions from 'from' to 'to' along one axis, both included, going in the direction of step (1 or -1), that are
// within [0, size): {first, last}, or null when there are none (also when 'to' is behind 'from')
var clip = function(from, to, step, size) {
  if ((to - from) * step < 0)
    return null;

  var low = Math.max(Math.min(from, to), 0);
  var high = Math.min(Math.max(from, to), size - 1);
  if (low > high)
    return null;

  return step > 0 ? {first: low, last: high} : {first: high, last: low};
};


// Adds the tiles of a straight run of the line to placements: along x (at row y) when horizontal, else along y (at
// column x), from 'from' to 'to'; only those on the map
var addRun = function(placements, horizontal, fixed, from, to, step, bounds) {
  var fixedSize = horizontal ? bounds.height : bounds.width;
  if (fixed < 0 || fixed >= fixedSize)
    return;

  var run = clip(from, to, step, horizontal ? bounds.width : bounds.height);
  if (run === null)
    return;

  for (var v = run.first; placements.length < LIMITS[LINE]; v += step) {
    placements.push(horizontal ? {x: v, y: fixed} : {x: fixed, y: v});
    if (v === run.last)
      break;
  }
};


// An L-shaped path: first along the axis with the greatest distance, then along the other
var linePlacements = function(anchor, current, bounds) {
  var placements = [];
  var dx = current.x - anchor.x;
  var dy = current.y - anchor.y;
  var stepX = dx < 0 ? -1 : 1;
  var stepY = dy < 0 ? -1 : 1;

  if (Math.abs(dx) >= Math.abs(dy)) {
    addRun(placements, true, anchor.y, anchor.x, current.x, stepX, bounds);
    addRun(placements, false, current.x, anchor.y + stepY, current.y, stepY, bounds);
  } else {
    addRun(placements, false, anchor.x, anchor.y, current.y, stepY, bounds);
    addRun(placements, true, current.y, anchor.x + stepX, current.x, stepX, bounds);
  }

  return placements;
};


// The dragged rectangle, row by row: a brush wider than a tile sweeps the drag, centred on the pointer. Each side is
// cut to MAX_AREA_SIDE tiles from the top left.
var areaPlacements = function(toolName, anchor, current, bounds) {
  var placements = [];
  var reach = Math.floor((brushOf(toolName) - 1) / 2);
  var minX = Math.min(anchor.x, current.x) - reach;
  var minY = Math.min(anchor.y, current.y) - reach;
  var maxX = Math.min(Math.max(anchor.x, current.x) + reach, minX + MAX_AREA_SIDE - 1);
  var maxY = Math.min(Math.max(anchor.y, current.y) + reach, minY + MAX_AREA_SIDE - 1);

  var columns = clip(minX, maxX, 1, bounds.width);
  var rows = clip(minY, maxY, 1, bounds.height);
  if (columns === null || rows === null)
    return placements;

  for (var y = rows.first; y <= rows.last; y++) {
    for (var x = columns.first; x <= columns.last && placements.length < LIMITS[AREA]; x++)
      placements.push({x: x, y: y});
  }

  return placements;
};


// A grid of buildings, aligned on the first one, row by row: the first MAX_BUILDINGS of the grid, of which those on
// the map are kept. The positions are those of the buildings' "centre" tile, as the tools expect.
var buildingPlacements = function(toolName, anchor, current, bounds) {
  var size = sizeOf(toolName);
  var countX = Math.floor(Math.abs(current.x - anchor.x) / size) + 1;
  var countY = Math.floor(Math.abs(current.y - anchor.y) / size) + 1;
  var dirX = current.x < anchor.x ? -1 : 1;
  var dirY = current.y < anchor.y ? -1 : 1;
  var grid = [];

  for (var j = 0; j < countY && grid.length < MAX_BUILDINGS; j++) {
    for (var i = 0; i < countX && grid.length < MAX_BUILDINGS; i++)
      grid.push({x: anchor.x + i * size * dirX, y: anchor.y + j * size * dirY});
  }

  return grid.filter(function(p) {
    return p.x >= 0 && p.y >= 0 && p.x < bounds.width && p.y < bounds.height;
  });
};


/**
 * The tiles at which the tool acts, in order, for a drag from anchor to current (the same tile for a click), on a map
 * of the given size (a GameMap will do). Nothing for a name that is not a tool's, for coordinates that are not
 * integers, or for a size that is not a positive integer.
 * @param {string} toolName
 * @param {{x: number, y: number}} anchor
 * @param {{x: number, y: number}} current
 * @param {{width: number, height: number}} bounds
 * @returns {{x: number, y: number}[]}
 */
var computePlacements = function(toolName, anchor, current, bounds) {
  if (!isKnownTool(toolName) || !isTile(anchor) || !isTile(current) || bounds === null || typeof(bounds) !== 'object' ||
      !isSize(bounds.width) || !isSize(bounds.height))
    return [];

  switch (getToolCategory(toolName)) {
    case SINGLE:
      if (current.x < 0 || current.y < 0 || current.x >= bounds.width || current.y >= bounds.height)
        return [];
      return [{x: current.x, y: current.y}];

    case LINE:
      return linePlacements(anchor, current, bounds);

    case AREA:
      return areaPlacements(toolName, anchor, current, bounds);

    default:
      return buildingPlacements(toolName, anchor, current, bounds);
  }
};


var Placements = {
  LINE: LINE,
  AREA: AREA,
  BUILDING: BUILDING,
  SINGLE: SINGLE,
  LIMITS: LIMITS,
  MAX_AREA_SIDE: MAX_AREA_SIDE,
  MAX_BUILDINGS: MAX_BUILDINGS,
  TOOL_NAMES: TOOL_NAMES,
  brushOf: brushOf,
  computePlacements: computePlacements,
  getToolCategory: getToolCategory,
  isApplicable: isApplicable,
  sizeOf: sizeOf
};


export { Placements };
