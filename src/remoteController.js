/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { ERROR_TEXTS, TOOL_TEXTS } from './apiErrors.js';
import { BudgetWindow } from './budgetWindow.js';
import { DisasterWindow } from './disasterWindow.js';
import { I18n } from './i18n.js';
import { LocalController } from './localController.js';
import { Placements } from './placements.js';
import { PlayerCursors } from './playerCursors.js';
import { PlayersPanel } from './playersPanel.js';
import { SettingsWindow } from './settingsWindow.js';
import { Simulation } from './simulation.js';
import { Text } from './text.js';

// What the game of a shared city does with the player's commands: it sends them to the server, which simulates the
// city (see Multiplayer for the connection, and DESIGN §5.4 for the messages). It has the methods of LocalController,
// which the game calls the same way, and it applies the server's messages to the copy of the city that the game shows
// (see RemoteCity) and to the game.
//
// The commands (each with a seq number, answered by toolResult, ok or error with that seq):
// - {t: 'tool', seq, tool, from: {x, y}, to: {x, y}}: a drag of a tool, from where it started to where it ended (the
//   server works the placements out as the game does, see Placements). The query tool only reads the copy.
// - {t: 'budget', seq, roadPercent, firePercent, policePercent, taxPercent}
// - {t: 'loan', seq, borrow, repay}
// - {t: 'ordinances', seq, mask}
// - {t: 'settings', seq, autoBudget?, autoBulldoze?, disasters?, level?}: only those that changed
// - {t: 'disaster', seq, kind}, {t: 'deal', seq, side, kind, signed}, {t: 'speed', seq, speed}, {t: 'pause', seq,
//   paused}
// And without an answer: {t: 'chat', text}, {t: 'cursor', ...} (see PlayerCursors).
//
// The controller does not touch the page itself: it calls the game's methods, and the players panel's (see
// PlayersPanel), so that it can be tested without one.

// What each role may do (DESIGN §5.1): the owner everything, a player all but the disasters, a viewer only watch,
// chat and look with the query tool. Every member may download a copy of the city.
var RIGHTS = {
  owner: ['build', 'budget', 'speed', 'settings', 'deals', 'disasters'],
  player: ['build', 'budget', 'speed', 'settings', 'deals'],
  viewer: []
};

var ROLES = Object.keys(RIGHTS);

// How long the game shows a tool's placements while waiting for the server's answer, at most (milliseconds)
var PENDING_TOOL_TIME = 5000;

// The chat's limit (the server's: 5 messages at once, then 1 a second; here a little slower, as messages may reach
// the server closer together than they left): a message beyond it would be refused, and lost
var CHAT_BURST = 5;
var CHAT_INTERVAL = 1200;

var SPEEDS = [Simulation.SPEED_SLOW, Simulation.SPEED_MED, Simulation.SPEED_FAST];


var isObject = function(value) {
  return value !== null && typeof(value) === 'object' && !Array.isArray(value);
};


var isTile = function(point) {
  return isObject(point) && Number.isInteger(point.x) && Number.isInteger(point.y) && point.x >= 0 &&
         point.x < 120 && point.y >= 0 && point.y < 100;
};


var defaultNow = function() {
  return typeof(performance) !== 'undefined' ? performance.now() : Date.now();
};


// The text of an error code (see apiErrors.js)
var errorText = function(code) {
  var key = typeof(code) === 'string' && Object.prototype.hasOwnProperty.call(ERROR_TEXTS, code) ? code : 'internal';
  return I18n.t(ERROR_TEXTS[key]);
};


// A whole number from a window's field, within bounds (null if it is not a number)
var integer = function(value, min, max) {
  var n = typeof(value) === 'number' ? value : parseInt(value, 10);
  if (!isFinite(n))
    return null;

  return Math.max(min, Math.min(max, Math.round(n)));
};


