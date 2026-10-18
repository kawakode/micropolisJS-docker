/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { BaseTool } from './baseTool.js';
import { GameMap } from './gameMap.js';
import { Simulation } from './simulation.js';
import { Storage } from './storage.js';

// What the multiplayer lobby (see Lobby) reads from the server and sends to it, without the page: the server's answers
// checked and copied into fresh objects (anything else is dropped, so the page only ever shows values of the expected
// types), the layout of a region's map, and the save of a new shared city, made as the game makes a city's save.
//
// The lobby's routes (DESIGN §5.3; every id is a public id):
// - GET /api/cities: {cities: [city], invitations: [invitation]}; GET /api/regions: {regions: [region]}
// - city = {id, name, role, ownerName, population, year, online, region: {id, name, x, y} | null}
// - invitation = {id, kind: 'city' | 'region', target: {id, name}, inviterId, inviterName, role (null for a region)}
// - region = {id, name, ownerName, width, height, mine, cities}
// - GET /api/cities/:id: {city, members: [{id, username, role, colour, online}], invitations (owner only):
//   [{id, username, userId, role, createdAt}]}
// - GET /api/regions/:id: {region, slots: [{x, y, city: {id, name, ownerName, population, role} | null}],
//   members: [{id, username}], invitations (owner only): [{id, username, userId, createdAt}]}
// - POST /api/cities {name, level, save, region?: {id, x, y}}: 201 {city}

var WIDTH = 120;
var HEIGHT = 100;

// The longest names, in characters, as the server takes them
var CITY_NAME_MAX = 15;
var REGION_NAME_MAX = 30;

// The sides of a region, in cities (the same for its width and its height)
var REGION_SIZES = [2, 3, 4];
var REGION_SIZE_MAX = 4;

var ROLES = ['owner', 'player', 'viewer'];
// The roles an owner gives to the players it invites
var INVITED_ROLES = ['player', 'viewer'];
var LEVELS = [Simulation.LEVEL_EASY, Simulation.LEVEL_MED, Simulation.LEVEL_HARD];
var SPEEDS = [Simulation.SPEED_SLOW, Simulation.SPEED_MED, Simulation.SPEED_FAST];

// A public id (of a city, a region, an invitation or a player)
var PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;
var COLOUR = /^#[0-9a-f]{6}$/i;
var DEFAULT_COLOUR = '#f8f8ff';

// The longest name the page shows, in characters (the server's are shorter)
var MAX_SHOWN = 40;

var MILESTONES = ['_reachedTown', '_reachedCity', '_reachedCapital', '_reachedMetropolis', '_reachedMegalopolis'];

// The time of day a city starts at (see AmbientLife)
var MORNING = 0.2;


var isObject = function(value) {
  return value !== null && typeof(value) === 'object' && !Array.isArray(value);
};


var isPublicId = function(value) {
  return typeof(value) === 'string' && PUBLIC_ID.test(value);
};


var isCount = function(value) {
  return typeof(value) === 'number' && Math.floor(value) === value && value >= 0 && isFinite(value);
};


var count = function(value) {
  return isCount(value) ? value : 0;
};


// A name from the server, made safe to show: without control and format characters, not too long ('' if it is not a
// text)
var shownName = function(name) {
  if (typeof(name) !== 'string')
    return '';

  return Array.from(name.replace(/[\p{Cc}\p{Cf}]/gu, '')).slice(0, MAX_SHOWN).join('');
};


// A name typed for a city or a region, as the server takes it: in NFC, without control and format characters,
// trimmed, then 1 to max characters. Returns {text, reason}: reason is null when the name is right, else the key of
// FIELD_TEXTS that says why not ('required', 'too_long').
var checkName = function(name, max) {
  var text = typeof(name) === 'string' ? name.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim() : '';
  if (text === '')
    return {text: text, reason: 'required'};
  if (Array.from(text).length > max)
    return {text: text, reason: 'too_long'};
  return {text: text, reason: null};
};


