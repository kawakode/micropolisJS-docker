/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// Lengths the game's forms check as the server does (sent to the game by GET /api/session), in Unicode code points
export const LIMITS = Object.freeze({
  passwordMin: 12,
  passwordMax: 128,
  usernameMin: 3,
  usernameMax: 20,
  cityNameMax: 15,
});

// Request body sizes
export const BODY_LIMIT = 16 * 1024;
export const UPLOAD_BODY_LIMIT = 1024 * 1024;