// The city and the players of a welcome: {city: {id, name, ownerName, region}, you: {id, username, role, colour}}
var people = function(welcome) {
  var city = isObject(welcome.city) ? welcome.city : {};
  var you = isObject(welcome.you) ? welcome.you : {};

  return {
    city: {id: typeof(city.id) === 'string' ? city.id : '',
           name: PlayersPanel.cleanName(city.name) || 'MyTown',
           ownerName: PlayersPanel.cleanName(city.ownerName),
           region: isObject(city.region) ? city.region : null},
    you: {id: typeof(you.id) === 'string' ? you.id : '', username: PlayersPanel.cleanName(you.username),
          role: ROLES.indexOf(you.role) === -1 ? 'viewer' : you.role, colour: you.colour}
  };
};


// connection: see Multiplayer.Connection (send(message) and request(message, callback)); city: the RemoteCity built
// from the welcome; welcome: the welcome message. options: {view: the players panel, download(path, fileName): saves
// a file from the server, now(): the clock of the sprites (performance.now() by default)}
function RemoteController(connection, city, welcome, options) {
  options = options || {};

  this.remote = true;
  this.connection = connection;
  this.city = city;
  this.game = null;
  this.view = options.view || null;
  this._download = options.download || null;
  this._now = options.now || defaultNow;

  // What the save says of the city's looks (each player then chooses their own in the settings)
  var save = isObject(welcome.save) ? welcome.save : {};
  this.dayNight = typeof(save.dayNight) === 'boolean' ? save.dayNight : null;
  this.timeOfDay = typeof(save.timeOfDay) === 'number' ? save.timeOfDay : undefined;

  var known = people(welcome);
  this.cityInfo = known.city;
  this.you = known.you;
  this.role = known.you.role;

  // The players ({id, username, role, colour, online}), their pointers, and our tool drags waiting for an answer
  this.players = [];
  this.pointers = new PlayerCursors.Pointers();
  this._pendingTools = [];
  this._cursorSender = new PlayerCursors.Sender(function(message) {
    return connection.send(message);
  });

  // The chat messages that may go now (see CHAT_BURST), and whether the player was told to wait
  this._chatTokens = CHAT_BURST;
  this._chatAt = null;
  this._chatWaitTold = false;

  this._setPlayers(welcome.players, false);
}


// The game is ready (see Game): it shows the players and the chat of the welcome
RemoteController.prototype.attach = function(game) {
  this.game = game;
  if (this.view !== null) {
    this.view.setRole(this.role);
    this.view.setPlayers(this.players, this.you.id);
    this.view.show();
  }
};


// Whether the player's role allows something: 'build', 'budget', 'speed', 'settings', 'deals' or 'disasters' (the
// query tool and the windows, read only, are for everyone)
RemoteController.prototype.can = function(right) {
  return RIGHTS[this.role].indexOf(right) !== -1;
};


// Sends a command, and tells the player when the server refuses it
RemoteController.prototype._command = function(message) {
  var game = this.game;
  return this.connection.request(message, function(error) {
    if (error !== null && game !== null)
      game.notify(errorText(error.code), 'bad');
  });
};


// --- The player's commands (see LocalController) ---

// A drag of a tool (see InputStatus: TOOL_APPLY), sent with where it started and where it ended
RemoteController.prototype.applyTool = function(data) {
  var game = this.game;
  if (game === null || game.dialogOpen)
    return;

  // The query tool only reads the city: the game's own copy answers
  if (data.toolName === 'query') {
    game._local.applyTool(data);
    return;
  }

  if (!this.can('build') || !Placements.isApplicable(data.toolName) || !isTile(data.anchor) || !isTile(data.current))
    return;

  game._preview = null;

  // The placements are shown until the server's answer (with the tiles it changed) arrives
  var pending = {rect: this._boundsOf(data), done: false, until: this._now() + PENDING_TOOL_TIME};
  this._pendingTools.push(pending);

  var self = this;
  var toolName = data.toolName;
  this.connection.request({t: 'tool', tool: toolName, from: {x: data.anchor.x, y: data.anchor.y},
                           to: {x: data.current.x, y: data.current.y}}, function(error, reply) {
    pending.done = true;
    self._toolDone(toolName, error, reply);
  });
};


