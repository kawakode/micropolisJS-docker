/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import $ from "jquery";

import { I18n } from './i18n.js';
import { ToolIcons } from './toolIcons.js';

// The tool bar: the zones and the query tool are always at hand; everything else is grouped in categories (the
// bulldozer's sizes too). Clicking a category takes up its last used tool, and opens a palette of all the category's tools.
//
// Each tool has a button of class toolButton, which InputStatus listens to, carrying the tool's details in data
// attributes: its size (for the preview), colour, label, cost and keyboard shortcut. ToolIcons then decorates
// the buttons.

var TOOLS = {
  bulldozer: {name: 'Bulldozer 1x1', size: 1, brush: 1, cost: 1, colour: '#fb7185', key: 'B',
              description: 'Clears a tile, or the area you drag over. Click any tile of a building to demolish it all.'},
  bulldozer3: {name: 'Bulldozer 3x3', size: 1, brush: 3, cost: 1, colour: '#fb7185',
               description: 'Clears 3x3 tiles around the cursor: drag it like a brush. $1 a tile.'},
  bulldozer5: {name: 'Bulldozer 5x5', size: 1, brush: 5, cost: 1, colour: '#fb7185',
               description: 'Clears 5x5 tiles around the cursor. Press B again to change size.'},
  bulldozer7: {name: 'Bulldozer 7x7', size: 1, brush: 7, cost: 1, colour: '#fb7185',
               description: 'Clears 7x7 tiles around the cursor: for wide demolitions.'},

  road: {name: 'Street', size: 1, cost: 10, colour: '#94a3b8', key: '4',
         description: 'The ordinary road. Bridges water for $50 a tile.'},
  dirtroad: {name: 'Dirt road', size: 1, cost: 4, colour: '#b08850',
             description: 'Cheap and nearly free to keep up, but it jams quickly, slows trips down and can\'t cross water.'},
  avenue: {name: 'Avenue', size: 1, cost: 25, colour: '#e2e8f0',
           description: 'Carries twice the traffic of a street. Twice the upkeep.'},
  highway: {name: 'Highway', size: 1, cost: 40, colour: '#facc15',
            description: 'Carries four times the traffic, and trips go twice as far. No access to buildings beside it: join it from other roads.'},
  rail: {name: 'Rail', size: 1, cost: 20, colour: '#c2410c', key: '5',
         description: 'Mass transit: trips use it without jamming the roads.'},
  port: {name: 'Seaport', size: 4, cost: 3000, colour: '#0ea5e9',
         description: 'Industry needs one to grow beyond a small town.'},
  airport: {name: 'Airport', size: 6, cost: 10000, colour: '#e879f9',
            description: 'Commerce needs one to grow beyond a large city.'},

  wire: {name: 'Power line', size: 1, cost: 5, colour: '#fde68a', key: '6',
         description: 'Carries power to zones that don\'t touch a powered zone.'},
  wind: {name: 'Wind turbine', size: 1, cost: 300, colour: '#e0f2fe',
         description: '50 MW, clean, more when it is windy. Build them in fields.'},
  solar: {name: 'Solar farm', size: 3, cost: 2000, colour: '#3b82f6',
          description: '400 MW, clean. Less in winter and under snow.'},
  gas: {name: 'Gas plant', size: 3, cost: 2000, colour: '#cbd5e1',
        description: '500 MW, a little pollution.'},
  coal: {name: 'Coal plant', size: 4, cost: 3000, colour: '#9ca3af',
         description: '700 MW, heavy pollution.'},
  nuclear: {name: 'Nuclear plant', size: 4, cost: 5000, colour: '#f0abfc',
            description: '2000 MW, clean, but it may melt down.'},

  police: {name: 'tool|Police', size: 3, cost: 500, colour: '#1d4ed8', key: '8',
           description: 'Lowers crime around it. $100 a year.'},
  fire: {name: 'Fire station', size: 3, cost: 500, colour: '#dc2626', key: '9',
         description: 'Puts fires out faster around it. $100 a year.'},
  school: {name: 'School', size: 3, cost: 1000, colour: '#f97316',
           description: 'Raises land values and lowers crime nearby. $100 a year.'},
  hospital: {name: 'Hospital', size: 3, cost: 1500, colour: '#f43f5e',
             description: 'Heals the neighbourhood: homes grow better and land is worth more. $150 a year.'},
  university: {name: 'University', size: 4, cost: 3000, colour: '#38bdf8',
               description: 'Like a school, twice as strong and further reaching. $250 a year.'},

  park: {name: 'Park', size: 1, cost: 10, colour: '#16a34a', key: '7',
         description: 'A few trees or a fountain: raises land values.'},
  garden: {name: 'Garden', size: 1, cost: 25, colour: '#f472b6',
           description: 'Flower beds: raise land values a little more.'},
  plaza: {name: 'Plaza', size: 1, cost: 40, colour: '#e2e8f0',
          description: 'A paved square with a fountain, for city centres.'},
  bigpark: {name: 'Big park', size: 3, cost: 400, colour: '#22c55e',
            description: 'Lawns, trees and a pond: a boost to land values around it.'},
  stadium: {name: 'Stadium', size: 4, cost: 5000, colour: '#a78bfa',
            description: 'Residents need one as the city grows.'},

  trees: {name: 'Trees', size: 1, cost: 5, colour: '#15803d', key: 'T',
          description: 'Plant a forest on bare land.'},
  water: {name: 'Dig water', size: 1, cost: 100, colour: '#2563eb',
          description: 'Dig a lake or a canal.'},
  landfill: {name: 'Landfill', size: 1, cost: 60, colour: '#a16207',
             description: 'Fill water in, to build on it.'}
};

