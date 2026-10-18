/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { Storage } from '../../src/storage.js';
import { fromClassicValue } from '../../src/tileFlags';
import { createHeadlessCity } from '../game/headless';
import { checkText, cleanText } from '../game/names';
import { prepareCity, SaveError, validateSave } from '../game/saveValidation';
import { freshCitySave, sampleCity, seededRandom } from '../gameTesting';

// The saves players upload to share a city: every value checked, nothing walked generically, the city rebuilt from
// the values checked only, then opened and run for a step.

const SAMPLES = readdirSync(path.join(__dirname, '..', '..', 'cities')).filter(name => name.endsWith('.cty'))
  .map(name => name.slice(0, -4));

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// The field a save is refused for
const refusal = (save: unknown): string | null => {
  try {
    validateSave(save);
    return null;
  } catch (error) {
    if (error instanceof SaveError)
      return error.field;
    throw error;
  }
};

// A save as the game writes it to a file: a city that ran for a while
const gameSave = (name = 'kowloon', steps = 200) => {
  const city = createHeadlessCity(sampleCity(name), {random: seededRandom(3)});
  for (let i = 0; i < steps; i++) {
    city.step();
    city.moveSprites(3);
  }
  return city.save();
};

describe('Saves the game writes', () => {
  test('Every sample city, as the game reads it (CityFile.read)', () => {
    for (const name of SAMPLES) {
      const save = sampleCity(name);
      expect([name, refusal(save)]).toEqual([name, null]);
    }
  });

  test('Every sample city once it has run, as Game.getSaveData writes it', () => {
    for (const name of SAMPLES) {
      const save = gameSave(name, 300);
      expect([name, refusal(save)]).toEqual([name, null]);
      // The text of a .kawacity file, as the game opens it, minus the flag it adds
      const parsed = Storage.parseSavedGame(Storage.exportGame(copy(save)));
      expect(refusal(parsed)).toBeNull();
    }
  });

  test('A new city on a generated map, at each level', () => {
    for (const level of [0, 1, 2])
      expect(refusal(freshCitySave('Newtown', level, level + 1))).toBeNull();
  });

  test('The city is rebuilt from the values checked: the same values, scenario none, version 4', () => {
    const save = gameSave();
    save.scenario = {name: 'x', disasters: []};
    const clean = validateSave(save);
    expect(clean).not.toBe(save);
    expect(clean.map).not.toBe(save.map);
    expect(clean.scenario).toBeNull();
    expect(clean.version).toBe(4);
    expect({...clean, scenario: undefined}).toEqual({...save, scenario: undefined});
  });

  test('A save without road classes gets plain roads; one without neighbours gets new ones when opened', () => {
    const save = sampleCity('haight');
    expect(save.roadClass).toBeUndefined();
    expect(save.neighbours).toBeUndefined();
    const clean = validateSave(save);
    expect(clean.roadClass).toBe('0'.repeat(12000));
    expect(clean.isSavedGame).toBeUndefined();

    const prepared = prepareCity(save, {name: 'Haight', level: 1});
    const kept = JSON.parse(prepared.saveText);
    expect(kept.neighbours.length).toBe(4);
    expect(kept.name).toBe('Haight');
    expect(kept._gameLevel).toBe(1);
  });

  test('Money histories above 255 (some original city files have them) are brought to 255', () => {
    const save = sampleCity('linecity');
    expect(Math.max(...save.moneyHist120 as number[])).toBeGreaterThan(255);
    const clean = validateSave(save);
    expect(Math.max(...clean.moneyHist120 as number[])).toBe(255);
    expect(clean.resHist120).toEqual(save.resHist120);
  });

  test('Older versions are brought to the new tiles, as the game does', () => {
    const current = validateSave(gameSave());
    const classic = copy(current);
    // Back to the tiles of the original game: 10 bits of tile number, the flags above
    classic.map = (current.map as {value: number}[]).map(tile =>
      ({value: (tile.value & 0x3ff) | ((tile.value >> 1) & 0xfc00)}));
    for (const version of [1, 2, 3]) {
      const old: Record<string, unknown> = {...copy(classic), version};
      if (version <= 2) {
        delete old.cityCentreX;
        delete old.pollutionMaxY;
      }
      const clean = validateSave(old);
      const expected = (classic.map as {value: number}[]).map(tile => ({value: fromClassicValue(tile.value)}));
      expect(clean.map).toEqual(expected);
      expect(clean.version).toBe(4);
      if (version <= 2)
        expect([clean.cityCentreX, clean.cityCentreY, clean.pollutionMaxX, clean.pollutionMaxY]).toEqual([60, 50, 60, 50]);
    }
  });
});