// A username typed to invite someone, trimmed (the server finds the account whatever its case), at most max
// characters: {text, reason} as for checkName
var checkUsername = function(name, max) {
  var text = typeof(name) === 'string' ? name.trim() : '';
  if (text === '')
    return {text: text, reason: 'required'};
  if (Array.from(text).length > max)
    return {text: text, reason: 'too_long'};
  return {text: text, reason: null};
};


// --- The server's answers ---

var placement = function(region) {
  if (!isObject(region) || !isPublicId(region.id) || !isCount(region.x) || !isCount(region.y) ||
      region.x >= REGION_SIZE_MAX || region.y >= REGION_SIZE_MAX)
    return null;

  return {id: region.id, name: shownName(region.name), x: region.x, y: region.y};
};


// A shared city of the list: {id, name, role, ownerName, population, year, online, region: {id, name, x, y} | null},
// or null if it is not one
var city = function(entry) {
  if (!isObject(entry) || !isPublicId(entry.id) || shownName(entry.name) === '')
    return null;

  return {
    id: entry.id,
    name: shownName(entry.name),
    role: ROLES.indexOf(entry.role) === -1 ? 'viewer' : entry.role,
    ownerName: shownName(entry.ownerName),
    population: count(entry.population),
    year: isCount(entry.year) ? entry.year : null,
    online: count(entry.online),
    region: placement(entry.region)
  };
};


// An invitation the player received: {id, kind, target: {id, name}, inviterId, inviterName, role}, or null
var invitation = function(entry) {
  if (!isObject(entry) || !isPublicId(entry.id) || (entry.kind !== 'city' && entry.kind !== 'region') ||
      !isObject(entry.target) || !isPublicId(entry.target.id))
    return null;

  return {
    id: entry.id,
    kind: entry.kind,
    target: {id: entry.target.id, name: shownName(entry.target.name)},
    inviterId: isPublicId(entry.inviterId) ? entry.inviterId : null,
    inviterName: shownName(entry.inviterName),
    role: entry.kind === 'region' ? null : (INVITED_ROLES.indexOf(entry.role) === -1 ? 'viewer' : entry.role)
  };
};


// A region of the list: {id, name, ownerName, width, height, mine, cities}, or null
var region = function(entry) {
  if (!isObject(entry) || !isPublicId(entry.id) || REGION_SIZES.indexOf(entry.width) === -1 ||
      REGION_SIZES.indexOf(entry.height) === -1)
    return null;

  return {
    id: entry.id,
    name: shownName(entry.name),
    ownerName: shownName(entry.ownerName),
    width: entry.width,
    height: entry.height,
    mine: entry.mine === true,
    cities: count(entry.cities)
  };
};


// The entries of a list that are what check says (each copied by it)
var listOf = function(list, check) {
  if (!Array.isArray(list))
    return [];

  var result = [];
  list.forEach(function(entry) {
    var checked = check(entry);
    if (checked !== null)
      result.push(checked);
  });
  return result;
};


// The lobby, from the answers of GET /api/cities and GET /api/regions: {cities, invitations, regions}
var lobby = function(citiesAnswer, regionsAnswer) {
  var cities = isObject(citiesAnswer) ? citiesAnswer : {};
  var regions = isObject(regionsAnswer) ? regionsAnswer : {};
  return {
    cities: listOf(cities.cities, city),
    invitations: listOf(cities.invitations, invitation),
    regions: listOf(regions.regions, region)
  };
};


// The invitations, by the player who sent them, in the order they came: [{inviterId, inviterName, invitations}]
var invitationGroups = function(invitations) {
  var groups = [];
  var byInviter = {};

  invitations.forEach(function(entry) {
    // An inviter the server did not name is a group of its own
    var key = entry.inviterId === null ? 'invitation:' + entry.id : 'inviter:' + entry.inviterId;
    if (!Object.prototype.hasOwnProperty.call(byInviter, key)) {
      byInviter[key] = {inviterId: entry.inviterId, inviterName: entry.inviterName, invitations: []};
      groups.push(byInviter[key]);
    }
    byInviter[key].invitations.push(entry);
  });

  return groups;
};


