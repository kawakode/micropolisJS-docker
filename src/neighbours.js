/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { Position } from './position.ts';
import { TileUtils } from './tileUtils.js';
import { HROADPOWER, LASTPOWER, POWERBASE, VROADPOWER } from './tileValues.ts';

// The cities around the player's, one beyond each edge of the map, and the deals the mayor makes with them.
//
// Most deals need a link reaching the neighbour's edge of the map: a road or a railway, or a power line. A deal signed
// without its link is on hold: it costs nothing and does nothing until the link is built. A deal in force adds to the
// demand for zones (see Valves), or feeds the power grid or draws on it (see PowerManager). Deals are paid with the
// yearly budget, for the months they were in force (see Budget.collectTax). The neighbours grow over the years,
// faster when they deal with the city.

var SIDES = ['north', 'east', 'south', 'west'];
var KINDS = ['trade', 'buyPower', 'sellPower', 'twinning'];

// How much power a power deal buys or sells: as much as a gas power plant gives
var POWER_DEAL = 500;

// The deals: the link each needs, what it costs (negative) or earns each year, and the demand it adds to each update
// of the valves. Both grow with the neighbour's size, from 0 to 1 (see sizeOf).
var DEALS = {
  trade: {
    link: 'transport',
    yearly: function(size) { return -Math.round(100 + 150 * size); },
    demand: function(size) { var d = Math.round(15 + 35 * size); return {res: 0, com: d, ind: d}; }
  },
  buyPower: {
    link: 'power',
    yearly: function() { return -250; }
  },
  sellPower: {
    link: 'power',
    yearly: function(size) { return Math.round(100 + 100 * size); }
  },
  twinning: {
    link: null,
    yearly: function(size) { return -Math.round(50 + 50 * size); },
    demand: function(size) { return {res: Math.round(10 + 20 * size), com: 0, ind: 0}; }
  }
};

// Buying and selling power with the same neighbour make no sense together
var EXCLUSIVE = {buyPower: 'sellPower', sellPower: 'buyPower'};

var NAMES = [
  'Belmonte', 'Rivedale', 'Castelnor', 'Altamira', 'Brightwater', 'Valcourt', 'Northam', 'Port Lenoir',
  'Greenfield', 'Montclair', 'Saint-Aubin', 'Oakridge', 'Lakeview', 'Fontaine-sur-Mer', 'Redcliff', 'Mirabel',
  'Silverton', 'Beaulieu', 'Kingsbridge', 'Clairmont', 'Westhaven', 'Roseval', 'Ashford', 'Pinecrest',
  'Marbourg', 'Elmstead', 'Vallon', 'Stonebury', 'Bellerive', 'Fairport', 'Hautecombe', 'Copperfield'
];

// A neighbour this big or bigger counts as big, for the deals
var BIG_CITY = 100000;


var isPowerLine = function(tileValue) {
  return (tileValue >= POWERBASE && tileValue <= LASTPOWER) || tileValue === HROADPOWER || tileValue === VROADPOWER;
};


// The same value for each kind of deal
var byKind = function(value) {
  var result = {};
  KINDS.forEach(function(kind) { result[kind] = value; });
  return result;
};


// How big a neighbour is, from 0 to 1
var sizeOf = function(neighbour) {
  return Math.min(1, neighbour.population / BIG_CITY);
};


// map: the city's map. random can be replaced, for testing.
function Neighbours(map, random) {
  this._map = map;
  this._random = random || Math.random;

  // {side, name, population, deals: {kind: signed}, months: {kind: months in force this year}}
  this.list = [];

  // The links found at the last look, by side: {transport, power: [the positions of power lines on the edge]}
  this._links = null;

  // By side: whether the power sold could be delivered at the last scan of the power grid
  this._delivered = {};
}


// New neighbours, for a new city
Neighbours.prototype.generate = function() {
  var names = NAMES.slice();
  this.list = SIDES.map(function(side) {
    var name = names.splice(Math.floor(this._random() * names.length), 1)[0];
    var r = this._random();
    return {side: side, name: name, population: Math.round(3000 + r * r * 90000), deals: byKind(false),
            months: byKind(0)};
  }, this);
  this._links = null;
  this._delivered = {};
};


Neighbours.prototype.save = function(saveData) {
  saveData.neighbours = this.list.map(function(n) {
    return {side: n.side, name: n.name, population: n.population, deals: Object.assign({}, n.deals),
            months: Object.assign({}, n.months)};
  });
};


