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

// Bit-masks for statusBits. The tile number takes the low 11 bits (KawaCity has twice as many tiles as the original
// game, whose tile numbers took 10 bits: the flags have moved up a bit, see Storage and CityFile)
export const NOFLAGS  = 0x0000;
export const POWERBIT = 0x10000; // bit 16, tile has power.
export const CONDBIT  = 0x8000; // bit 15. tile can conduct electricity.
export const BURNBIT  = 0x4000; // bit 14, tile can be lit.
export const BULLBIT  = 0x2000; // bit 13, tile is bulldozable.
export const ANIMBIT  = 0x1000; // bit 12, tile is animated.
export const ZONEBIT  = 0x0800; // bit 11, tile is the center tile of the zone.

export const BLBNBIT   = BULLBIT | BURNBIT;
export const BLBNCNBIT = BULLBIT | BURNBIT | CONDBIT;
export const BNCNBIT   = BURNBIT | CONDBIT;
export const ASCBIT    = ANIMBIT | CONDBIT | BURNBIT;
export const ALLBITS   = POWERBIT | CONDBIT | BURNBIT | BULLBIT | ANIMBIT | ZONEBIT;

export const BIT_START = 0x800;
export const BIT_END = 0x10000;
export const BIT_MASK = BIT_START - 1;

// Converts a tile from the layout of the original game (and of saves before version 4), with the tile number in 10
// bits and the flags above
export const fromClassicValue = (value: number): number => (value & 0x3ff) | ((value & 0xfc00) << 1);
