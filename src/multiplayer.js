/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import $ from "jquery";

import { AccountScreens } from './accountScreens.js';
import { Api } from './api.js';
import { ERROR_TEXTS, KICK_REASONS, KICK_TEXTS } from './apiErrors.js';
import { Game } from './game.js';
import { I18n } from './i18n.js';
import { PlayersPanel } from './playersPanel.js';
import { RemoteCity } from './remoteCity.js';
import { RemoteController } from './remoteController.js';

// Playing a shared city: the live connection to the game's server, and the game it shows (see RemoteController and
// RemoteCity). The lobby starts it with Multiplayer.play(cityId).
//
// The connection is a WebSocket at /api/ws on the page's own server (wss: when the page is served over https), with
// JSON messages, each an object whose t says what it is (DESIGN §5.4). The game sends {t: 'join', city} first, and
// the server answers with a welcome: the whole city, the players and the chat. Then the server sends what changes,
// and the game its commands; a command has a seq number, which the server's answer (toolResult, ok or error) repeats.
//
// When the connection drops, the game tries again after 1 s, then 2, 4... up to 30 s (each a little shorter or longer
// at random, so that the players of a city do not all come back at once), and says it is reconnecting meanwhile; the
// new welcome is applied to the city the game already shows. The server ends the connection for good with
// {t: 'kicked', reason} (the city was deleted, the player removed or logged out...): the game says why, then goes
// back to the lobby. All but {t: 'kicked', reason: 'shutdown'}: the server is stopping, and saved the city first, so
// the game tries again as when the connection drops, and is back once the server is (after a restart or an update:
// a server of another version makes the page load again, see checkBuild).

// The waits before trying again, in milliseconds
var RETRY_FIRST = 1000;
var RETRY_MAX = 30000;

// How long the server has to answer a command, or to welcome us once connected
var REPLY_TIMEOUT = 15000;
var WELCOME_TIMEOUT = 15000;

// After this many failed attempts in a row, the game checks that the player is still logged in
var SESSION_CHECK_AFTER = 2;

// After this many attempts in a row refused before the connection opened (the browser cannot tell why: too many
// connections of the player, a full server, a server that is down), the game says it cannot reach the city
var REFUSED_AFTER = 3;

// The errors in answer to join that trying again would not change
var FATAL_JOIN_ERRORS = ['not_found', 'forbidden', 'unauthenticated', 'invalid_input'];

// A city's public id
var CITY_ID = /^[A-Za-z0-9_-]{22}$/;

var OPEN = 1;


var isObject = function(value) {
  return value !== null && typeof(value) === 'object' && !Array.isArray(value);
};