// The outline around a drag's placements, in our colour (each placement is the centre of a building, or a tile)
RemoteController.prototype._boundsOf = function(data) {
  var placements = Array.isArray(data.placements) ? data.placements : [];
  if (placements.length === 0)
    return null;

  var size = Placements.sizeOf(data.toolName);
  var offset = Placements.centreOffset(size);
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  placements.forEach(function(p) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });

  var left = Math.max(0, minX - offset);
  var top = Math.max(0, minY - offset);
  var right = Math.min(120, maxX - offset + size);
  var bottom = Math.min(100, maxY - offset + size);
  if (!(right > left && bottom > top))
    return null;

  return {x: left, y: top, width: right - left, height: bottom - top, colour: PlayerCursors.colour(this.you.colour),
          outline: true};
};


// The server's answer to a tool: {applied, failed, reason, cost}, said as a city played alone says it
RemoteController.prototype._toolDone = function(toolName, error, reply) {
  var game = this.game;
  if (game === null)
    return;

  if (error !== null) {
    game.showToolOutput(errorText(error.code));
    return;
  }

  var applied = Number.isInteger(reply.applied) ? reply.applied : 0;
  var reason = typeof(reply.reason) === 'string' ? reply.reason : null;

  if (applied > 0)
    game.tickerNews.record(toolName, applied);
  if (reason === 'no_money')
    game.tickerNews.record('noMoney');
  else if (applied === 0 && reason === 'needs_bulldoze')
    game.tickerNews.record('needsBulldoze');

  if (reason === 'no_money')
    game.showToolOutput(I18n.t(Text.toolMessages.noMoney));
  else if (applied === 0 && reason === 'needs_bulldoze')
    game.showToolOutput(LocalController.needsDozeText());
  else if (applied === 0 && reason === 'failed')
    game.showToolOutput(I18n.t(TOOL_TEXTS.failed));
  else if (applied === 0 && reason === 'locked')
    game.showToolOutput(LocalController.lockedText(toolName));
  else
    game.showToolOutput(null);
};


var BUDGET_KEYS = ['roadPercent', 'firePercent', 'policePercent', 'taxPercent'];

// The budget window was closed: the rates the player changed. shown: what the window showed when it opened (see
// Game.handleBudgetRequest). Other players may have changed the budget meanwhile: a rate the player left as it was
// keeps its value of now, and nothing is sent when nothing changes.
RemoteController.prototype.applyBudget = function(data, shown) {
  if (data.cancelled || !this.can('budget'))
    return;

  // The loans, as chosen: they don't depend on what the window showed
  var borrow = integer(data.borrow, 0, 5);
  if ((borrow !== null && borrow > 0) || data.repay === true)
    this._command({t: 'loan', borrow: borrow || 0, repay: data.repay === true});

  // The ordinances, if the player changed them (another player may have changed others meanwhile: only the ones the
  // player ticked or unticked change)
  var openedMask = isObject(shown) && Number.isInteger(shown.ordinances) ? shown.ordinances : null;
  if (Number.isInteger(data.ordinances) && openedMask !== null && data.ordinances !== openedMask) {
    var current = this.city.simulation.budget.ordinances;
    var mask = (current & ~(openedMask ^ data.ordinances)) | (data.ordinances & (openedMask ^ data.ordinances));
    this._command({t: 'ordinances', mask: mask});
  }

  var values = {
    roadPercent: integer(data.roadPercent, 0, 100),
    firePercent: integer(data.firePercent, 0, 100),
    policePercent: integer(data.policePercent, 0, 100),
    taxPercent: integer(data.taxPercent, 0, 20)
  };
  if (values.roadPercent === null || values.firePercent === null || values.policePercent === null ||
      values.taxPercent === null)
    return;

  var budget = this.city.simulation.budget;
  var now = {roadPercent: BudgetWindow.rateOf(budget.roadPercent), firePercent: BudgetWindow.rateOf(budget.firePercent),
             policePercent: BudgetWindow.rateOf(budget.policePercent), taxPercent: budget.cityTax};
  var opened = isObject(shown) ? {roadPercent: shown.roadRate, firePercent: shown.fireRate,
                                  policePercent: shown.policeRate, taxPercent: shown.taxRate} : now;
  BUDGET_KEYS.forEach(function(key) {
    if (values[key] === opened[key])
      values[key] = now[key];
  });
  if (BUDGET_KEYS.every(function(key) { return values[key] === now[key]; }))
    return;

  this.game.recordBudgetChanges(values);
  this._command({t: 'budget', roadPercent: values.roadPercent, firePercent: values.firePercent,
                 policePercent: values.policePercent, taxPercent: values.taxPercent});
};