// A category is built in the tool bar's group of categories, unless it names another holder
// key: the keyboard shortcut that goes through the category's tools, pressed again and again (its code: see
// InputStatus.setToolCycles)
var CATEGORIES = [
  {id: 'bulldozer', name: 'Bulldozer', holder: '#basicButtons', key: 'B', code: 'KeyB',
   tools: ['bulldozer', 'bulldozer3', 'bulldozer5', 'bulldozer7']},
  {id: 'transport', name: 'Transport', key: '4', code: 'Digit4',
   tools: ['road', 'dirtroad', 'avenue', 'highway', 'rail', 'port', 'airport']},
  {id: 'power', name: 'Power', key: '6', code: 'Digit6', tools: ['wire', 'wind', 'solar', 'gas', 'coal', 'nuclear']},
  {id: 'services', name: 'Services', key: '8', code: 'Digit8', tools: ['police', 'fire', 'school', 'hospital', 'university']},
  {id: 'leisure', name: 'Leisure', key: '7', code: 'Digit7', tools: ['park', 'garden', 'plaza', 'bigpark', 'stadium']},
  {id: 'terrain', name: 'Terrain', key: 'T', code: 'KeyT', tools: ['trees', 'water', 'landfill']}
];


// The tools each category's key goes through (see InputStatus.setToolCycles)
var cycles = function() {
  var result = {};
  CATEGORIES.forEach(function(category) {
    result[category.code] = category.tools.slice();
  });
  return result;
};


var makeToolButton = function(toolName) {
  var tool = TOOLS[toolName];
  var button = $('<button type="button" class="toolButton unselected"></button>')
    .attr({'data-tool': toolName, 'data-size': tool.size, 'data-colour': tool.colour, 'data-label': tool.name,
           'data-cost': tool.cost, 'data-description': tool.description})
    .text(tool.name);
  if (tool.key)
    button.attr('data-key', tool.key);
  if (tool.brush)
    button.attr('data-brush', tool.brush);
  return button;
};


