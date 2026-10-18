/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { FieldReason } from '../http/response';
import { LIMITS } from '../limits';

// The names players give (cities, regions) and what they say in the chat: normalised (NFC), without control or format
// characters (\p{Cc} and \p{Cf}: line breaks, the characters that reverse the text's direction, zero-width ones...),
// trimmed, then counted in Unicode code points.

export const CITY_NAME_MAX = LIMITS.cityNameMax;
export const REGION_NAME_MAX = 30;
// The neighbours of a city in its save (see Neighbours.MAX_NAME_LENGTH)
export const NEIGHBOUR_NAME_MAX = 30;
export const CHAT_MAX = 300;

// A text read before cleaning is refused beyond this many UTF-16 units: four per code point kept is more than any
// normalisation or stripping needs
const RAW_FACTOR = 4;

export function cleanText(text: string): string {
  return text.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
}

export const codePoints = (text: string): number => Array.from(text).length;

export type CheckedText = {ok: true; text: string} | {ok: false; reason: FieldReason};

// A name or a chat line, cleaned, 1 to `max` code points
export function checkText(value: unknown, max: number): CheckedText {
  if (typeof value !== 'string')
    return {ok: false, reason: 'invalid'};
  if (value.length > max * RAW_FACTOR)
    return {ok: false, reason: 'too_long'};

  const text = cleanText(value);
  if (text === '')
    return {ok: false, reason: 'required'};
  if (codePoints(text) > max)
    return {ok: false, reason: 'too_long'};
  return {ok: true, text};
}
