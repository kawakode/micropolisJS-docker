import { BlockMapUtils } from "../src/blockMapUtils.js";
import { GameMap } from "../src/gameMap.js";
import { Monuments } from "../src/monuments.js";
import { Simulation } from "../src/simulation.js";
import { TOWER } from "../src/tileValues";
import { ZoneUtils } from "../src/zoneUtils.js";

describe("Monuments", () => {
    it("unlock as the city grows: a town for a statue, a city for a town hall, a capital for the tower", () => {
        expect(Monuments.isLocked("statue", 1999)).toBe(true);
        expect(Monuments.isLocked("statue", 2000)).toBe(false);
        expect(Monuments.isLocked("townhall", 9999)).toBe(true);
        expect(Monuments.isLocked("tower", 10000)).toBe(true);
        expect(Monuments.isLocked("tower", 50000)).toBe(false);
        expect(Monuments.isLocked("road", 0)).toBe(false);
        expect(Monuments.isLocked("statue", undefined)).toBe(true);
    });

    it("make the land around them more valuable", () => {
        const landValueNear = (withTower: boolean): number => {
            const simulation = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED);
            const map = simulation._map;
            if (withTower)
                (ZoneUtils as any).putZone(map, 30, 30, TOWER, true);
            simulation._clearCensus();
            simulation._mapScanner.mapScan(0, map.width, simulation._constructSimData());
            BlockMapUtils.crimeScan({}, simulation.blockMaps);
            BlockMapUtils.pollutionTerrainLandValueScan(map, simulation._census, simulation.blockMaps);
            return simulation.blockMaps.landValueMap.worldGet(30, 30);
        };

        expect(landValueNear(true)).toBeGreaterThan(landValueNear(false));
    });
});
