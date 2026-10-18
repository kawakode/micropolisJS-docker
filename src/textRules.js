/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// What the players write for the others to read: the names of their shared cities and regions, and the chat. The same
// rule on both sides: the game checks a text as the server will (see LobbyData.checkName, PlayersPanel.cleanChat), and
// the server applies it (see server/game/names.ts).
//
// A text is taken in NFC, without control and format characters (\p{Cc} and \p{Cf}: line breaks, the characters that
// reverse the text's direction, zero-width ones...) nor the other characters that show nothing (Hangul fillers, the
// combining grapheme joiner, Mongolian variation selectors...), then trimmed, of spaces, and of the marks that would
// sit on what comes before it. It must show something: a letter, a digit, a punctuation mark or a symbol (a blank
// braille pattern is not one).

// The characters a text loses: control and format characters, and those that are ignorable without being format ones
var INVISIBLE = /[\p{Cc}\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u3164\uFFA0]/gu;

// Spaces and combining marks at the start
var LEADING = /^[\s\p{M}]+/u;

// A character that shows
var VISIBLE = /(?!\u2800)[\p{L}\p{N}\p{P}\p{S}]/u;


// The text, cleaned ('' if it is not a text)
var clean = function(text) {
  if (typeof(text) !== 'string')
    return '';

  return text.normalize('NFC').replace(INVISIBLE, '').replace(LEADING, '').trim();
};


// Whether a cleaned text shows anything
var shows = function(text) {
  return typeof(text) === 'string' && VISIBLE.test(text);
};


var TextRules = {
  clean: clean,
  shows: shows
};


export { TextRules };
