/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { Api } from './api.js';
import { Sha256 } from './sha256.js';

// The check that a player is not a robot, built into the game's server (no third party): a proof of work. The
// server's challenge (GET /api/captcha?action=...) is {algorithm: 'SHA-256', salt, challenge, maxnumber, signature},
// where challenge is the SHA-256 of the salt followed by a secret number from 0 to maxnumber. The game finds the
// number by trying them all (see Sha256), in a worker (captchaWorker.js) or else in the page, and sends the challenge
// back with it: {salt, challenge, maxnumber, number, signature}. Each answer is good for one request, within 10
// minutes of the challenge.
//
// A Captcha prepares the answers of one form: start() when the form shows (the work begins at once, so the answer is
// usually ready before the form is filled in), take() when it is sent, renew() if the form stays, stop() when it
// hides. onChange(state, detail) is told each state: 'idle', 'solving' (detail: the part tried, from 0 to 1), 'ready',
// or 'error' (detail: the error, as Api reports them).

var ACTIONS = ['register', 'login', 'forgot'];

// The server's challenges expire after 10 minutes: an answer not sent by then is replaced
var REFRESH = 9 * 60 * 1000;

// Without a worker, the page works in slices this long (ms), and lets the browser draw in between
var SLICE = 12;
var SLICE_TRIES = 500;

// The largest challenge the game accepts: far more than the server ever asks for
var MAX_NUMBER = 100000000;

var HEX_64 = /^[0-9a-f]{64}$/;


// The server's challenge, checked and copied, or null if it is not one
var parseChallenge = function(data) {
  if (data === null || typeof data !== 'object' || data.algorithm !== 'SHA-256' || typeof data.salt !== 'string' ||
      data.salt.length === 0 || data.salt.length > 256 || typeof data.challenge !== 'string' ||
      !HEX_64.test(data.challenge) || typeof data.signature !== 'string' || data.signature.length === 0 ||
      data.signature.length > 256 || typeof data.maxnumber !== 'number' ||
      Math.floor(data.maxnumber) !== data.maxnumber || data.maxnumber < 0 || data.maxnumber > MAX_NUMBER)
    return null;

  return {algorithm: data.algorithm, salt: data.salt, challenge: data.challenge, maxnumber: data.maxnumber,
          signature: data.signature};
};


// The page's build, which names the worker's script (the browser keeps it as long as the build is the same)
var build = function() {
  if (typeof document === 'undefined')
    return '';

  var picker = document.getElementById('scenarioPicker');
  return picker ? picker.getAttribute('data-version') || '' : '';
};


// Solves in the page, a slice at a time. progress(tried) is called between slices, done(number) at the end (-1 if no
// number fits). Returns a function that stops the work.
var solveInPage = function(challenge, progress, done) {
  var searcher = new Sha256.Searcher(challenge.salt, challenge.challenge);
  var start = 0;
  var timer = null;

  var slice = function() {
    timer = null;
    var began = Date.now();
    while (start <= challenge.maxnumber) {
      var end = Math.min(start + SLICE_TRIES, challenge.maxnumber + 1);
      var number = searcher.search(start, end);
      start = end;
      if (number >= 0) {
        done(number);
        return;
      }
      if (Date.now() - began >= SLICE)
        break;
    }

    if (start > challenge.maxnumber) {
      done(-1);
      return;
    }

    progress(start);
    timer = setTimeout(slice, 0);
  };

  timer = setTimeout(slice, 0);
  return function() {
    if (timer !== null)
      clearTimeout(timer);
    timer = null;
  };
};


// Solves in a worker, or in the page if workers are missing or fail (see solveInPage)
var solve = function(challenge, progress, done) {
  var stopPage = null;
  var worker = null;

  var inPage = function() {
    if (worker !== null)
      worker.terminate();
    worker = null;
    stopPage = solveInPage(challenge, progress, done);
  };

  if (typeof Worker === 'undefined') {
    inPage();
  } else {
    try {
      worker = new Worker('src/captchaWorker.js?v=' + encodeURIComponent(build()));
    } catch (e) {
      worker = null;
    }

    if (worker === null) {
      inPage();
    } else {
      worker.onmessage = function(e) {
        var message = e.data || {};
        if (message.type === 'progress') {
          progress(message.tried);
        } else if (message.type === 'solved' && typeof message.number === 'number') {
          worker.terminate();
          worker = null;
          done(message.number);
        } else if (message.type === 'failed') {
          worker.terminate();
          worker = null;
          done(-1);
        } else {
          // A worker that cannot do it (an older one, say): the page does it
          inPage();
        }
      };
      // The script could not be loaded, or failed
      worker.onerror = function(e) {
        if (e && e.preventDefault)
          e.preventDefault();
        inPage();
      };
      worker.postMessage({salt: challenge.salt, challenge: challenge.challenge, maxnumber: challenge.maxnumber});
    }
  }

  return function() {
    if (worker !== null)
      worker.terminate();
    worker = null;
    if (stopPage !== null)
      stopPage();
    stopPage = null;
  };
};


