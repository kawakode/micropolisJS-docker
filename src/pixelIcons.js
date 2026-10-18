/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import $ from "jquery";

import { HUD_ICONS, TOOL_ICONS, TOWNS } from './uiIcons.js';

// The pictures of the interface, drawn in pixel art (see tools/icon/generate.py): each is shown as the background of a
// span, cut from its sheet. The sheets are images the page loads, so that a new build brings new ones; they are
// enlarged without smoothing (see .pixelIcon).
var SHEETS = {
  hud: {sheet: HUD_ICONS, image: 'hudIcons'},
  tool: {sheet: TOOL_ICONS, image: 'toolIcons'},
  town: {sheet: TOWNS, image: 'townPictures'}
};


// A span showing a picture of a sheet (kind: hud, tool or town), scale times its size
var picture = function(kind, name, scale) {
  var sheet = SHEETS[kind].sheet;
  var image = document.getElementById(SHEETS[kind].image);
  var at = sheet.at[name];
  scale = scale || 1;

  var span = document.createElement('span');
  span.className = 'pixelIcon';
  span.setAttribute('aria-hidden', 'true');
  span.style.width = span.style.height = sheet.size * scale + 'px';

  if (at && image) {
    span.style.backgroundImage = 'url("' + image.getAttribute('src') + '")';
    span.style.backgroundSize = sheet.width * scale + 'px ' + sheet.height * scale + 'px';
    span.style.backgroundPosition = -at[0] * scale + 'px ' + -at[1] * scale + 'px';
  }

  return span;
};


// Puts its icon before the text of each element with a data-icon attribute (the text must be in an element of its
// own, as translating it replaces it). The windows' titles have them twice as big.
var decorate = function(root) {
  $(root || document).find('[data-icon]').each(function() {
    if ($(this).children('.pixelIcon').length === 0)
      $(this).prepend(picture('hud', $(this).attr('data-icon'), $(this).hasClass('modalHeader') ? 2 : 1));
  });
};


// The picture of a neighbouring city, as big as the city is
var townFor = function(population) {
  if (population < 8000)
    return 'village';
  if (population < 25000)
    return 'town';
  return population < 60000 ? 'city' : 'metropolis';
};


var PixelIcons = {
  decorate: decorate,
  picture: picture,
  townFor: townFor
};


export { PixelIcons };