// Builds the categories and their palettes in the tool bar (before ToolIcons decorates the buttons)
var build = function() {
  var flyout = $('#toolFlyout');

  CATEGORIES.forEach(function(category) {
    var bar = $(category.holder || '#categoryButtons');
    var palette = $('<div class="toolPalette" role="menu"></div>').attr({'data-category': category.id,
                                                                        'aria-label': I18n.t(category.name),
                                                                        'data-i18n-aria-label': category.name});
    var title = $('<div class="paletteTitle"></div>').appendTo(palette);
    $('<span></span>').attr('data-i18n', category.name).text(I18n.t(category.name)).appendTo(title);
    // The category's key, which goes through its tools
    $('<span class="paletteKey"></span>').text(category.key + ' \u21bb')
      .attr({title: I18n.t('Press this key again and again to go through these tools'),
             'data-i18n-title': 'Press this key again and again to go through these tools'})
      .appendTo(title);
    category.tools.forEach(function(toolName) {
      var item = makeToolButton(toolName).attr('role', 'menuitemradio');
      palette.append(item);
    });
    flyout.append(palette);

    // The category's own button shows its current tool
    $('<button type="button" class="categoryButton unselected" aria-haspopup="menu" aria-expanded="false"></button>')
      .attr({'data-category': category.id, 'data-tool': category.tools[0]})
      .append($('<span class="categoryIcon"></span>'))
      .append($('<span class="toolName"></span>').attr('data-i18n', category.name).text(I18n.t(category.name)))
      .append($('<span class="categoryArrow" aria-hidden="true">&#9656;</span>'))
      .appendTo(bar);
  });
};


// Shows each category's current tool on its button
var refresh = function(currentTool) {
  $('.categoryButton').each(function() {
    var button = $(this);
    var category = button.attr('data-category');
    var palette = $('.toolPalette[data-category="' + category + '"]');
    var inCategory = currentTool && palette.find('.toolButton[data-tool="' + currentTool + '"]').length > 0;

    if (inCategory)
      button.attr('data-tool', currentTool);

    var shown = button.attr('data-tool');
    button.find('.categoryIcon').empty().append(ToolIcons.makeIcon(shown));

    button.toggleClass('selected', !!inCategory).toggleClass('unselected', !inCategory);
    button.attr('title', button.find('.toolName').text() + ': ' + I18n.t(TOOLS[shown].name));
  });
};


var closeFlyout = function() {
  var open = $('#toolFlyout').hasClass('open');
  $('#toolFlyout').removeClass('open');
  $('.toolPalette').removeClass('open');
  $('.categoryButton').attr('aria-expanded', 'false');
  return open;
};


var openFlyout = function(button) {
  var category = button.attr('data-category');
  var flyout = $('#toolFlyout');
  closeFlyout();

  flyout.addClass('open');
  $('.toolPalette[data-category="' + category + '"]').addClass('open');
  button.attr('aria-expanded', 'true');

  // Next to the button: beside the tool bar, or above it when the tool bar runs along the bottom of the screen
  var rect = button[0].getBoundingClientRect();
  var bar = $('#controls')[0].getBoundingClientRect();
  var container = flyout.parent()[0].getBoundingClientRect();
  if (bar.width > bar.height * 1.5) {
    flyout.css({left: Math.max(4, Math.min(rect.left - container.left, container.width - flyout.outerWidth() - 4)) + 'px',
                top: 'auto', bottom: Math.round(container.bottom - bar.top + 6) + 'px'});
  } else {
    var top = Math.max(4, Math.min(rect.top - container.top, container.height - flyout.outerHeight() - 4));
    flyout.css({left: Math.round(bar.right - container.left + 6) + 'px', top: top + 'px', bottom: 'auto'});
  }
};


// selectTool: the function that takes up a tool (see InputStatus)
var bind = function(selectTool) {
  $('.categoryButton').on('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    var button = $(this);
    var wasOpen = button.attr('aria-expanded') === 'true';

    selectTool(button.attr('data-tool'), true);
    if (wasOpen)
      closeFlyout();
    else
      openFlyout(button);
  });

  // Choosing a tool closes the palette
  $('#toolFlyout').on('click', '.toolButton', function() {
    closeFlyout();
  });

  $(document).on('click', function(e) {
    if (!$(e.target).closest('#toolFlyout, .categoryButton').length)
      closeFlyout();
  });
};


var Toolbar = {
  build: build,
  bind: bind,
  refresh: refresh,
  closeFlyout: closeFlyout,
  cycles: cycles,
  TOOLS: TOOLS,
  CATEGORIES: CATEGORIES
};


export { Toolbar };
