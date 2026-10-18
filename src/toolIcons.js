/* KawaCity, a city simulator based on micropolisJS by Graeme McCutcheon.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 * The name/term "MICROPOLIS" is a registered trademark of Micropolis (https://www.micropolis.com) GmbH
 * (Micropolis Corporation, the "licensor") and is licensed here to the authors/publishers of the "Micropolis"
 * city simulation game and its source code (the project or "licensee(s)") as a courtesy of the owner.
 *
 */

import $ from "jquery";

import { I18n } from './i18n.js';
import { PixelIcons } from './pixelIcons.js';

// Each tool's icon shows what it builds, drawn in isometric pixel art (see tools/icon/tool_icons.py): twice as big in
// the palettes, which have room for it
var makeIcon = function(toolName, scale) {
  var icon = PixelIcons.picture('tool', toolName, scale);
  icon.classList.add('toolIcon');
  return icon;
};


// Replaces the text of each tool button with an icon, its name, cost and keyboard shortcut
var decorateToolButtons = function() {
  $('.toolButton').each(function() {
    var button = $(this);
    var key = button.attr('data-key');

    // The button's text is the tool's name, in English
    if (!button.attr('data-name'))
      button.attr('data-name', button.text().trim());

    button.empty();

    button.append(makeIcon(button.attr('data-tool'), button.closest('.toolPalette').length ? 2 : 1));

    button.append($('<span class="toolName"></span>'));

    if (button.attr('data-cost'))
      button.append($('<span class="toolCost"></span>'));

    if (key)
      button.append($('<span class="toolKey" aria-hidden="true"></span>').text(key));

    // What the tool does, shown in the palettes of the tool bar
    if (button.attr('data-description'))
      button.append($('<span class="toolDescription"></span>'));

    button.attr('aria-pressed', 'false');
  });

  labelToolButtons();
};


// Writes the texts of the tool buttons, in the current language
var labelToolButtons = function() {
  $('.toolButton').each(function() {
    var button = $(this);
    var label = I18n.t(button.attr('data-label') || button.attr('data-name'));
    var cost = button.attr('data-cost') ? I18n.money(Number(button.attr('data-cost'))) : '';
    var key = button.attr('data-key');
    var description = button.attr('data-description') ? I18n.t(button.attr('data-description')) : '';

    button.find('.toolName').text(I18n.t(button.attr('data-name')));
    button.find('.toolCost').text(cost);
    button.find('.toolDescription').text(description);

    var title = label + (cost ? ' (' + cost + ')' : '') + (key ? ' [' + key + ']' : '') + (description ? ': ' + description : '');
    button.attr('title', title);
    button.attr('aria-label', title);
  });
};


var ToolIcons = {
  decorateToolButtons: decorateToolButtons,
  makeIcon: makeIcon,
  labelToolButtons: labelToolButtons
};


export { ToolIcons };
