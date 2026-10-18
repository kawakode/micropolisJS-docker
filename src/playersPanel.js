/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import $ from "jquery";

import { I18n } from './i18n.js';
import { TextRules } from './textRules.js';

// The panel of a shared city's players, opened from the heads-up display's Players button: who belongs to the city
// (name, role, colour, online or not), the chat, the state of the connection, and the way back to the lobby. It is
// not a window of the game (see ModalWindow): it never pauses or blocks anything, and Escape closes it. Every text
// that comes from the server or from players is put in the page as text (never as HTML), and names are isolated in
// <bdi> so that a name written right to left does not reorder the text around it.

// The longest chat message, in characters, as the server takes it
var MAX_CHAT = 300;

// The most lines the chat log keeps
var LOG_LIMIT = 200;

var ROLES = ['owner', 'player', 'viewer'];
var STATUSES = ['connecting', 'online', 'reconnecting', 'offline'];
var COLOUR = /^#[0-9a-f]{6}$/i;
var DEFAULT_COLOUR = '#f8f8ff';
var MAX_NAME = 40;


var isObject = function(value) {
  return value !== null && typeof(value) === 'object' && !Array.isArray(value);
};


// A chat message as the server takes it (see TextRules): in NFC, without control and format characters nor others that
// show nothing, trimmed, at most MAX_CHAT characters. '' when nothing that shows is left.
var cleanChat = function(text) {
  var cleaned = TextRules.clean(text);
  var characters = Array.from(cleaned);
  if (characters.length > MAX_CHAT)
    cleaned = characters.slice(0, MAX_CHAT).join('').trim();

  return TextRules.shows(cleaned) ? cleaned : '';
};


// A name from the server, made safe to show: without control and format characters, not too long
var cleanName = function(name) {
  if (typeof(name) !== 'string')
    return '';

  return Array.from(name.replace(/[\p{Cc}\p{Cf}]/gu, '')).slice(0, MAX_NAME).join('');
};


var colourOf = function(colour) {
  return typeof(colour) === 'string' && COLOUR.test(colour) ? colour.toLowerCase() : DEFAULT_COLOUR;
};


// A player of the players message, checked: {id, username, role, colour, online}, or null
var player = function(entry) {
  if (!isObject(entry) || typeof(entry.id) !== 'string' || entry.id === '' || cleanName(entry.username) === '')
    return null;

  return {id: entry.id, username: cleanName(entry.username), role: ROLES.indexOf(entry.role) === -1 ? 'viewer' : entry.role,
          colour: colourOf(entry.colour), online: entry.online === true};
};


// A message of the chat, checked: {id, username, colour, text, at}, or null
var chatEntry = function(message) {
  if (!isObject(message) || !isObject(message.from) || typeof(message.from.id) !== 'string')
    return null;

  var username = cleanName(message.from.username);
  var text = typeof(message.text) === 'string' ? message.text.replace(/[\p{Cc}\p{Cf}]/gu, '').trim() : '';
  if (username === '' || text === '')
    return null;

  return {id: message.from.id, username: username, colour: colourOf(message.from.colour),
          text: Array.from(text).slice(0, MAX_CHAT).join(''),
          at: typeof(message.at) === 'number' && isFinite(message.at) ? message.at : null};
};


// A translated sentence in parts, so that each value can be put in an element of its own (a name in a <bdi>):
// [{text}, {key, value}, ...]. template: the translated text, with {key} where each value of values goes.
var parts = function(template, values) {
  var result = [];
  template.split(/\{(\w+)\}/).forEach(function(piece, i) {
    if (i % 2 === 1 && Object.prototype.hasOwnProperty.call(values, piece))
      result.push({key: piece, value: values[piece]});
    else if (i % 2 === 1)
      result.push({text: '{' + piece + '}'});
    else if (piece !== '')
      result.push({text: piece});
  });

  return result;
};


// The time of a message, as hours and minutes of the player's clock
var timeOf = function(at) {
  if (at === null)
    return '';

  var date = new Date(at);
  var pad = function(n) { return (n < 10 ? '0' : '') + n; };
  return pad(date.getHours()) + ':' + pad(date.getMinutes());
};


var roleText = function(role) {
  switch (role) {
    case 'owner':
      return I18n.t('role|Owner');

    case 'player':
      return I18n.t('role|Player');

    default:
      return I18n.t('role|Viewer');
  }
};