// The address of the live connection, on the page's own server
var socketURL = function(location) {
  return (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/api/ws';
};


// The wait before the next attempt, after attempt failed attempts in a row: 1 s doubling up to 30 s, each between
// 80% and 120% of that (but never more than 30 s). random: a function like Math.random.
var backoff = function(attempt, random) {
  var base = Math.min(RETRY_MAX, RETRY_FIRST * Math.pow(2, Math.max(0, attempt)));
  return Math.round(Math.min(RETRY_MAX, base * (0.8 + 0.4 * random())));
};


var defaultTimers = {
  setTimeout: function(callback, delay) { return setTimeout(callback, delay); },
  clearTimeout: function(timer) { clearTimeout(timer); }
};


// The connection to a shared city. options:
// - url: the WebSocket's address (see socketURL); city: the city's public id
// - createSocket(url): a new WebSocket (or an object that behaves like one: readyState, send, close, and the onopen,
//   onmessage, onclose and onerror handlers)
// - onWelcome(welcome): each welcome (the first, and each after reconnecting)
// - onMessage(message): the server's other messages for the game (not the answers to commands: see request)
// - onStatus(status): 'connecting' (before the first welcome), 'online', 'reconnecting', or 'ended'
// - onTrouble(code): why the game is trying again: an answer to join (a key of ERROR_TEXTS, server_busy for instance),
//   or 'refused' after REFUSED_AFTER attempts that did not even connect
// - onEnd(kind, code): the connection ended for good: kind 'kicked' (code: a key of KICK_TEXTS) or 'failed' (code: a
//   key of ERROR_TEXTS, the answer to join)
// - checkSession(callback): optional, asks the server whether the player is still logged in, and calls back with
//   false if not (the game then stops trying)
// - timers ({setTimeout, clearTimeout}) and random (like Math.random): for the tests
function Connection(options) {
  this._url = options.url;
  this._city = options.city;
  this._createSocket = options.createSocket;
  this._onWelcome = options.onWelcome || function() {};
  this._onMessage = options.onMessage || function() {};
  this._onStatus = options.onStatus || function() {};
  this._onTrouble = options.onTrouble || function() {};
  this._onEnd = options.onEnd || function() {};
  this._checkSession = options.checkSession || null;
  this._timers = options.timers || defaultTimers;
  this._random = options.random || Math.random;

  this._socket = null;
  this._opened = false;
  // Attempts in a row that did not connect
  this._refused = 0;
  this._welcomed = false;
  this._everWelcomed = false;
  this._ended = false;
  this._attempt = 0;
  this._retryTimer = null;
  this._welcomeTimer = null;
  this._seq = 0;
  this._pending = {};

  // The last error the server gave in answer to join (shown while trying again), or null
  this.lastError = null;
  this.status = 'idle';
}


Connection.prototype.start = function() {
  if (this.status === 'idle')
    this._open();
};


Connection.prototype._setStatus = function(status) {
  if (status === this.status)
    return;

  this.status = status;
  this._onStatus(status);
};


Connection.prototype._open = function() {
  this._setStatus(this._everWelcomed ? 'reconnecting' : 'connecting');

  var socket;
  try {
    socket = this._createSocket(this._url);
  } catch (e) {
    this._retry();
    return;
  }

  this._socket = socket;
  this._opened = false;
  this._welcomed = false;
  var self = this;

  socket.onopen = function() {
    if (self._socket !== socket)
      return;

    self._opened = true;
    self._refused = 0;
    socket.send(JSON.stringify({t: 'join', city: self._city}));

    // A server that never welcomes us is tried again
    self._welcomeTimer = self._timers.setTimeout(function() {
      self._welcomeTimer = null;
      if (self._socket === socket && !self._welcomed)
        self._drop(socket);
    }, WELCOME_TIMEOUT);
  };

  socket.onmessage = function(event) {
    self._receive(socket, event.data);
  };

  socket.onclose = function() {
    self._closed(socket);
  };

  // A failed connection is closed too
  socket.onerror = function() {};
};


// Closes a socket that went wrong, and tries again
Connection.prototype._drop = function(socket) {
  try {
    socket.close(4000);
  } catch (e) {
    // Closed already
  }
  this._closed(socket);
};


Connection.prototype._receive = function(socket, data) {
  if (socket !== this._socket || this._ended || typeof(data) !== 'string')
    return;

  var message;
  try {
    message = JSON.parse(data);
  } catch (e) {
    return;
  }

  if (!isObject(message) || typeof(message.t) !== 'string')
    return;

  switch (message.t) {
    case 'welcome':
      this._welcomed = true;
      this._everWelcomed = true;
      this._attempt = 0;
      this._refused = 0;
      this.lastError = null;
      if (this._welcomeTimer !== null) {
        this._timers.clearTimeout(this._welcomeTimer);
        this._welcomeTimer = null;
      }
      this._setStatus('online');
      this._onWelcome(message);
      return;

    case 'kicked':
      var reason = KICK_REASONS.indexOf(message.reason) === -1 ? 'error' : message.reason;
      // A server that stops (to be restarted or updated) saved the city first: the game waits for it to come back,
      // as when the connection drops
      if (reason === 'shutdown')
        this._drop(socket);
      else
        this._end('kicked', reason);
      return;

    case 'toolResult':
    case 'ok':
      this._answer(message.seq, null, message);
      return;

    case 'error':
      var code = typeof(message.code) === 'string' && Object.prototype.hasOwnProperty.call(ERROR_TEXTS, message.code) ?
                 message.code : 'internal';
      if (this._answer(message.seq, {code: code}, null))
        return;

      if (!this._welcomed) {
        // The answer to join
        this.lastError = code;
        if (FATAL_JOIN_ERRORS.indexOf(code) !== -1)
          this._end('failed', code);
        else
          this._onTrouble(code);
        return;
      }

      this._onMessage({t: 'error', code: code});
      return;
  }

  if (this._welcomed)
    this._onMessage(message);
};


// Calls back the command waiting for this answer, if there is one. Returns whether there was.
Connection.prototype._answer = function(seq, error, reply) {
  if (!Number.isInteger(seq) || this._pending[seq] === undefined)
    return false;

  var pending = this._pending[seq];
  delete this._pending[seq];
  this._timers.clearTimeout(pending.timer);
  pending.callback(error, reply);
  return true;
};


// Every command waiting for an answer gets this error
Connection.prototype._failPending = function(code) {
  var pending = this._pending;
  this._pending = {};
  Object.keys(pending).forEach(function(seq) {
    this._timers.clearTimeout(pending[seq].timer);
    pending[seq].callback({code: code}, null);
  }, this);
};


Connection.prototype._closed = function(socket) {
  if (socket !== this._socket)
    return;

  this._socket = null;
  this._welcomed = false;
  if (this._welcomeTimer !== null) {
    this._timers.clearTimeout(this._welcomeTimer);
    this._welcomeTimer = null;
  }
  this._failPending('network');

  if (this._ended)
    return;
  // The server refuses some connections before they open (with an HTTP status the page does not see)
  if (!this._opened && ++this._refused >= REFUSED_AFTER && this.lastError === null)
    this._onTrouble('refused');
  this._retry();
};


Connection.prototype._retry = function() {
  var delay = backoff(this._attempt, this._random);
  this._attempt++;
  this._setStatus(this._everWelcomed ? 'reconnecting' : 'connecting');

  var self = this;
  this._retryTimer = this._timers.setTimeout(function() {
    self._retryTimer = null;
    if (!self._ended)
      self._open();
  }, delay);

  // Attempts that keep failing may be refused because the session is over
  if (this._checkSession !== null && this._attempt >= SESSION_CHECK_AFTER) {
    this._checkSession(function(loggedIn) {
      if (loggedIn === false && !self._ended && !self._welcomed)
        self._end('kicked', 'session');
    });
  }
};


// The connection ends for good
Connection.prototype._end = function(kind, code) {
  if (this._ended)
    return;

  this.stop();
  this._onEnd(kind, code);
};


// Closes the connection, without trying again (going back to the lobby, for instance)
Connection.prototype.stop = function() {
  this._ended = true;
  if (this._retryTimer !== null) {
    this._timers.clearTimeout(this._retryTimer);
    this._retryTimer = null;
  }

  var socket = this._socket;
  this._socket = null;
  this._welcomed = false;
  if (this._welcomeTimer !== null) {
    this._timers.clearTimeout(this._welcomeTimer);
    this._welcomeTimer = null;
  }
  if (socket !== null) {
    try {
      socket.close(1000);
    } catch (e) {
      // Closed already
    }
  }

  this._failPending('network');
  this._setStatus('ended');
};


Connection.prototype.isOnline = function() {
  return this._socket !== null && this._welcomed && this._socket.readyState === OPEN;
};


// Sends a message without waiting for an answer. Returns false when it could not be sent (the connection is down).
Connection.prototype.send = function(message) {
  if (!this.isOnline())
    return false;

  this._socket.send(JSON.stringify(message));
  return true;
};


// Sends a command with the next seq number; callback(error, reply) is called with the server's answer (error null and
// the toolResult or ok message; or an error {code} from the server, 'network' when the connection is down or drops
// before the answer, 'timeout' when the answer does not come). Returns the seq number, or 0 when the command could not
// be sent (the callback has then been called already).
Connection.prototype.request = function(message, callback) {
  if (!this.isOnline()) {
    callback({code: 'network'}, null);
    return 0;
  }

  var seq = ++this._seq;
  var self = this;
  var timer = this._timers.setTimeout(function() {
    self._answer(seq, {code: 'timeout'}, null);
  }, REPLY_TIMEOUT);
  this._pending[seq] = {callback: callback, timer: timer};

  var copy = Object.assign({}, message);
  copy.seq = seq;
  this._socket.send(JSON.stringify(copy));
  return seq;
};


// --- The game of a shared city ---

// The pictures of the game, from the title screen (see micropolis.js)
var assets = null;

// The game being played: its connection, controller, players panel and game
var current = null;


var setAssets = function(tileSet, snowTileSet, spriteSheet) {
  assets = {tileSet: tileSet, snowTileSet: snowTileSet, spriteSheet: spriteSheet};
};


// The version of the page (each build has its own), as the server's welcome names its own
var pageBuild = function() {
  return $('#scenarioPicker').attr('data-version') || '';
};


var now = function() {
  return performance.now();
};


// Back to the lobby, by loading the page again
var backToLobby = function() {
  if (current !== null)
    current.connection.stop();

  window.location.hash = '/lobby';
  window.location.reload();
};


// The card over the page that says what is happening, before the game shows, or why it ended: title and text, and
// the label of its button, which goes back to the lobby
var showCard = function(title, text, button) {
  $('#mpCardTitle').text(title);
  $('#mpCardText').text(text);
  $('#mpCardLobby').text(button);
  $('#mpScreen').removeClass('hidden');
  $('#mpCardLobby').trigger('focus');
};


var hideCard = function() {
  $('#mpScreen').addClass('hidden');
};


// A key pressed in the card (inCard) or in the reconnecting banner: it is theirs, not one of the game's shortcuts
// (Space would pause the city, and the focused button would not be pressed). The card holds the focus: Tab stays on
// its button. Returns whether the focus goes back to the card's button.
var ownKey = function(e, inCard) {
  e.stopPropagation();
  if (!inCard || e.key !== 'Tab')
    return false;

  e.preventDefault();
  return true;
};


// The banner over the map while the connection is down
var showReconnecting = function(shown) {
  $('#mpReconnecting').toggleClass('hidden', !shown);
};


var errorText = function(code) {
  return RemoteController.errorText(code);
};


var kickText = function(reason) {
  var key = Object.prototype.hasOwnProperty.call(KICK_TEXTS, reason) ? reason : 'error';
  return I18n.t(KICK_TEXTS[key]);
};


// A welcome from a server that runs another version of the game: the page is loaded again, once (if that does not
// help, the player is told). Returns false when the game must stop.
var checkBuild = function(welcome) {
  var page = pageBuild();
  if (typeof(welcome.build) !== 'string' || page === '' || welcome.build === page)
    return true;

  var key = 'kawacityBuildReload';
  var mark = welcome.build + '|' + page;
  var reloaded = null;
  try {
    reloaded = window.sessionStorage.getItem(key);
    window.sessionStorage.setItem(key, mark);
  } catch (e) {
    // Without storage, the page may be loaded again more than once
  }

  current.connection.stop();
  if (reloaded === mark) {
    showCard(I18n.t('Disconnected'), I18n.t('The game was updated on the server. Please reload the page.'),
             I18n.t('Back to the lobby'));
    return false;
  }

  backToLobby();
  return false;
};


// Downloads a file from the server (a copy of the city)
var download = function(path, fileName) {
  Api.get(path, {blob: true}).then(function(blob) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function() { URL.revokeObjectURL(url); }, 30000);
  }, function(error) {
    if (current !== null && current.game !== null)
      current.game.notify(errorText(error.code), 'bad');
  });
};