// The settings window was closed: the city's settings the player changed go to the server (as the role allows), the
// player's own (the view, the day and night, the language) are applied here. shown: what the window showed when it
// opened (see Game.handleSettingsRequest): other players may have changed the settings meanwhile, and what the player
// left as it was is not sent back (a speed would also resume the city).
RemoteController.prototype.applySettings = function(actions, shown) {
  var game = this.game;
  var simulation = this.city.simulation;
  var opened = isObject(shown) ? shown : {};
  var settings = {};
  var changed = false;
  var speed = null;

  var set = function(key, value) {
    settings[key] = value;
    changed = true;
  };

  // Whether the player chose another value than the window showed, and another than the city has now
  var chose = function(key, value, current) {
    return (!Object.prototype.hasOwnProperty.call(opened, key) || value !== opened[key]) && value !== current;
  };

  actions.forEach(function(a) {
    switch (a.action) {
      case SettingsWindow.AUTOBUDGET:
        if (this.can('settings') && chose('autoBudget', !!a.data, simulation.budget.autoBudget))
          set('autoBudget', !!a.data);
        break;

      case SettingsWindow.AUTOBULLDOZE:
        if (this.can('settings') && chose('autoBulldoze', !!a.data, this.city.autoBulldoze))
          set('autoBulldoze', !!a.data);
        break;

      case SettingsWindow.SPEED:
        if (this.can('speed') && chose('speed', a.data - 0, this.city.speed))
          speed = a.data - 0;
        break;

      case SettingsWindow.DISASTERS_CHANGED:
        if (this.can('disasters') && chose('disasters', !!a.data, simulation.disasterManager.disastersEnabled)) {
          if (!a.data)
            game.tickerNews.record('disastersOff');
          set('disasters', !!a.data);
        }
        break;

      case SettingsWindow.LEVEL:
        if (this.can('settings') && chose('level', a.data, simulation.getLevel()) &&
            (a.data === Simulation.LEVEL_EASY || a.data === Simulation.LEVEL_MED || a.data === Simulation.LEVEL_HARD)) {
          game.tickerNews.record(a.data > simulation.getLevel() ? 'harder' : 'easier');
          set('level', a.data);
        }
        break;

      case SettingsWindow.DAY_NIGHT:
        if (!a.data && game.ambientLife.dayNight)
          game.tickerNews.record('nightOff');
        game.ambientLife.setDayNight(a.data);
        break;

      case SettingsWindow.LANGUAGE:
        I18n.setLanguage(a.data);
        break;

      case SettingsWindow.VIEW:
        game.setIsometric(a.data);
        break;

      default:
        console.warn('Unexpected action', a);
    }
  }, this);

  if (changed)
    this._command(Object.assign({t: 'settings'}, settings));
  if (speed !== null)
    this.setSpeed(speed);
};


// The disaster window was closed (the owner's only)
RemoteController.prototype.applyDisaster = function(kind) {
  if (kind === DisasterWindow.DISASTER_NONE || typeof(kind) !== 'string' || !this.can('disasters'))
    return;

  this.game.tickerNews.record('disaster:' + kind);
  this._command({t: 'disaster', kind: kind});
};


// The deals signed or ended in the window of the neighbouring cities: [{side, kind, signed}]
RemoteController.prototype.applyDeals = function(changes) {
  if (!this.can('deals'))
    return;

  changes.forEach(function(change) {
    this.game.tickerNews.record(change.signed ? 'deal' : 'dealEnded');
    this._command({t: 'deal', side: change.side, kind: change.kind, signed: !!change.signed});
  }, this);
};


// No money from nowhere in a shared city
RemoteController.prototype.applyDebug = function() {
};