describe('Crafted saves are refused', () => {
  const base = validateSave(gameSave('kobe', 50));
  const variant = (change: (save: any) => void) => {
    const save = copy(base);
    change(save);
    return refusal(save);
  };

  test('Anything but an object', () => {
    for (const value of [null, undefined, 1, 'save', [], [base], true])
      expect(refusal(value)).toBe('save');
  });

  test('Deep nesting is refused at its first level, without recursion', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100000; i++)
      deep = [deep];
    expect(variant(save => { save.map = deep; })).toBe('map');
    expect(variant(save => { save.neighbours = deep; })).toBe('neighbours');
    expect(variant(save => { save.resHist10 = deep; })).toBe('resHist10');
    expect(variant(save => { save.scenario = deep; })).toBe('scenario');
    let nested: any = {};
    for (let i = 0; i < 100000; i++)
      nested = {value: nested};
    expect(variant(save => { save.map[0] = nested; })).toBe('map');

    // As the server reads it: JSON nested deeper than any recursion could go
    const text = JSON.stringify({...base, map: 0}).replace('"map":0', '"map":' + '['.repeat(500000) +
                                                           ']'.repeat(500000));
    expect(refusal(JSON.parse(text))).toBe('map');
  });

  test('Numbers that are not finite, not integers, or out of range', () => {
    const huge = JSON.parse('{"a": 1e400}').a;
    expect(huge).toBe(Infinity);
    expect(variant(save => { save.totalFunds = huge; })).toBe('totalFunds');
    expect(variant(save => { save.totalFunds = -1; })).toBe('totalFunds');
    expect(variant(save => { save.totalFunds = 2 ** 31; })).toBe('totalFunds');
    expect(variant(save => { save.totalFunds = 10.5; })).toBe('totalFunds');
    expect(variant(save => { save.totalFunds = '1000'; })).toBe('totalFunds');
    expect(variant(save => { save._cityTime = NaN; })).toBe('_cityTime');
    expect(variant(save => { save.roadPercent = 1.01; })).toBe('roadPercent');
    expect(variant(save => { save.roadPercent = -0.01; })).toBe('roadPercent');
    expect(variant(save => { save.cityTax = 21; })).toBe('cityTax');
    expect(variant(save => { save._speed = 4; })).toBe('_speed');
    expect(variant(save => { save._gameLevel = 3; })).toBe('_gameLevel');
    expect(variant(save => { save.resValve = 2001; })).toBe('resValve');
    expect(variant(save => { save.timeOfDay = huge; })).toBe('timeOfDay');
    expect(variant(save => { save.cityClass = 'EMPIRE'; })).toBe('cityClass');
    expect(variant(save => { save.cityCentreX = 120; })).toBe('cityCentreX');
    expect(variant(save => { save.autoBudget = 1; })).toBe('autoBudget');
    expect(variant(save => { save.moneyHist10[5] = -1; })).toBe('moneyHist10');
    expect(variant(save => { save.resHist120[0] = -1; })).toBe('resHist120');
    expect(variant(save => { save.crimeHist10[0] = 1.5; })).toBe('crimeHist10');
    expect(variant(save => { save.resHist10[0] = huge; })).toBe('resHist10');
  });

  test('Wrong sizes', () => {
    expect(variant(save => { save.width = 128; })).toBe('width');
    expect(variant(save => { save.height = 99; })).toBe('height');
    expect(variant(save => { save.map.pop(); })).toBe('map');
    expect(variant(save => { save.map.push({value: 0}); })).toBe('map');
    expect(variant(save => { save.map = {length: 12000}; })).toBe('map');
    expect(variant(save => { save.roadClass = '0'.repeat(11999); })).toBe('roadClass');
    expect(variant(save => { save.roadClass = '4' + '0'.repeat(11999); })).toBe('roadClass');
    expect(variant(save => { save.comHist10.push(0); })).toBe('comHist10');
    expect(variant(save => { save.indHist120 = save.indHist120.slice(1); })).toBe('indHist120');
    expect(variant(save => { save.neighbours = save.neighbours?.slice(1) ?? []; })).toBe('neighbours');
  });

  test('Tiles: integers, a tile of the game, known flags only', () => {
    expect(variant(save => { save.map[5] = {value: 1.5}; })).toBe('map');
    expect(variant(save => { save.map[5] = {value: -1}; })).toBe('map');
    expect(variant(save => { save.map[5] = {value: 0x20000}; })).toBe('map');
    expect(variant(save => { save.map[5] = {value: 2047}; })).toBe('map');
    expect(variant(save => { save.map[5] = {value: '2'}; })).toBe('map');
    expect(variant(save => { save.map[5] = {value: 2, extra: 1}; })).toBe('map');
    expect(variant(save => { save.map[5] = [2]; })).toBe('map');
    expect(variant(save => { save.map[5] = null; })).toBe('map');
    expect(variant(save => { save.map[5] = {}; })).toBe('map');
    // The flags of a tile with power, a zone's centre... are all fine
    expect(variant(save => { save.map[5] = {value: 0x1FFFF & ~0x7FF | 2}; })).toBeNull();
  });

  test('Keys the game does not write, prototype keys included', () => {
    expect(variant(save => { save.extra = 1; })).toBe('extra');
    expect(variant(save => { save.isAdmin = true; })).toBe('isAdmin');
    expect(refusal(JSON.parse('{"__proto__": {"polluted": true}}'))).toBe('__proto__');
    const withProto = JSON.parse(JSON.stringify(base).replace(/^\{/, '{"__proto__": {"totalFunds": 1},'));
    expect(refusal(withProto)).toBe('__proto__');
    expect(({} as any).polluted).toBeUndefined();
    expect(variant(save => { save.constructor = {}; })).toBe('constructor');
    expect(variant(save => { save.map[3] = JSON.parse('{"value": 0, "__proto__": 1}'); })).toBe('map');
    expect(variant(save => { save.neighbours[0].extra = 1; })).toBe('neighbours.north');
    expect(variant(save => { save.neighbours[0].deals.steal = true; })).toBe('neighbours.north.deals');
    expect(variant(save => { save.neighbours[0].months = JSON.parse('{"__proto__": 3}'); }))
      .toBe('neighbours.north.months');
  });

  test('Required values may not be left out', () => {
    for (const key of ['_cityTime', 'totalFunds', 'map', 'resHist10', 'cityClass', 'width', 'cityCentreX'])
      expect(variant(save => { delete save[key]; })).toBe(key);
  });

  test('Huge strings', () => {
    expect(variant(save => { save.name = 'x'.repeat(5000); })).toBe('name');
    expect(variant(save => { save.neighbours[1].name = 'x'.repeat(31); })).toBe('neighbours.east.name');
    expect(variant(save => { save.neighbours[1].name = 'é'.repeat(30); })).toBeNull();
    expect(variant(save => { save.neighbours[1].name = '‮​'; })).toBe('neighbours.east.name');
    expect(variant(save => { save.roadClass = '0'.repeat(500000); })).toBe('roadClass');
  });

  test('Neighbours: in order, their names cleaned, populations and months in range', () => {
    expect(variant(save => { save.neighbours.reverse(); })).toBe('neighbours.north');
    expect(variant(save => { save.neighbours[2].population = -5; })).toBe('neighbours.south.population');
    expect(variant(save => { save.neighbours[2].months.trade = 13; })).toBe('neighbours.south.months');
    expect(variant(save => { save.neighbours[2].deals.trade = 'yes'; })).toBe('neighbours.south.deals');
    const save = copy(base);
    (save.neighbours as any)[3].name = ' Bad‮ville\u0007 ';
    expect((validateSave(save).neighbours as any)[3].name).toBe('Badville');
  });

  test('A save the simulation cannot run is refused', () => {
    // A city whose census is all wrong still runs; one whose valves are... fine too: the real check is the step
    const prepared = prepareCity(sampleCity('kobe'), {name: 'Kobe', level: 0});
    expect(JSON.parse(prepared.saveText).name).toBe('Kobe');
    expect(prepared.population).toBeGreaterThan(0);
    expect(Object.keys(prepared.edgeState)).toEqual(['north', 'east', 'south', 'west']);
    expect(() => prepareCity({}, {name: 'X', level: 0})).toThrow(SaveError);
  });
});

describe('Names', () => {
  test('NFC, control and format characters removed, trimmed, counted in code points', () => {
    expect(cleanText('  Café‮​\n ')).toBe('Café');
    expect(checkText('Café', 4)).toEqual({ok: true, text: 'Café'});
    expect(checkText('😀😀😀', 3)).toEqual({ok: true, text: '😀😀😀'});
    expect(checkText('😀😀😀😀', 3)).toEqual({ok: false, reason: 'too_long'});
    expect(checkText(' ​ ', 3)).toEqual({ok: false, reason: 'required'});
    expect(checkText(12, 3)).toEqual({ok: false, reason: 'invalid'});
    expect(checkText('x'.repeat(100), 15)).toEqual({ok: false, reason: 'too_long'});
  });
});
