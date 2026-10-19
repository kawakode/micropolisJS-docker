/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// Loaded by index.html as a plain script, without defer, at the end of the page: the loading banner can show while
// the game's bundle downloads. (The Content-Security-Policy allows no inline script.)

// If we got here, then we have script. Note we don't necessarily have jQuery though
[].forEach.call(document.querySelectorAll('[data-hasscript]'), function(elem) {
  elem.setAttribute('data-hasscript', 'true');
});