// A game saved before there were neighbours gets new ones
Neighbours.prototype.load = function(saveData) {
  var saved = saveData.neighbours;
  var valid = Array.isArray(saved) && saved.length === SIDES.length && SIDES.every(function(side, i) {
    return saved[i] && saved[i].side === side && typeof(saved[i].name) === 'string' &&
           typeof(saved[i].population) === 'number';
  });

  if (!valid) {
    this.generate();
    return;
  }

  this.list = saved.map(function(n) {
    var deals = {};
    var months = {};
    KINDS.forEach(function(kind) {
      deals[kind] = !!(n.deals && n.deals[kind]);
      months[kind] = n.months && typeof(n.months[kind]) === 'number' ? n.months[kind] : 0;
    });
    return {side: n.side, name: n.name, population: n.population, deals: deals, months: months};
  });
  this._links = null;
  this._delivered = {};
};


Neighbours.prototype.get = function(side) {
  return this.list[SIDES.indexOf(side)] || null;
};


// The tiles along an edge of the map
var edgeTiles = function(map, side) {
  var tiles = [];
  var i;
  if (side === 'north' || side === 'south') {
    var y = side === 'north' ? 0 : map.height - 1;
    for (i = 0; i < map.width; i++)
      tiles.push(new Position(i, y));
  } else {
    var x = side === 'west' ? 0 : map.width - 1;
    for (i = 0; i < map.height; i++)
      tiles.push(new Position(x, i));
  }

  return tiles;
};


// Looks for the links reaching each edge of the map
Neighbours.prototype.findLinks = function() {
  var map = this._map;
  var links = {};

  SIDES.forEach(function(side) {
    var link = {transport: false, power: []};
    edgeTiles(map, side).forEach(function(pos) {
      var value = map.getTileValue(pos.x, pos.y);
      if (TileUtils.isDriveable(value))
        link.transport = true;
      if (isPowerLine(value))
        link.power.push(pos);
    });
    links[side] = link;
  });

  this._links = links;
  return links;
};


Neighbours.prototype._getLinks = function() {
  return this._links || this.findLinks();
};


// What a deal with the neighbour costs (negative) or earns in a year
Neighbours.prototype.yearly = function(neighbour, kind) {
  return DEALS[kind].yearly(sizeOf(neighbour));
};


// The state of a deal with the neighbour, if it were signed: 'active', 'noLink' (on hold, for want of its link), or
// 'noPower' (power sold, but the grid does not reach the edge, or has none to spare)
Neighbours.prototype.dealState = function(neighbour, kind) {
  var links = this._getLinks()[neighbour.side];
  var link = DEALS[kind].link;

  if ((link === 'transport' && !links.transport) || (link === 'power' && links.power.length === 0))
    return 'noLink';

  if (kind === 'sellPower' && !this._delivered[neighbour.side])
    return 'noPower';

  return 'active';
};


Neighbours.prototype._isActive = function(neighbour, kind) {
  return neighbour.deals[kind] && this.dealState(neighbour, kind) === 'active';
};


// Signs (or ends) a deal. Signing a power deal ends the other one with the same neighbour.
Neighbours.prototype.setDeal = function(side, kind, signed) {
  var neighbour = this.get(side);
  if (neighbour === null || DEALS[kind] === undefined)
    return;

  neighbour.deals[kind] = !!signed;
  if (signed && EXCLUSIVE[kind])
    neighbour.deals[EXCLUSIVE[kind]] = false;
};


// What the deals in force add to the demand for zones, at each update of the valves: {res, com, ind}
Neighbours.prototype.demandBonus = function() {
  var bonus = {res: 0, com: 0, ind: 0};

  this.list.forEach(function(n) {
    KINDS.forEach(function(kind) {
      if (!DEALS[kind].demand || !this._isActive(n, kind))
        return;

      var demand = DEALS[kind].demand(sizeOf(n));
      bonus.res += demand.res;
      bonus.com += demand.com;
      bonus.ind += demand.ind;
    }, this);
  }, this);

  return bonus;
};


