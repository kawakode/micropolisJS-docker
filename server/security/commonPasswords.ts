/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { COMMON_PASSWORDS_1 } from './commonPasswordList1';
import { COMMON_PASSWORDS_2 } from './commonPasswordList2';

// Passwords too common to be accepted: the most used passwords of 12 characters or more (shorter ones are refused
// anyway), from SecLists, compared without regard to case. The list is generated in two halves (a single file is too
// big for the tools that measure test coverage): see commonPasswordList1.ts for its source and licence.

let passwords: ReadonlySet<string> | null = null;

const commonPasswords = (): ReadonlySet<string> => {
  passwords ??= new Set([...COMMON_PASSWORDS_1.split('\n'), ...COMMON_PASSWORDS_2.split('\n')]);
  return passwords;
};

export function isCommonPassword(password: string): boolean {
  return commonPasswords().has(password.normalize('NFC').toLowerCase());
}

// How many passwords the list holds (for tests)
export function commonPasswordCount(): number {
  return commonPasswords().size;
}
