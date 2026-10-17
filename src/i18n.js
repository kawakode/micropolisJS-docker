/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { French } from './lang/fr.js';

// The languages of the game. The texts are written in English in the code and the page; each other language has a
// dictionary from the English text to its own (see lang/). The language is the one chosen in the settings, or else
// the first of the browser's languages that the game speaks, or else English.
//
// In the page, an element with a data-i18n attribute has its text translated: the attribute holds the English text,
// or is empty for the element's own text. The same goes for the attributes title, aria-label, placeholder and value,
// with data-i18n-title, data-i18n-aria-label... An element whose text holds markup (links) has a data-i18n-html
// attribute naming its translation instead.
//
// A text is sometimes ambiguous in English ("Fire": the disaster, or the fire department): it is then written as
// "context|text", and only the text after the bar is shown in English.

var LANGUAGES = ['en', 'fr'];
var NAMES = {en: 'English', fr: 'Français'};
var LOCALES = {en: 'en-US', fr: 'fr-FR'};
var DICTIONARIES = {fr: French.strings};
var STORAGE_KEY = 'kawacityLanguage';
var ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'value'];

var listeners = [];

// The texts that were asked for in a language whose dictionary lacks them (see the tests)
var missing = {};


var readChoice = function() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    // No storage: the choice is simply not remembered
    return null;
  }
};


// The browser's preferred languages, best first
var browserLanguages = function() {
  if (typeof(navigator) === 'undefined')
    return [];

  return navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
};


// The language the game starts in
var detect = function(choice, preferred) {
  if (LANGUAGES.indexOf(choice) !== -1)
    return choice;

  for (var i = 0; i < preferred.length; i++) {
    var code = String(preferred[i] || '').toLowerCase().split('-')[0];
    if (LANGUAGES.indexOf(code) !== -1)
      return code;
  }

  return 'en';
};


var language = detect(readChoice(), browserLanguages());


var getLanguage = function() {
  return language;
};


// Changes the language (remembering the choice unless remember is false), and tells the listeners
var setLanguage = function(lang, remember) {
  if (LANGUAGES.indexOf(lang) === -1)
    return;

  if (remember !== false) {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {
      // Not remembered
    }
  }

  if (lang === language)
    return;

  language = lang;
  if (typeof(document) !== 'undefined') {
    document.documentElement.lang = lang;
    translateDocument();
  }

  listeners.forEach(function(listener) { listener(lang); });
};


// listener is called with the new language when it changes
var onChange = function(listener) {
  listeners.push(listener);
};


var fill = function(text, params) {
  return text.replace(/\{(\w+)\}/g, function(match, name) {
    return params[name] === undefined ? match : String(params[name]);
  });
};


// The language's typographic rules: in French, a (no-break) space before the high punctuation
var typeset = function(text) {
  if (language !== 'fr')
    return text;

  return text.replace(/ ([:;!?%\u00bb])/g, '\u00a0$1').replace(/\u00ab /g, '\u00ab\u00a0');
};


// The text in the current language, with each {name} replaced by params[name]
var t = function(text, params) {
  var result = text.indexOf('|') === -1 ? text : text.slice(text.indexOf('|') + 1);

  if (language !== 'en') {
    var translation = DICTIONARIES[language][text];
    if (translation === undefined)
      missing[text] = true;
    else
      result = typeset(translation);
  }

  return params ? fill(result, params) : result;
};


// A number, the way the current language writes it
var formatNumber = function(n) {
  // Not every font has the narrow no-break space that separates thousands in French
  return Math.round(n).toLocaleString(LOCALES[language]).replace(/\u202f/g, '\u00a0');
};


// An amount of money
var money = function(n) {
  if (language === 'fr')
    return formatNumber(n) + '\u00a0$';

  return (n < 0 ? '-$' : '$') + formatNumber(Math.abs(n));
};


var normalise = function(text) {
  return text.replace(/\s+/g, ' ').trim();
};


// Translates the page (or the part of it under root): the English texts are noted the first time
var translateDocument = function(root) {
  root = root || document;

  root.querySelectorAll('[data-i18n]').forEach(function(element) {
    var key = element.getAttribute('data-i18n');
    if (!key) {
      key = normalise(element.textContent);
      element.setAttribute('data-i18n', key);
    }
    element.textContent = t(key);
  });

  root.querySelectorAll('[data-i18n-html]').forEach(function(element) {
    if (element._i18nEnglish === undefined)
      element._i18nEnglish = element.innerHTML;

    var translation = language === 'en' ? undefined : DICTIONARIES[language][element.getAttribute('data-i18n-html')];
    if (language !== 'en' && translation === undefined)
      missing[element.getAttribute('data-i18n-html')] = true;
    element.innerHTML = translation === undefined ? element._i18nEnglish : typeset(translation);
  });

  ATTRIBUTES.forEach(function(attribute) {
    var marker = 'data-i18n-' + attribute;
    root.querySelectorAll('[' + marker + ']').forEach(function(element) {
      var key = element.getAttribute(marker);
      if (!key) {
        key = element.getAttribute(attribute) || '';
        element.setAttribute(marker, key);
      }
      element.setAttribute(attribute, t(key));
    });
  });
};


var I18n = {
  LANGUAGES: LANGUAGES,
  NAMES: NAMES,
  detect: detect,
  getLanguage: getLanguage,
  setLanguage: setLanguage,
  onChange: onChange,
  t: t,
  typeset: typeset,
  formatNumber: formatNumber,
  money: money,
  translateDocument: translateDocument,
  missing: missing,
  dictionaries: DICTIONARIES
};


export { I18n };
