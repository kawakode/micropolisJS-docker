/* micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details. Alternatively,
 * consult http://micropolisjs.graememcc.co.uk/LICENSE and
 * http://micropolisjs.graememcc.co.uk/COPYING
 *
 * The name/term "MICROPOLIS" is a registered trademark of Micropolis (https://www.micropolis.com) GmbH
 * (Micropolis Corporation, the "licensor") and is licensed here to the authors/publishers of the "Micropolis"
 * city simulation game and its source code (the project or "licensee(s)") as a courtesy of the owner.
 *
 */

import $ from "jquery";

import { I18n } from './i18n.js';
import * as Messages from './messages.ts';
import { MiscUtils } from './miscUtils.js';
import { Text } from './text.js';


// Returns a function that shows the values and follows them; it returns in turn a function to show them again (when
// the language changes)
var InfoBar = function(classification, population, score, funds, date, name) {
  var classificationSelector = MiscUtils.normaliseDOMid(classification);
  var populationSelector = MiscUtils.normaliseDOMid(population);
  var scoreSelector = MiscUtils.normaliseDOMid(score);
  var fundsSelector = MiscUtils.normaliseDOMid(funds);
  var dateSelector = MiscUtils.normaliseDOMid(date);
  var nameSelector = MiscUtils.normaliseDOMid(name);

  return function(dataSource, initialValues) {
    var values = Object.assign({}, initialValues);

    var show = function() {
      $(classificationSelector).text(I18n.t(Text.cityClass[values.classification]));
      $(populationSelector).text(I18n.formatNumber(values.population));
      $(scoreSelector).text(I18n.formatNumber(values.score));
      $(fundsSelector).text(I18n.money(values.funds));
      $(dateSelector).text([I18n.t(Text.months[values.date.month]), values.date.year].join(' '));
      $(nameSelector).text(values.name);
    };

    var follow = function(message, key) {
      dataSource.addEventListener(message, function(value) {
        values[key] = value;
        show();
      });
    };

    follow(Messages.CLASSIFICATION_UPDATED, 'classification');
    follow(Messages.POPULATION_UPDATED, 'population');
    follow(Messages.SCORE_UPDATED, 'score');
    follow(Messages.FUNDS_CHANGED, 'funds');
    follow(Messages.DATE_UPDATED, 'date');

    show();
    return show;
  };
};


export { InfoBar };
