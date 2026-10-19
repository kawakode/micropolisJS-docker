// KawaCity's buildings on the map: their road access, and fires
import { GameMap } from "../src/gameMap.js";
import { KawaBuildings } from "../src/kawaBuildings.js";
import { ZoneUtils } from "../src/zoneUtils.js";
import { BULLBIT } from "../src/tileFlags";
import { DIRT, ROADS, WINDTURBINE, WINDTURBINE1 } from "../src/tileValues";

const makeMap = (): any => new (GameMap as any)(20, 20, DIRT);

describe("A building's road access", () => {
    it("counts a road along an edge of the building", () => {
        const map = makeMap();
        // A 3x3 school centred at (10, 10) covers 9..11: a road at (12, 11) runs along its right edge
        map.setTile(12, 11, ROADS, 0);

        expect((KawaBuildings as any).hasRoadAlongside(map, 10, 10, 3)).toBe(true);
    });

    it("doesn't count a road that only touches a corner", () => {
        [[8, 8], [12, 8], [8, 12], [12, 12]].forEach(([x, y]) => {
            const map = makeMap();
            map.setTile(x, y, ROADS, 0);

            expect([x, y, (KawaBuildings as any).hasRoadAlongside(map, 10, 10, 3)]).toEqual([x, y, false]);
        });
    });
});


describe("A wind turbine on fire", () => {
    const blockMaps = {rateOfGrowthMap: {worldGet: () => 0, worldSet: () => {}}};

    [WINDTURBINE, WINDTURBINE1].forEach((value) => {
        it(`makes its own tile bulldozable, and none of its neighbours (tile ${value})`, () => {
            const map = makeMap();
            for (let x = 9; x <= 11; x++) {
                for (let y = 9; y <= 11; y++)
                    map.setTile(x, y, ROADS, 0);
            }
            map.setTile(10, 10, value, 0);

            (ZoneUtils as any).fireZone(map, 10, 10, blockMaps);

            for (let x = 9; x <= 11; x++) {
                for (let y = 9; y <= 11; y++) {
                    const bulldozable = (map.getTile(x, y).getRawValue() & BULLBIT) !== 0;
                    expect([x, y, bulldozable]).toEqual([x, y, x === 10 && y === 10]);
                }
            }
        });
    });
});