var onWelcome = function(welcome) {
  if (!checkBuild(welcome))
    return;

  var state = current;
  if (state.game !== null) {
    try {
      state.controller.applyWelcome(welcome, now());
    } catch (e) {
      console.error(e);
    }
    state.controller.setStatus('online');
    showReconnecting(false);
    return;
  }

  // The game shows the city as the welcome describes it
  try {
    var city = RemoteCity.fromWelcome(welcome, now());
    state.panel = new PlayersPanel(function(text) {
      return state.controller.sendChat(text);
    }, backToLobby);
    state.controller = new RemoteController(state.connection, city, welcome, {view: state.panel, download: download});

    hideCard();
    state.game = new Game(city.map, assets.tileSet, assets.snowTileSet, assets.spriteSheet, city.simulation.getLevel(),
                          state.controller.cityInfo.name, {controller: state.controller});
    state.panel.setChat(welcome.chat, state.controller.you.id);
    state.controller.setStatus('online');
  } catch (e) {
    console.error(e);
    state.connection.stop();
    showCard(I18n.t('Disconnected'), errorText('internal'), I18n.t('Back to the lobby'));
  }
};


var onMessage = function(message) {
  if (current.game === null)
    return;

  try {
    current.controller.receive(message, now());
  } catch (e) {
    // One message the game could not apply must not stop the others
    console.error(e);
  }
};


