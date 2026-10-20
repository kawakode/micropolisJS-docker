// Fire cover: firefighters prevent fires and put them out, and out of their reach fires never go out
import { BlockMap } from "../src/blockMap";
import { DisasterManager } from "../src/disasterManager.js";
import { FireCover } from "../src/fireCover.js";
import { GameMap } from "../src/gameMap.js";
import { MiscTiles } from "../src/miscTiles.js";
import { BNCNBIT } from "../src/tileFlags";
import { TileUtils } from "../src/tileUtils.js";
import { DIRT, LASTRUBBLE, RUBBLE, SCHOOLBASE } from "../src/tileValues";

// Block maps where every spot has the given fire station effect
const coveredBy = (cover: number): any => {
    const fireStationEffectMap = new BlockMap(20, 20, 8);
    for (let x = 0; x < 20; x += 8) {
        for (let y = 0; y < 20; y += 8)
            fireStationEffectMap.worldSet(x, y, cover);
    }
    return {fireStationEffectMap};
};

// Runs the map scan's fire handler on one burning tile, the given number of times
const burn = (blockMaps: any, scans: number): any => {
    const map = new (GameMap as any)(20, 20, DIRT);
    map.setTo(10, 10, TileUtils.randomFire());

    let fireFound: any = null;
    const scanner = {addAction: (test: any, action: any) => { if (test === TileUtils.isFire) fireFound = action; }};
    MiscTiles.registerHandlers(scanner, null);

    const census = {firePop: 0, uncoveredFirePop: 0};
    for (let i = 0; i < scans && TileUtils.isFire(map.getTileValue(10, 10)); i++)
        fireFound(map, 10, 10, {census, blockMaps, spriteManager: null});

    return {map, census};
};

const isRubble = (value: number): boolean => value >= RUBBLE && value <= LASTRUBBLE;

describe("Fire cover", () => {
    afterEach(() => jest.restoreAllMocks());

    it("reads the cover in percent, full about one block from a fire station", () => {
        expect(FireCover.coverPercent(null, 5, 5)).toBe(0);
        expect(FireCover.coverPercent(coveredBy(0), 5, 5)).toBe(0);
        expect(FireCover.coverPercent(coveredBy(25), 5, 5)).toBe(25);
        expect(FireCover.coverPercent(coveredBy(FireCover.FULL_COVER), 5, 5)).toBe(100);
        expect(FireCover.coverPercent(coveredBy(218), 5, 5)).toBe(100);
    });

    it("never puts out a fire out of reach of the firefighters", () => {
        const {map, census} = burn(coveredBy(0), 2000);

        expect(TileUtils.isFire(map.getTileValue(10, 10))).toBe(true);
        expect(census.uncoveredFirePop).toBe(census.firePop);
    });

    it("puts fires out faster with more cover", () => {
        const scansToPutOut = (cover: number): number => {
            let total = 0;
            for (let i = 0; i < 200; i++) {
                const {map, census} = burn(coveredBy(cover), 100000);
                expect(isRubble(map.getTileValue(10, 10))).toBe(true);
                expect(census.uncoveredFirePop).toBe(0);
                total += census.firePop;
            }
            return total / 200;
        };

        // About 8 scans at full cover, as in the original game, and ten times as many at 10%
        expect(scansToPutOut(100)).toBeLessThan(12);
        expect(scansToPutOut(10)).toBeGreaterThan(40);
    });

    it("lets every fire break out without cover, and stops most at full cover", () => {
        const breakOuts = (cover: number): number => {
            let count = 0;
            for (let i = 0; i < 1000; i++)
                count += FireCover.catchesFire(coveredBy(cover), 5, 5) ? 1 : 0;
            return count;
        };

        expect(breakOuts(0)).toBe(1000);
        expect(breakOuts(100)).toBeGreaterThan(150);
        expect(breakOuts(100)).toBeLessThan(350);
    });

    it("keeps a covered building from catching fire when the firefighters get there first", () => {
        const map = new (GameMap as any)(20, 20, DIRT);
        for (let x = 0; x < 20; x++) {
            for (let y = 0; y < 20; y++)
                map.setTile(x, y, SCHOOLBASE, BNCNBIT);
        }
        const disasters = new (DisasterManager as any)(map, null, 0);
        disasters.blockMaps = coveredBy(FireCover.FULL_COVER);

        // A low roll is a fire the firefighters prevent
        jest.spyOn(Math, "random").mockReturnValue(0);
        disasters.setFire(1, true);

        for (let x = 0; x < 20; x++) {
            for (let y = 0; y < 20; y++)
                expect(TileUtils.isFire(map.getTileValue(x, y))).toBe(false);
        }
    });
});
