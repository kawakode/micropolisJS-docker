/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// What the game's forms check as the server does (sent to the game by GET /api/session): lengths, in Unicode code
// points, and how many shared cities a player may own (those of regions included)
export const LIMITS = Object.freeze({
  passwordMin: 12,
  passwordMax: 128,
  usernameMin: 3,
  usernameMax: 20,
  cityNameMax: 15,
  ownedCities: 5,
});

// Request body sizes
export const BODY_LIMIT = 16 * 1024;
export const UPLOAD_BODY_LIMIT = 1024 * 1024;