var onStatus = function(status) {
  if (status === 'ended' || current.game === null)
    return;

  current.controller.setStatus(status);
  showReconnecting(status === 'reconnecting');
};


// Why the game is still joining the city, on its card (the game tries again meanwhile)
var onTrouble = function(code) {
  if (current.game !== null)
    return;

  if (code === 'refused')
    $('#mpCardText').text(I18n.t('The city cannot be reached for now. Shared cities may be open in too many tabs (3 at most), or the server may be busy or stopped. The game keeps trying.'));
  else
    $('#mpCardText').text(errorText(code));
};


var onEnd = function(kind, code) {
  showReconnecting(false);
  if (current.game !== null)
    current.controller.setStatus('offline');

  if (kind === 'kicked')
    showCard(I18n.t('Disconnected'), kickText(code), I18n.t('OK'));
  else
    showCard(I18n.t('Disconnected'), errorText(code), I18n.t('Back to the lobby'));
};


// Asks the server whether the player is still logged in: callback(false) only when it says not
var checkSession = function(callback) {
  Api.get('/api/session').then(function(data) {
    callback(!(isObject(data) && data.user === null));
  }, function() {
    callback(true);
  });
};


// Plays the shared city with this public id (from the lobby, on the title screen): the title screen goes, the game
// joins the city and shows it once the server welcomed it
var play = function(cityId) {
  if (current !== null || assets === null)
    return false;

  AccountScreens.stop();
  $('#splash, #scenarioPicker, #start').hide();

  $('#mpCardLobby').off('click').on('click', function(e) {
    e.preventDefault();
    backToLobby();
  });
  $('#mpReconnectingLobby').off('click').on('click', function(e) {
    e.preventDefault();
    backToLobby();
  });
  $('#mpScreen').off('keydown').on('keydown', function(e) {
    if (ownKey(e, true))
      $('#mpCardLobby').trigger('focus');
  });
  $('#mpReconnecting').off('keydown').on('keydown', function(e) {
    ownKey(e, false);
  });

  showCard(I18n.t('Shared city'), I18n.t('Joining the city…'), I18n.t('Back to the lobby'));

  if (typeof(cityId) !== 'string' || !CITY_ID.test(cityId)) {
    showCard(I18n.t('Disconnected'), errorText('not_found'), I18n.t('Back to the lobby'));
    return false;
  }

  current = {connection: null, controller: null, panel: null, game: null};
  current.connection = new Connection({
    url: socketURL(window.location),
    city: cityId,
    createSocket: function(url) { return new WebSocket(url); },
    onWelcome: onWelcome,
    onMessage: onMessage,
    onStatus: onStatus,
    onTrouble: onTrouble,
    onEnd: onEnd,
    checkSession: checkSession
  });
  current.connection.start();
  return true;
};


// The game being played, for the browser's console in debug mode (see Config.debug), or null
var playing = function() {
  return current;
};


var Multiplayer = {
  RETRY_FIRST: RETRY_FIRST,
  RETRY_MAX: RETRY_MAX,
  REPLY_TIMEOUT: REPLY_TIMEOUT,
  WELCOME_TIMEOUT: WELCOME_TIMEOUT,
  SESSION_CHECK_AFTER: SESSION_CHECK_AFTER,
  REFUSED_AFTER: REFUSED_AFTER,
  FATAL_JOIN_ERRORS: FATAL_JOIN_ERRORS,
  Connection: Connection,
  backoff: backoff,
  ownKey: ownKey,
  socketURL: socketURL,
  setAssets: setAssets,
  play: play,
  playing: playing,
  backToLobby: backToLobby
};


export { Multiplayer };