RemoteController.prototype.togglePause = function() {
  if (!this.can('speed'))
    return;

  var paused = !this.city.paused;
  if (paused)
    this.game.tickerNews.record('pause');
  this._command({t: 'pause', paused: paused});
};


// The speed buttons and the settings: the city runs at that speed (and resumes), once the server says so
RemoteController.prototype.setSpeed = function(speed) {
  if (SPEEDS.indexOf(speed) === -1 || !this.can('speed'))
    return;

  if (speed !== this.game.defaultSpeed && speed !== Simulation.SPEED_MED)
    this.game.tickerNews.record(speed === Simulation.SPEED_FAST ? 'fast' : 'slow');
  this._command({t: 'speed', speed: speed});
};


// The save button downloads a copy of the city, as the server keeps it
RemoteController.prototype.save = function() {
  this.game.tickerNews.record('save');
  if (this._download !== null && this.cityInfo.id !== '') {
    var fileName = (this.cityInfo.name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'city') + '.kawacity';
    this._download('/api/cities/' + encodeURIComponent(this.cityInfo.id) + '/save', fileName);
  }
};


// A chat message from the panel: returns whether it was sent (if not, the panel keeps it). Beyond the chat's limit it
// waits, and the player is told once, in the chat.
RemoteController.prototype.sendChat = function(text) {
  var cleaned = PlayersPanel.cleanChat(text);
  if (cleaned === '')
    return false;

  var now = this._now();
  if (this._chatAt !== null)
    this._chatTokens = Math.min(CHAT_BURST, this._chatTokens + Math.max(0, now - this._chatAt) / CHAT_INTERVAL);
  this._chatAt = now;
  if (this._chatTokens < 1) {
    if (!this._chatWaitTold && this.view !== null)
      this.view.addNotice(I18n.t('Not sent yet: the chat takes about one message a second. Send it again in a moment.'));
    this._chatWaitTold = true;
    return false;
  }

  if (!this.connection.send({t: 'chat', text: cleaned})) {
    if (this.game !== null)
      this.game.notify(errorText('network'), 'bad');
    return false;
  }

  this._chatTokens -= 1;
  this._chatWaitTold = false;
  return true;
};


// --- Each frame ---

// Moves the sprites to where they are drawn now, and tells the server where our pointer is
RemoteController.prototype.animate = function(now) {
  this.city.animate(now);

  var input = this.game.inputStatus;
  this._cursorSender.update(PlayerCursors.message(input.getPointer(), input.toolName), now);
};


// The tool preview (see Game.computeOverlay), with the other players' pointers and our drags waiting for the
// server's answer
RemoteController.prototype.decorateOverlay = function(overlay, now) {
  this._pendingTools = this._pendingTools.filter(function(pending) {
    return !pending.done && now < pending.until;
  });

  var rects = this.pointers.outlines(this._colours(), this.you.id);
  this._pendingTools.forEach(function(pending) {
    if (pending.rect !== null)
      rects.push(pending.rect);
  });

  if (rects.length === 0)
    return overlay;
  if (overlay === null)
    return {rects: rects, label: null};

  return {rects: rects.concat(overlay.rects), label: overlay.label};
};


RemoteController.prototype._colours = function() {
  var colours = {};
  this.players.forEach(function(p) {
    colours[p.id] = p.colour;
  });
  return colours;
};


// --- The server's messages ---

// A new welcome (after reconnecting): the same city, as it is now
RemoteController.prototype.applyWelcome = function(welcome, now) {
  this.city.applyWelcome(welcome, now);

  var known = people(welcome);
  var renamed = known.city.name !== this.cityInfo.name;
  var roleChanged = known.you.role !== this.role;
  this.cityInfo = known.city;
  this.you = known.you;
  this.role = known.you.role;

  this.pointers.clear();
  this._cursorSender.reset();
  this._pendingTools = [];
  this._setPlayers(welcome.players, false);

  if (this.view !== null) {
    this.view.setRole(this.role);
    this.view.setPlayers(this.players, this.you.id);
    this.view.setChat(welcome.chat, this.you.id);
  }

  var game = this.game;
  if (game !== null) {
    game.refreshSpeed();
    if (renamed)
      game.setCityName(this.cityInfo.name);
    if (roleChanged)
      game.applyRole();
  }
};