var statusText = function(status) {
  switch (status) {
    case 'online':
      return I18n.t('Connected');

    case 'reconnecting':
      return I18n.t('Reconnecting…');

    case 'offline':
      return I18n.t('Disconnected');

    default:
      return I18n.t('Connecting…');
  }
};


// onSend(text): sends a chat message, and returns whether it went; onBack(): goes back to the lobby
function PlayersPanel(onSend, onBack) {
  this._onSend = onSend;
  this._onBack = onBack;
  this._players = [];
  this._ownId = null;
  this._role = 'viewer';
  this._status = 'connecting';
  this._unread = 0;
  this._lines = 0;
  this._newest = null;

  this._panel = $('#playersPanel');
  this._button = $('#playersRequest');

  var self = this;
  this._button.on('click', function(e) {
    e.preventDefault();
    self.toggle();
  });
  $('#playersClose').on('click', function(e) {
    e.preventDefault();
    self.close();
  });
  $('#backToLobby').on('click', function(e) {
    e.preventDefault();
    self._onBack();
  });
  $('#chatForm').on('submit', function(e) {
    e.preventDefault();
    self._send();
  });

  // The game's keyboard shortcuts are for the map: none of them acts while the panel has the focus
  this._panel.on('keydown', function(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      self.close();
    }
    e.stopPropagation();
  });
}


// The panel's button appears in the heads-up display
PlayersPanel.prototype.show = function() {
  this._button.removeClass('hidden');
  this._renderButton();
};


PlayersPanel.prototype.isOpen = function() {
  return !this._panel.hasClass('hidden');
};


PlayersPanel.prototype.open = function() {
  if (this.isOpen())
    return;

  this._panel.removeClass('hidden');
  this._button.attr('aria-expanded', 'true');
  this._unread = 0;
  this._renderButton();
  this._scrollLog();
  $('#chatInput').trigger('focus');
};


PlayersPanel.prototype.close = function() {
  if (!this.isOpen())
    return;

  var focusWasInside = this._panel.find(':focus').length > 0;
  this._panel.addClass('hidden');
  this._button.attr('aria-expanded', 'false');
  if (focusWasInside)
    this._button.trigger('focus');
};


PlayersPanel.prototype.toggle = function() {
  if (this.isOpen())
    this.close();
  else
    this.open();
};


// players: the players message's list; ownId: our id
PlayersPanel.prototype.setPlayers = function(list, ownId) {
  this._ownId = ownId;
  this._players = (Array.isArray(list) ? list : []).map(player).filter(function(p) { return p !== null; });
  this._renderPlayers();
};


PlayersPanel.prototype._renderPlayers = function() {
  var list = $('#playersList').empty();
  var ownId = this._ownId;

  this._players.forEach(function(p) {
    var item = $('<li class="playerItem"></li>').toggleClass('offline', !p.online);
    $('<span class="playerSwatch" aria-hidden="true"></span>').css('background-color', p.colour).appendTo(item);
    var name = $('<span class="playerName"></span>').appendTo(item);
    $('<bdi></bdi>').text(p.username).appendTo(name);
    if (p.id === ownId)
      $('<span class="playerYou"></span>').text(' ' + I18n.t('(you)')).appendTo(name);
    $('<span class="playerRole"></span>').text(roleText(p.role)).appendTo(item);
    $('<span class="playerOnline"></span>').text(p.online ? I18n.t('online') : I18n.t('offline')).appendTo(item);
    list.append(item);
  });
};


// The chat of a welcome. The first fills the log; after a reconnection, only the messages after the newest one already
// shown are added (the log is read out as it grows: what it said is not said again, nor are its notices lost), and
// they count as unread.
PlayersPanel.prototype.setChat = function(messages, ownId) {
  this._ownId = ownId;
  var newest = this._newest;

  (Array.isArray(messages) ? messages : []).forEach(function(message) {
    var entry = chatEntry(message);
    if (entry === null || (newest !== null && (entry.at === null || entry.at <= newest)))
      return;

    this._addLine(entry, newest !== null);
  }, this);
};


// A message of the chat. Returns whether it was shown.
PlayersPanel.prototype.addChat = function(message) {
  var entry = chatEntry(message);
  if (entry === null)
    return false;

  this._addLine(entry, true);
  return true;
};