var member = function(entry) {
  if (!isObject(entry) || !isPublicId(entry.id) || shownName(entry.username) === '')
    return null;

  return {
    id: entry.id,
    username: shownName(entry.username),
    role: ROLES.indexOf(entry.role) === -1 ? 'viewer' : entry.role,
    colour: typeof(entry.colour) === 'string' && COLOUR.test(entry.colour) ? entry.colour.toLowerCase() : DEFAULT_COLOUR,
    online: entry.online === true
  };
};


// An invitation the owner of a city or a region sent, not yet answered: {id, username, userId, role}
var sentInvitation = function(entry) {
  if (!isObject(entry) || !isPublicId(entry.id) || shownName(entry.username) === '')
    return null;

  return {
    id: entry.id,
    username: shownName(entry.username),
    userId: isPublicId(entry.userId) ? entry.userId : null,
    role: INVITED_ROLES.indexOf(entry.role) === -1 ? null : entry.role
  };
};


// A city and its members, from GET /api/cities/:id: {city, members, invitations (null unless the player owns it)},
// or null
var cityDetail = function(answer) {
  if (!isObject(answer))
    return null;

  var checked = city(answer.city);
  if (checked === null)
    return null;

  // The owner first, then the others by name
  var members = listOf(answer.members, member).sort(function(a, b) {
    if ((a.role === 'owner') !== (b.role === 'owner'))
      return a.role === 'owner' ? -1 : 1;
    return a.username.localeCompare(b.username);
  });

  return {
    city: checked,
    members: members,
    invitations: checked.role === 'owner' && Array.isArray(answer.invitations) ?
                 listOf(answer.invitations, sentInvitation) : null
  };
};


var slotCity = function(entry) {
  if (!isObject(entry) || !isPublicId(entry.id))
    return null;

  return {
    id: entry.id,
    name: shownName(entry.name),
    ownerName: shownName(entry.ownerName),
    population: count(entry.population),
    role: ROLES.indexOf(entry.role) === -1 ? null : entry.role
  };
};


// A region and its map, from GET /api/regions/:id: {region, slots: [{x, y, city}], members: [{id, username}],
// invitations (null unless the player owns it)}, or null. Each place of the map has one slot, empty (city null)
// unless the server put a city there.
var regionDetail = function(answer) {
  if (!isObject(answer))
    return null;

  var checked = region(answer.region);
  if (checked === null)
    return null;

  var cities = {};
  if (Array.isArray(answer.slots)) {
    answer.slots.forEach(function(slot) {
      if (isObject(slot) && isCount(slot.x) && isCount(slot.y) && slot.x < checked.width && slot.y < checked.height)
        cities[slot.y * checked.width + slot.x] = slotCity(slot.city);
    });
  }

  var slots = [];
  for (var y = 0; y < checked.height; y++) {
    for (var x = 0; x < checked.width; x++) {
      var index = y * checked.width + x;
      slots.push({x: x, y: y, city: cities[index] || null});
    }
  }

  var members = listOf(answer.members, function(entry) {
    if (!isObject(entry) || !isPublicId(entry.id) || shownName(entry.username) === '')
      return null;
    return {id: entry.id, username: shownName(entry.username), owner: shownName(entry.username) === checked.ownerName};
  }).sort(function(a, b) {
    if (a.owner !== b.owner)
      return a.owner ? -1 : 1;
    return a.username.localeCompare(b.username);
  });

  return {
    region: checked,
    slots: slots,
    members: members,
    invitations: checked.mine && Array.isArray(answer.invitations) ? listOf(answer.invitations, sentInvitation) : null
  };
};


// What a player can do with each place of a region's map, in reading order (row by row): [{x, y, row, column,
// city, play, build, clear}]. row and column count from 1, as the page names them. play: the player is a member of the
// city there; build: the place is free (every member of the region may build there); clear: the city there may leave
// the region, as its owner or the region's owner may decide.
var regionLayout = function(detail) {
  var mine = detail.region.mine;
  return detail.slots.map(function(slot) {
    var placed = slot.city;
    return {
      x: slot.x,
      y: slot.y,
      row: slot.y + 1,
      column: slot.x + 1,
      city: placed,
      play: placed !== null && placed.role !== null,
      build: placed === null,
      clear: placed !== null && (mine || placed.role === 'owner')
    };
  });
};