// The players message: who is in the city. With notice, the chat tells who came and who left.
RemoteController.prototype._setPlayers = function(list, notice) {
  var before = {};
  this.players.forEach(function(p) {
    before[p.id] = p.online;
  });

  this.players = (Array.isArray(list) ? list : []).map(PlayersPanel.player).filter(function(p) { return p !== null; });

  var online = this.players.filter(function(p) { return p.online; }).map(function(p) { return p.id; });
  this.pointers.keep(online);

  if (!notice || this.view === null)
    return;

  var ownId = this.you.id;
  var known = {};
  this.players.forEach(function(p) {
    known[p.id] = true;
    if (p.id === ownId || p.online === (before[p.id] === true))
      return;

    this.view.addNotice(p.online ? I18n.t('{name} joined the city.') : I18n.t('{name} left the city.'), p.username);
  }, this);
};


// A message of the server for the game, other than the welcome and the answers (see Multiplayer). now: the clock of
// the sprites.
RemoteController.prototype.receive = function(message, now) {
  var game = this.game;
  var city = this.city;

  switch (message.t) {
    case 'tiles':
      city.applyTiles(message);
      break;

    case 'sprites':
      city.applySprites(message.s, now);
      break;

    case 'state':
      var applied = city.applyState(message.state);
      if (game !== null && (applied.indexOf('speed') !== -1 || applied.indexOf('paused') !== -1))
        game.refreshSpeed();
      break;

    case 'stats':
      city.applyStats(message.stats);
      break;

    case 'maps':
      city.applyMaps(message.maps);
      break;

    case 'msg':
      var resolved = city.resolveMessage(message, now);
      if (resolved !== null && game !== null)
        game.processFrontEndMessage(resolved);
      break;

    case 'budgetApplied':
      if (game !== null)
        game.notify(I18n.t('The yearly budget was applied with the current rates.'), 'neutral');
      break;

    case 'action':
      // What the others did is for the news ticker, not for announcing
      if (game !== null && isObject(message.by) && message.by.id !== this.you.id && typeof(message.tool) === 'string')
        game.tickerNews.record(message.tool, Number.isInteger(message.count) && message.count > 0 ? message.count : 1);
      break;

    case 'players':
      this._setPlayers(message.list, true);
      if (this.view !== null)
        this.view.setPlayers(this.players, this.you.id);
      break;

    case 'chat':
      if (this.view !== null)
        this.view.addChat(message);
      break;

    case 'cursors':
      this.pointers.receive(message.list);
      break;

    case 'roleChanged':
      if (ROLES.indexOf(message.role) === -1 || message.role === this.role)
        break;

      this.role = this.you.role = message.role;
      if (this.view !== null)
        this.view.setRole(this.role);
      if (game !== null) {
        game.applyRole();
        game.notify(I18n.t('Your role in this city is now: {role}.', {role: PlayersPanel.roleText(this.role)}),
                    'neutral');
      }
      break;

    case 'renamed':
      var name = PlayersPanel.cleanName(message.name);
      if (name === '' || name === this.cityInfo.name)
        break;

      this.cityInfo.name = name;
      if (game !== null) {
        game.setCityName(name);
        game.notify(I18n.t('The city is now called {name}.', {name: name}), 'neutral');
      }
      break;

    case 'error':
      if (game !== null)
        game.notify(errorText(message.code), 'bad');
      break;
  }
};


// The connection's state changed: 'connecting', 'online', 'reconnecting' or 'offline'
RemoteController.prototype.setStatus = function(status) {
  if (status !== 'online')
    this._pendingTools = [];
  if (this.view !== null)
    this.view.setStatus(status);
};


// Shows everything again in the new language
RemoteController.prototype.translate = function() {
  if (this.view !== null)
    this.view.translate();
};


RemoteController.RIGHTS = RIGHTS;
RemoteController.ROLES = ROLES;
RemoteController.PENDING_TOOL_TIME = PENDING_TOOL_TIME;
RemoteController.errorText = errorText;


export { RemoteController };
