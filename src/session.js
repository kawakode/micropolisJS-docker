/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { Api } from './api.js';
import { I18n } from './i18n.js';

// Who is signed in, and what the game's server offers. The game also runs as a static site, without a server: it
// asks GET /api/session once at start, and only an answer of the expected shape, within a few seconds, shows the
// accounts (see AccountScreens). Nothing waits for that answer: the title screen shows at once.
//
// The listeners given to onChange are called with the session (see info) whenever it changes: detection, log in, log
// out, a change to the account.

// The longest wait for the server's first answer
var DETECTION_TIMEOUT = 3000;

// The server's rules, until it gives its own
var DEFAULT_LIMITS = {passwordMin: 12, passwordMax: 128, usernameMin: 3, usernameMax: 20, cityNameMax: 15,
                      ownedCities: 5};

var FEATURES = ['accounts', 'registration', 'mail', 'multiplayer'];

var listeners = [];
var detection = null;
var watchingLanguage = false;

var noFeatures = function() {
  return {accounts: false, registration: false, mail: false, multiplayer: false};
};

var copyOf = function(object) {
  var copy = {};
  Object.keys(object).forEach(function(key) { copy[key] = object[key]; });
  return copy;
};

var state = {
  // Whether the server answered as expected
  available: false,
  user: null,
  features: noFeatures(),
  // The origin the server's pages and links use
  publicUrl: null,
  // Who runs the server, for the privacy screen
  operator: null,
  build: null,
  limits: copyOf(DEFAULT_LIMITS)
};


// The origin of an http(s) address, or null
var originOf = function(url) {
  if (typeof url !== 'string' || typeof URL !== 'function')
    return null;

  try {
    var parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch (e) {
    return null;
  }
};


// The account the server describes ({id, username, email, locale, createdAt}), copied, or null if it is not one
var parseUser = function(user) {
  if (user === null || typeof user !== 'object' || typeof user.id !== 'string' || typeof user.username !== 'string' ||
      typeof user.email !== 'string' || typeof user.locale !== 'string')
    return null;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    locale: user.locale,
    createdAt: typeof user.createdAt === 'number' ? user.createdAt : null
  };
};


// GET /api/session's answer, checked and copied, or null if it is not what the game's server sends
var parse = function(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data))
    return null;

  var features = data.features;
  if (features === null || typeof features !== 'object')
    return null;
  for (var i = 0; i < FEATURES.length; i++) {
    if (typeof features[FEATURES[i]] !== 'boolean')
      return null;
  }

  var user = data.user === null ? null : parseUser(data.user);
  if (data.user !== null && user === null)
    return null;

  var publicUrl = originOf(data.publicUrl);
  if (publicUrl === null)
    return null;

  var limits = copyOf(DEFAULT_LIMITS);
  if (data.limits !== null && typeof data.limits === 'object') {
    Object.keys(DEFAULT_LIMITS).forEach(function(key) {
      var value = data.limits[key];
      if (typeof value === 'number' && Math.floor(value) === value && value > 0)
        limits[key] = value;
    });
  }

  var result = {available: true, user: user, features: noFeatures(), publicUrl: publicUrl,
                operator: typeof data.operator === 'string' && data.operator.trim() ? data.operator.trim() : null,
                build: typeof data.build === 'string' ? data.build : null, limits: limits};
  FEATURES.forEach(function(name) { result.features[name] = features[name]; });
  return result;
};


// A copy of the session: {available, user, features, publicUrl, operator, build, limits}
var info = function() {
  return {
    available: state.available,
    user: state.user ? copyOf(state.user) : null,
    features: copyOf(state.features),
    publicUrl: state.publicUrl,
    operator: state.operator,
    build: state.build,
    limits: copyOf(state.limits)
  };
};


var changed = function() {
  var current = info();
  listeners.forEach(function(listener) { listener(current); });
};


var apply = function(parsed) {
  Object.keys(state).forEach(function(key) { state[key] = parsed[key]; });
  watchLanguage();
  changed();
};


// The account changed (log in, new password, new email address), or the player logged out (null)
var setUser = function(user) {
  if (!state.available)
    return;

  state.user = user === null ? null : parseUser(user);
  changed();
};


// The account's emails are written in the game's language: when it changes, the server is told
var postLocale = function(lang) {
  if (!state.user || state.user.locale === lang)
    return Promise.resolve();

  return Api.post('/api/account/locale', {locale: lang}).then(function(answer) {
    if (answer && answer.user)
      setUser(answer.user);
  }, function(error) {
    if (error.code === 'unauthenticated')
      setUser(null);
  });
};


var watchLanguage = function() {
  if (watchingLanguage)
    return;

  watchingLanguage = true;
  I18n.onChange(postLocale);
};


// Asks the server for the session, once: resolves with true if it answered as expected (otherwise the game has no
// accounts, and nothing changes)
var detect = function() {
  if (detection === null) {
    detection = Api.get('/api/session', {timeout: DETECTION_TIMEOUT, status: 200}).then(function(data) {
      var parsed = parse(data);
      if (parsed === null)
        return false;
      apply(parsed);
      return true;
    }, function() {
      return false;
    });
  }

  return detection;
};


// Asks the server again (after a change it does not report, or an error that may mean the session ended)
var refresh = function() {
  if (!state.available)
    return Promise.resolve(info());

  return Api.get('/api/session').then(function(data) {
    var parsed = parse(data);
    if (parsed !== null)
      apply(parsed);
    return info();
  });
};


var onChange = function(listener) {
  listeners.push(listener);
};


// Whether the accounts can be used from this page: the server's cookies and checks only work on its own origin
var isPublicOrigin = function(origin) {
  return state.publicUrl !== null && origin === state.publicUrl;
};


var Session = {
  DEFAULT_LIMITS: DEFAULT_LIMITS,
  DETECTION_TIMEOUT: DETECTION_TIMEOUT,
  parse: parse,
  detect: detect,
  refresh: refresh,
  info: info,
  setUser: setUser,
  postLocale: postLocale,
  onChange: onChange,
  isPublicOrigin: isPublicOrigin
};


export { Session };
