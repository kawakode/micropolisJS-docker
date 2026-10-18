import { GROUND_CELLS, OBJECTS } from "../src/isoArt.js";
import { IsoTiles } from "../src/isoTiles.js";
import { AIRPORTBASE, COALSMOKE1, DIRT, FOOTBALLGAME1, FULLSTADIUM, HOUSE, IZB, LASTTREE, LHPOWER, LIGHTNINGBOLT,
         RIVER, ROADS, RZB, TILE_COUNT, WOODS } from "../src/tileValues";

const pictures: {[name: string]: number[]} = OBJECTS;

// A map of one kind of tile, with the given road class everywhere
const uniformMap = (value: number, roadClass = 0) => ({
    width: 10,
    height: 10,
    testBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < 10 && y < 10,
    getTileValue: () => value,
    getRoadClass: () => roadClass
});

describe('IsoTiles', function() {
    test('Every tile has a ground, and only pictures that exist', function() {
        for (let tile = 0; tile < TILE_COUNT; tile++) {
            const map = uniformMap(tile);
            for (let frame = 0; frame < 4; frame++) {
                const cell = IsoTiles.groundCell(map, 3, 4, tile, frame);
                expect(cell).toBeGreaterThanOrEqual(0);
                expect(cell).toBeLessThan(GROUND_CELLS.length);
            }

            const name = IsoTiles.objectName(3, 4, tile, tile, 1000);
            if (name !== null)
                expect(pictures[name]).toBeDefined();

            const building = IsoTiles.buildingOf(tile);
            if (building !== null) {
                expect(building.picture).toBe(pictures[building.name]);
                const offset = IsoTiles.drawnAs(tile) - building.first;
                expect(offset).toBeGreaterThanOrEqual(0);
                expect(offset).toBeLessThan(building.size * building.size);
            }
        }
    });

    test('A building covers all of its tiles', function() {
        const zone = IsoTiles.buildingOf(RZB);
        expect(zone.name).toBe('res_0_0');
        expect(zone.size).toBe(3);
        for (let k = 0; k < 9; k++)
            expect(IsoTiles.buildingOf(zone.first + k)).toBe(zone);

        const airport = IsoTiles.buildingOf(AIRPORTBASE + 35);
        expect(airport.name).toBe('airport');
        expect(airport.size).toBe(6);
        expect(IsoTiles.buildingOf(AIRPORTBASE + 36)).not.toBe(airport);
    });

    test('Animation frames are drawn as the tiles they stand for', function() {
        // The smoke of a factory, of the coal power plant, and a football match
        expect(IsoTiles.buildingOf(884).name).toBe(IsoTiles.buildingOf(641).name);
        expect(IsoTiles.drawnAs(884)).toBe(641);
        expect(IsoTiles.buildingOf(COALSMOKE1).name).toBe('coal');
        expect(IsoTiles.drawnAs(FOOTBALLGAME1 + 3)).toBe(FULLSTADIUM + 1);
        expect(IsoTiles.buildingOf(FOOTBALLGAME1).name).toBe('stadium_full');
        expect(IsoTiles.buildingOf(IZB).name).toBe('ind_0_0');
    });

    test('Single tiles have their own pictures', function() {
        expect(IsoTiles.objectName(0, 0, HOUSE, HOUSE, 0)).toBe('house0');
        expect(IsoTiles.objectName(0, 0, WOODS, WOODS, 0)).toMatch(/^trees_dense/);
        expect(IsoTiles.objectName(0, 0, LASTTREE, LASTTREE, 0)).toMatch(/^trees_sparse/);
        expect(IsoTiles.objectName(0, 0, LHPOWER, LHPOWER, 0)).toBe('pole10');
        expect(IsoTiles.objectName(0, 0, DIRT, DIRT, 0)).toBeNull();
        // The bolt over a zone without power is drawn over the zone's building, not instead of it
        expect(IsoTiles.objectName(0, 0, LIGHTNINGBOLT, LIGHTNINGBOLT, 0)).toBeNull();
    });

    test('Roads take the look of their kind', function() {
        const street = IsoTiles.groundCell(uniformMap(ROADS, 0), 2, 2, ROADS, 0);
        const highway = IsoTiles.groundCell(uniformMap(ROADS, 3), 2, 2, ROADS, 0);
        expect(GROUND_CELLS[street]).toBe('road_street_10');
        expect(GROUND_CELLS[highway]).toBe('road_highway_10');
        expect(IsoTiles.isLitRoad(uniformMap(ROADS, 0), 2, 2, ROADS)).toBe(true);
        expect(IsoTiles.isLitRoad(uniformMap(ROADS, 1), 2, 2, ROADS)).toBe(false);
    });

    test('Water has a shore on the sides with land beyond', function() {
        const lake = uniformMap(RIVER);
        expect(GROUND_CELLS[IsoTiles.groundCell(lake, 5, 5, RIVER, 2)]).toBe('water0_2');

        // Land to the north and the west of the tile at (5, 5)
        const shore = {...lake, getTileValue: (x: number, y: number) => (y < 5 || x < 5) ? DIRT : RIVER};
        expect(GROUND_CELLS[IsoTiles.groundCell(shore, 5, 5, RIVER, 0)]).toBe('water9_0');
    });
});
