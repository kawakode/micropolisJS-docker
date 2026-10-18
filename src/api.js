/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { ERROR_TEXTS, FIELD_TEXTS } from './apiErrors.js';

// Requests to the game's server (accounts and multiplayer), which answers under /api/ on the page's own origin with
// JSON. A request resolves with the answer's JSON (null for an answer without content), and rejects with an error
// {code, fields, status, retryAfter}:
// - code: a key of ERROR_TEXTS (see apiErrors.js): the server's code, or 'network' when the server could not be
//   reached, or 'timeout' when it did not answer in time;
// - fields: {field: reason} for the fields of a form the server refused, each reason a key of FIELD_TEXTS;
// - status: the HTTP status, or 0 without an answer;
// - retryAfter: the seconds to wait before trying again, when the server says so, or null.
//
// The session cookie is set by the server and never read here: GET /api/session tells who is signed in.

var TIMEOUT = 10000;

var has = function(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
};


var failure = function(code, status, fields, retryAfter) {
  return {code: code, fields: fields || {}, status: status || 0, retryAfter: retryAfter === undefined ? null : retryAfter};
};


// The code of an answer that does not say what went wrong (a proxy's error page, for instance)
var codeForStatus = function(status) {
  switch (status) {
    case 400: return 'invalid_input';
    case 401: return 'unauthenticated';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 405: return 'method_not_allowed';
    case 409: return 'conflict';
    case 413: return 'payload_too_large';
    case 415: return 'unsupported_media_type';
    case 429: return 'rate_limited';
    // A reverse proxy whose server is down or slow
    case 502: return 'network';
    case 504: return 'timeout';
    case 503: return 'server_busy';
    default: return status >= 400 && status < 500 ? 'invalid_input' : 'internal';
  }
};


// The Retry-After header, in seconds
var retryAfter = function(response) {
  var value = response.headers.get('Retry-After');
  if (value === null)
    return null;

  value = value.trim();
  if (/^[0-9]+$/.test(value))
    return parseInt(value, 10);

  var date = Date.parse(value);
  return isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
};


var isJson = function(response) {
  return /^application\/json\s*(;|$)/i.test(response.headers.get('Content-Type') || '');
};


// The error an answer reports: only codes and reasons the game knows are kept
var readError = function(response) {
  var after = retryAfter(response);
  var fallback = failure(codeForStatus(response.status), response.status, {}, after);
  if (!isJson(response))
    return Promise.resolve(fallback);

  return response.json().then(function(body) {
    var error = body !== null && typeof body === 'object' ? body.error : null;
    if (error === null || typeof error !== 'object' || typeof error.code !== 'string' || !has(ERROR_TEXTS, error.code))
      return fallback;

    var fields = {};
    if (error.fields !== null && typeof error.fields === 'object') {
      Object.keys(error.fields).forEach(function(name) {
        var reason = error.fields[name];
        if (typeof reason === 'string' && has(FIELD_TEXTS, reason))
          fields[name] = reason;
      });
    }

    return failure(error.code, response.status, fields, after);
  }, function() {
    return fallback;
  });
};


// Sends a request: path is absolute (/api/...), body is sent as JSON unless it is null or undefined. Options:
// timeout (ms, 10 s by default), status (the only success status accepted), blob (resolve with the answer's content
// as a Blob instead of its JSON).
var request = function(method, path, body, options) {
  options = options || {};

  var init = {method: method, credentials: 'same-origin', cache: 'no-store', headers: {'Accept': 'application/json'}};
  if (body !== undefined && body !== null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  if (controller)
    init.signal = controller.signal;

  return new Promise(function(resolve, reject) {
    var settled = false;
    var timer = setTimeout(function() {
      settled = true;
      if (controller)
        controller.abort();
      reject(failure('timeout'));
    }, options.timeout || TIMEOUT);

    var finish = function(callback, value) {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };

    var answer;
    try {
      answer = fetch(path, init);
    } catch (e) {
      answer = Promise.reject(e);
    }

    answer.then(function(response) {
      if (!response.ok)
        return readError(response).then(function(error) { throw error; });

      if (options.status !== undefined && response.status !== options.status)
        throw failure('internal', response.status);

      if (options.blob)
        return response.blob();

      if (response.status === 204)
        return null;

      // Something else answers here: a static host's page, for instance
      if (!isJson(response))
        throw failure('internal', response.status);

      return response.json().catch(function() {
        throw failure('internal', response.status);
      });
    }).then(function(result) {
      finish(resolve, result);
    }, function(error) {
      // fetch itself fails only when there is no answer
      finish(reject, error !== null && typeof error === 'object' && typeof error.code === 'string' &&
                     has(ERROR_TEXTS, error.code) ? error : failure('network'));
    });
  });
};


var get = function(path, options) {
  return request('GET', path, null, options);
};


// Every POST sends JSON, an empty object when there is nothing to say (the server refuses anything else)
var post = function(path, body, options) {
  return request('POST', path, body === undefined || body === null ? {} : body, options);
};


var Api = {
  TIMEOUT: TIMEOUT,
  failure: failure,
  request: request,
  get: get,
  post: post
};


export { Api };