PlayersPanel.prototype._addLine = function(entry, unread) {
  var line = $('<p class="chatLine"></p>');
  if (entry.at !== null)
    $('<span class="chatTime"></span>').text(timeOf(entry.at)).appendTo(line);

  parts(I18n.t('{name}: {message}'), {name: entry.username, message: entry.text}).forEach(function(part) {
    if (part.key === 'name')
      $('<bdi class="chatName"></bdi>').text(part.value).css('color', entry.colour).appendTo(line);
    else if (part.key === 'message')
      $('<span class="chatText"></span>').text(part.value).appendTo(line);
    else
      $('<span></span>').text(part.text).appendTo(line);
  });
  this._appendLine(line);

  if (entry.at !== null && (this._newest === null || entry.at > this._newest))
    this._newest = entry.at;

  if (unread && entry.id !== this._ownId && !this.isOpen()) {
    this._unread++;
    this._renderButton();
  }
};


// A line of the log about a player (who joined, or left): template is the translated text, with {name}
PlayersPanel.prototype.addNotice = function(template, name) {
  var line = $('<p class="chatLine chatNotice"></p>');
  parts(template, {name: cleanName(name)}).forEach(function(part) {
    if (part.key === 'name')
      $('<bdi></bdi>').text(part.value).appendTo(line);
    else
      $('<span></span>').text(part.text).appendTo(line);
  });
  this._appendLine(line);
};


PlayersPanel.prototype._appendLine = function(line) {
  var log = $('#chatLog');
  log.append(line);
  this._lines++;
  while (this._lines > LOG_LIMIT) {
    log.children().first().remove();
    this._lines--;
  }
  this._scrollLog();
};


PlayersPanel.prototype._scrollLog = function() {
  var log = $('#chatLog')[0];
  if (log)
    log.scrollTop = log.scrollHeight;
};


PlayersPanel.prototype._send = function() {
  var input = $('#chatInput');
  var text = cleanChat(input.val());
  if (text === '')
    return;

  if (this._onSend(text))
    input.val('');
};


// The connection: 'connecting', 'online', 'reconnecting' or 'offline'
PlayersPanel.prototype.setStatus = function(status) {
  this._status = STATUSES.indexOf(status) === -1 ? 'connecting' : status;
  this._renderStatus();
  this._renderButton();
};


PlayersPanel.prototype.setRole = function(role) {
  this._role = ROLES.indexOf(role) === -1 ? 'viewer' : role;
  this._renderStatus();
};


PlayersPanel.prototype._renderStatus = function() {
  $('#playersStatus').text(statusText(this._status));
  $('#playersConnection').attr('data-status', this._status);
  $('#playersRole').text(this._role === 'viewer' ?
    I18n.t('You are watching this city: you can chat, and look at it with the query tool.') :
    I18n.t('Your role: {role}', {role: roleText(this._role)}));
};


PlayersPanel.prototype._renderButton = function() {
  var unread = this._unread;
  var badge = $('#playersUnread');
  badge.text(unread > 99 ? '99+' : String(unread)).toggleClass('hidden', unread === 0);
  this._button.attr('data-status', this._status);

  var label = unread === 0 ? I18n.t('Players') :
              unread === 1 ? I18n.t('Players (1 new message)') :
              I18n.t('Players ({count} new messages)', {count: unread});
  this._button.attr({'aria-label': label + ' — ' + statusText(this._status),
                     title: label + ' — ' + statusText(this._status)});
};


// Shows everything again in the new language
PlayersPanel.prototype.translate = function() {
  this._renderPlayers();
  this._renderStatus();
  this._renderButton();
};


PlayersPanel.prototype.unread = function() {
  return this._unread;
};


PlayersPanel.MAX_CHAT = MAX_CHAT;
PlayersPanel.LOG_LIMIT = LOG_LIMIT;
PlayersPanel.ROLES = ROLES;
PlayersPanel.cleanChat = cleanChat;
PlayersPanel.cleanName = cleanName;
PlayersPanel.chatEntry = chatEntry;
PlayersPanel.player = player;
PlayersPanel.parts = parts;
PlayersPanel.roleText = roleText;
PlayersPanel.statusText = statusText;
PlayersPanel.timeOf = timeOf;


export { PlayersPanel };
