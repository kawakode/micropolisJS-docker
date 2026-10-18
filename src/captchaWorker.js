/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// The worker that solves the server's captcha (a proof of work) away from the page. A placeholder until the captcha
// is written: it answers that it has nothing to do.

self.onmessage = function() {
  self.postMessage({type: 'unavailable'});
};
