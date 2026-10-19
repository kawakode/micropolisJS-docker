// Disasters striking the buildings of the map
import { DisasterManager } from "../src/disasterManager.js";
import { GameMap } from "../src/gameMap.js";
import { BNCNBIT, ZONEBIT } from "../src/tileFlags";
import { CHURCH1BASE, DIRT, GARDEN, LASTRUBBLE, RUBBLE, SCHOOLBASE, UNIVERSITYBASE, WINDTURBINE } from "../src/tileValues";
import { TileUtils } from "../src/tileUtils.js";
import * as Messages from "../src/messages";

// A map covered with one tile, but no building centres
const mapOf = (value: number): any => {
    const map = new (GameMap as any)(20, 20, DIRT);
    for (let x = 0; x < 20; x++) {
        for (let y = 0; y < 20; y++)
            map.setTile(x, y, value, BNCNBIT);
    }
    return map;
};

const struck = (map: any): number => {
    let count = 0;
    for (let x = 0; x < 20; x++) {
        for (let y = 0; y < 20; y++) {
            const value = map.getTileValue(x, y);
            if (TileUtils.isFire(value) || (value >= RUBBLE && value <= LASTRUBBLE))
                count++;
        }
    }
    return count;
};

describe("Disasters", () => {
    [["a school", SCHOOLBASE], ["a university", UNIVERSITYBASE], ["a church", CHURCH1BASE]].forEach(([name, value]) => {
        it(`can set fire to ${name}`, () => {
            const map = mapOf(value as number);
            const disasters = new (DisasterManager as any)(map, null, 0);
            const reported: any[] = [];
            disasters.addEventListener(Messages.FIRE_REPORTED, (data: any) => reported.push(data));

            disasters.setFire(1, true);

            expect(struck(map)).toBe(1);
            expect(reported.length).toBe(1);
        });

        it(`can shake ${name} down in an earthquake`, () => {
            const map = mapOf(value as number);
            new (DisasterManager as any)(map, null, 0).makeEarthquake();

            expect(struck(map)).toBeGreaterThan(0);
        });
    });

    it("leaves gardens and building centres standing in an earthquake", () => {
        const map = mapOf(GARDEN);
        map.setTile(5, 5, WINDTURBINE, BNCNBIT | ZONEBIT);
        new (DisasterManager as any)(map, null, 0).makeEarthquake();

        expect(struck(map)).toBe(0);
    });
});