// The name of the file of a copy of a city, as the server names it: in ASCII (browsers may refuse other letters in a
// download's name)
var downloadName = function(name) {
  return (String(name || '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'city') + '.kawacity';
};


// --- A new shared city ---

var levelOf = function(level) {
  return LEVELS.indexOf(level) === -1 ? Simulation.LEVEL_EASY : level;
};


// The save of a new shared city, as the game saves a city it plays alone (see Game.getSaveData), made without
// playing it: the city is opened as the game opens it (a new city on the generated map, or the saved city), by a
// Simulation that only holds it (inert: nothing is scanned, nothing moves), then saved. The server opens it in its turn,
// and runs it.
// choice: {map: the GameMap of a generated landscape} or {save: a saved game, as Storage.parseSavedGame or
// CityFile.read give it}; name: the city's name; level: its difficulty (a new city's funds depend on it).
var buildSave = function(choice, name, level) {
  level = levelOf(level);
  var saved = choice && isObject(choice.save) ? JSON.parse(JSON.stringify(choice.save)) : null;
  if (saved === null && !(choice && choice.map instanceof GameMap))
    throw new Error('No map to build the city on');

  var map = saved === null ? choice.map : new GameMap(WIDTH, HEIGHT);
  var simulation = new Simulation(map, saved === null ? level : levelOf(saved._gameLevel), Simulation.SPEED_MED, saved,
                                  {inert: true});

  // A city saved while paused starts running, as when the game opens it
  if (SPEEDS.indexOf(simulation._speed) === -1)
    simulation.setSpeed(Simulation.SPEED_MED);

  var save = {name: name};
  MILESTONES.forEach(function(key) {
    save[key] = saved !== null && !!saved[key];
  });
  save.dayNight = saved !== null && typeof(saved.dayNight) === 'boolean' ? saved.dayNight : true;
  save.disastersEnabled = saved !== null && typeof(saved.disastersEnabled) === 'boolean' ? saved.disastersEnabled :
                          simulation.disasterManager.disastersEnabled;
  save.timeOfDay = saved !== null && typeof(saved.timeOfDay) === 'number' && isFinite(saved.timeOfDay) ?
                   ((saved.timeOfDay % 1) + 1) % 1 : MORNING;
  // The automatic bulldozer of a saved city, or the game's
  save.autoBulldoze = saved !== null && typeof(saved.autoBulldoze) === 'boolean' ? saved.autoBulldoze :
                      BaseTool.getAutoBulldoze();

  simulation.save(save);
  save._gameLevel = level;
  // A shared city plays no scenario
  save.scenario = null;
  save.version = Storage.CURRENT_VERSION;
  return save;
};


// The request that creates a shared city: {name, level, save}, and the place in a region (slot: {region: {id}, x, y})
var creationRequest = function(name, level, save, slot) {
  var body = {name: name, level: levelOf(level), save: save};
  if (slot)
    body.region = {id: slot.region.id, x: slot.x, y: slot.y};
  return body;
};


var LobbyData = {
  CITY_NAME_MAX: CITY_NAME_MAX,
  REGION_NAME_MAX: REGION_NAME_MAX,
  REGION_SIZES: REGION_SIZES,
  ROLES: ROLES,
  INVITED_ROLES: INVITED_ROLES,
  isPublicId: isPublicId,
  shownName: shownName,
  checkName: checkName,
  checkUsername: checkUsername,
  city: city,
  invitation: invitation,
  region: region,
  lobby: lobby,
  invitationGroups: invitationGroups,
  cityDetail: cityDetail,
  regionDetail: regionDetail,
  regionLayout: regionLayout,
  downloadName: downloadName,
  buildSave: buildSave,
  creationRequest: creationRequest
};


export { LobbyData };