// The answers of one form (see above). action is 'register', 'login' or 'forgot'.
function Captcha(action, onChange) {
  if (ACTIONS.indexOf(action) === -1)
    throw new Error('Unknown captcha action ' + action);

  this.action = action;
  this.state = 'idle';
  this._onChange = onChange || function() {};
  this._active = false;
  // {payload, fetchedAt}: the answer ready to be sent
  this._solution = null;
  // The answer being prepared: {promise, cancel}
  this._pending = null;
  this._refreshTimer = null;
}


Captcha.prototype._setState = function(state, detail) {
  this.state = state;
  this._onChange(state, detail);
};


Captcha.prototype._clearRefresh = function() {
  if (this._refreshTimer !== null)
    clearTimeout(this._refreshTimer);
  this._refreshTimer = null;
};


var isFresh = function(solution) {
  return solution !== null && Date.now() - solution.fetchedAt < REFRESH;
};


// While the form shows, its answer is replaced when its challenge is about to expire
Captcha.prototype._watchExpiry = function() {
  var solution = this._solution;
  this._clearRefresh();
  if (solution === null || !this._active)
    return;

  this._refreshTimer = setTimeout(function() {
    this._refreshTimer = null;
    if (this._solution !== solution)
      return;
    this._solution = null;
    this._prepare().catch(function() {});
  }.bind(this), Math.max(0, solution.fetchedAt + REFRESH - Date.now()));
};


// Fetches a challenge and solves it: a promise of the answer
Captcha.prototype._prepare = function() {
  if (this._pending !== null)
    return this._pending.promise;

  var pending = {cancel: null, cancelled: false};
  this._pending = pending;
  this._setState('solving', 0);

  var fetchedAt = Date.now();
  pending.promise = Api.get('/api/captcha?action=' + this.action).then(function(data) {
    var challenge = parseChallenge(data);
    if (challenge === null)
      throw Api.failure('internal');
    if (pending.cancelled)
      throw Api.failure('cancelled');

    return new Promise(function(resolve, reject) {
      pending.reject = reject;
      pending.cancel = solve(challenge, function(tried) {
        if (!pending.cancelled)
          this._setState('solving', Math.min(1, tried / (challenge.maxnumber + 1)));
      }.bind(this), function(number) {
        pending.cancel = null;
        if (number < 0) {
          reject(Api.failure('captcha_failed'));
          return;
        }
        resolve({salt: challenge.salt, challenge: challenge.challenge, maxnumber: challenge.maxnumber,
                 number: number, signature: challenge.signature});
      });
    }.bind(this));
  }.bind(this)).then(function(payload) {
    if (this._pending === pending) {
      this._pending = null;
      this._solution = {payload: payload, fetchedAt: fetchedAt};
      this._watchExpiry();
      this._setState('ready');
    }
    return payload;
  }.bind(this), function(error) {
    if (this._pending === pending) {
      this._pending = null;
      this._setState('error', error);
    }
    throw error;
  }.bind(this));

  return pending.promise;
};


// The form shows: an answer is prepared, unless one is ready
Captcha.prototype.start = function() {
  this._active = true;
  if (isFresh(this._solution)) {
    this._watchExpiry();
    this._setState('ready');
  } else {
    this._solution = null;
    this._prepare().catch(function() {});
  }
};


// The form hides: the work stops (a ready answer is kept for next time, if it is still fresh then)
Captcha.prototype.stop = function() {
  this._active = false;
  this._clearRefresh();
  var pending = this._pending;
  if (pending !== null) {
    this._pending = null;
    pending.cancelled = true;
    if (pending.cancel)
      pending.cancel();
    if (pending.reject)
      pending.reject(Api.failure('cancelled'));
    this._setState('idle');
  }
};


// The answer for one request: a promise, at once if it is ready. It is used up: renew() prepares the next.
Captcha.prototype.take = function() {
  var solution = this._solution;
  this._solution = null;
  this._clearRefresh();

  if (isFresh(solution)) {
    this._setState('idle');
    return Promise.resolve(solution.payload);
  }

  return this._prepare().then(function(payload) {
    if (this._solution !== null && this._solution.payload === payload) {
      this._solution = null;
      this._clearRefresh();
      this._setState('idle');
    }
    return payload;
  }.bind(this));
};


// After a request: the next answer is prepared, if the form is still there
Captcha.prototype.renew = function() {
  if (this._active && this._solution === null)
    this._prepare().catch(function() {});
};


Captcha.ACTIONS = ACTIONS;
Captcha.REFRESH = REFRESH;
Captcha.parseChallenge = parseChallenge;
Captcha.solve = solve;
Captcha.solveInPage = solveInPage;


export { Captcha };
