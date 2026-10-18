/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { Sha256 } from './sha256.js';

// The worker that solves the server's check that a player is not a robot (see Captcha), away from the page so that
// it stays responsive. It receives {salt, challenge, maxnumber}, tries the numbers from 0 to maxnumber in batches, and
// posts {type: 'progress', tried} after each batch, then {type: 'solved', number}, or {type: 'failed'} if no number
// fits. The page ends it with terminate() when it no longer needs the answer.

var BATCH = 5000;

// The largest challenge the worker accepts: far more than the server ever asks for
var MAX_NUMBER = 100000000;

var valid = function(data) {
  return data !== null && typeof data === 'object' && typeof data.salt === 'string' && data.salt.length <= 256 &&
         typeof data.challenge === 'string' && /^[0-9a-f]{64}$/.test(data.challenge) &&
         typeof data.maxnumber === 'number' && Math.floor(data.maxnumber) === data.maxnumber &&
         data.maxnumber >= 0 && data.maxnumber <= MAX_NUMBER;
};

self.onmessage = function(e) {
  var data = e.data;
  if (!valid(data)) {
    self.postMessage({type: 'failed'});
    return;
  }

  var searcher = new Sha256.Searcher(data.salt, data.challenge);
  for (var start = 0; start <= data.maxnumber; start += BATCH) {
    var end = Math.min(start + BATCH, data.maxnumber + 1);
    var number = searcher.search(start, end);
    if (number >= 0) {
      self.postMessage({type: 'solved', number: number});
      return;
    }
    if (end <= data.maxnumber)
      self.postMessage({type: 'progress', tried: end});
  }

  self.postMessage({type: 'failed'});
};