// The power bought from the neighbours: how much, and the power lines it enters the grid by (see PowerManager)
Neighbours.prototype.powerSupply = function() {
  var supply = {capacity: 0, sources: []};

  this.list.forEach(function(n) {
    if (this._isActive(n, 'buyPower')) {
      supply.capacity += POWER_DEAL;
      supply.sources = supply.sources.concat(this._getLinks()[n.side].power);
    }
  }, this);

  return supply;
};


// After a scan of the power grid: the power sold is delivered where the grid reaches the neighbour's edge, as long as
// there is power to spare
Neighbours.prototype.deliverPower = function(powerGridMap, spare) {
  var links = this._getLinks();

  this.list.forEach(function(n) {
    var delivered = false;
    if (n.deals.sellPower && spare >= POWER_DEAL) {
      delivered = links[n.side].power.some(function(pos) {
        return powerGridMap.worldGet(pos.x, pos.y) > 0;
      });
      if (delivered)
        spare -= POWER_DEAL;
    }

    this._delivered[n.side] = delivered;
  }, this);
};


// Counts a month for each deal in force
Neighbours.prototype.countMonth = function() {
  this.list.forEach(function(n) {
    KINDS.forEach(function(kind) {
      if (this._isActive(n, kind))
        n.months[kind] = Math.min(12, n.months[kind] + 1);
    }, this);
  }, this);
};


// Ends the year: returns what the deals cost (negative) or earned, for the months they were in force, and the
// neighbours grow, faster when they deal with the city
Neighbours.prototype.closeYear = function() {
  var balance = 0;

  this.list.forEach(function(n) {
    var deals = 0;
    KINDS.forEach(function(kind) {
      if (n.months[kind] > 0) {
        balance += Math.round(this.yearly(n, kind) * n.months[kind] / 12);
        deals++;
      }
      n.months[kind] = 0;
    }, this);

    var growth = 0.01 + 0.01 * deals + (this._random() * 0.03 - 0.01);
    n.population = Math.max(500, Math.round(n.population * (1 + growth)));
  }, this);

  return balance;
};


// What the deals in force would cost (negative) or earn in a whole year
Neighbours.prototype.yearlyBalance = function() {
  var balance = 0;
  this.list.forEach(function(n) {
    KINDS.forEach(function(kind) {
      if (this._isActive(n, kind))
        balance += this.yearly(n, kind);
    }, this);
  }, this);

  return balance;
};


// The middle of a neighbour's edge of the map, to show where a link should go
Neighbours.prototype.edgeCentre = function(side) {
  var map = this._map;
  switch (side) {
    case 'north':
      return {x: Math.floor(map.width / 2), y: 0};
    case 'south':
      return {x: Math.floor(map.width / 2), y: map.height - 1};
    case 'west':
      return {x: 0, y: Math.floor(map.height / 2)};
    default:
      return {x: map.width - 1, y: Math.floor(map.height / 2)};
  }
};


// Everything about the neighbours, to show them (see NeighboursWindow): [{side, name, population, links: {transport,
// power}, deals: [{kind, signed, state, yearly}]}]
Neighbours.prototype.describe = function() {
  var links = this.findLinks();

  return this.list.map(function(n) {
    return {
      side: n.side,
      name: n.name,
      population: n.population,
      links: {transport: links[n.side].transport, power: links[n.side].power.length > 0},
      deals: KINDS.map(function(kind) {
        return {kind: kind, signed: n.deals[kind], state: this.dealState(n, kind), yearly: this.yearly(n, kind)};
      }, this)
    };
  }, this);
};


// The deals signed but not in force, for the news: [{side, name, kind, state}]
Neighbours.prototype.dealsOnHold = function() {
  var onHold = [];
  this.list.forEach(function(n) {
    KINDS.forEach(function(kind) {
      var state = n.deals[kind] ? this.dealState(n, kind) : 'active';
      if (state !== 'active')
        onHold.push({side: n.side, name: n.name, kind: kind, state: state});
    }, this);
  }, this);

  return onHold;
};


// How many deals are in force
Neighbours.prototype.activeDeals = function() {
  var count = 0;
  this.list.forEach(function(n) {
    KINDS.forEach(function(kind) {
      if (this._isActive(n, kind))
        count++;
    }, this);
  }, this);

  return count;
};


Neighbours.SIDES = SIDES;
Neighbours.KINDS = KINDS;
Neighbours.POWER_DEAL = POWER_DEAL;
Neighbours.EXCLUSIVE = EXCLUSIVE;


export { Neighbours };
