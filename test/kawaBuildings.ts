// KawaCity's buildings on the map (their road access, and fires), and its kinds of road
import { BlockMapUtils } from "../src/blockMapUtils.js";
import { Budget } from "../src/budget.js";
import { GameMap } from "../src/gameMap.js";
import { KawaBuildings } from "../src/kawaBuildings.js";
import { Ordinances } from "../src/ordinances.js";
import { Simulation } from "../src/simulation.js";
import { Traffic } from "../src/traffic.js";
import { ZoneUtils } from "../src/zoneUtils.js";
import { BULLBIT, ZONEBIT } from "../src/tileFlags";
import { BUSDEPOT, BUSSTOP, DIRT, FIREPOST, HOSPITAL, HRAIL, LIBRARY, POLICEPOST, POWERPLANT, RECYCLING, RIVER, ROADS, WATERWORKS, WINDTURBINE,
         WINDTURBINE1 } from "../src/tileValues";

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


describe("The kind of road the traffic drives on", () => {
    it("is a street's where a rail was laid over an old highway", () => {
        const map = makeMap();
        map.setTile(5, 5, ROADS, 0);
        map.setRoadClass(5, 5, (GameMap as any).ROAD_HIGHWAY);
        const traffic = new (Traffic as any)(map, null);
        expect(traffic._roadClassAt(5, 5)).toBe((GameMap as any).ROAD_HIGHWAY);

        map.setTile(5, 5, HRAIL, 0);
        expect(traffic._roadClassAt(5, 5)).toBe((GameMap as any).ROAD_STREET);
        expect(traffic._isHighway(5, 5)).toBe(false);
    });
});


describe("A trip on the roads", () => {
    it("turns around at a dead end instead of failing", () => {
        const map = makeMap();
        for (let x = 2; x <= 12; x++)
            map.setTile(x, 5, ROADS, 0);
        const traffic = new (Traffic as any)(map, null);
        // The destination is beyond the west end of the road; the east end is a dead end
        const destination = (value: number) => value === WINDTURBINE;
        map.setTile(1, 5, WINDTURBINE, 0);

        let found = 0;
        for (let i = 0; i < 40; i++) {
            traffic._stack = [];
            if (traffic.tryDrive({x: 7, y: 5}, destination))
                found++;
        }
        expect(found).toBe(40);
    });
});


describe("A hospital", () => {
    const withHospital = (road: boolean): any => {
        const simulation = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED);
        const map = simulation._map;
        (ZoneUtils as any).putZone(map, 20, 20, HOSPITAL, false);
        if (road)
            map.setTile(22, 21, ROADS, 0);
        simulation._clearCensus();
        simulation._mapScanner.mapScan(0, map.width, simulation._constructSimData());
        BlockMapUtils.crimeScan({}, simulation.blockMaps);
        return simulation;
    };

    it("is counted by the census, and cares for the neighbourhood around it", () => {
        const simulation = withHospital(true);
        const health = simulation.blockMaps.healthEffectMap;
        expect(simulation._census.hospitalPop).toBe(1);
        expect(health.worldGet(20, 20)).toBeGreaterThan(0);
        expect(health.worldGet(20, 20)).toBeGreaterThan(health.worldGet(36, 20));
        expect(health.worldGet(100, 80)).toBe(0);
    });

    it("cares less without a road", () => {
        const withRoad = withHospital(true).blockMaps.healthEffectMap.worldGet(20, 20);
        const withoutRoad = withHospital(false).blockMaps.healthEffectMap.worldGet(20, 20);
        expect(withoutRoad).toBeLessThan(withRoad);
    });

    it("costs $150 a year", () => {
        const budget = new (Budget as any)();
        budget.setFunds(1000);
        budget.collectTax(0, {totalPop: 0, hospitalPop: 2, policeStationPop: 0, fireStationPop: 0,
                              roadTotal: 0, railTotal: 0, landValueAverage: 0}, 0);
        expect(budget.upkeepFund).toBe(-300);
    });
});


describe("The compact stations and the library", () => {
    const scanned = (centre: number): any => {
        const simulation = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED);
        const map = simulation._map;
        (ZoneUtils as any).putZone(map, 20, 20, centre, true);
        // The building covers 19..20: a road along its right edge
        map.setTile(21, 20, ROADS, 0);
        simulation._clearCensus();
        simulation._mapScanner.mapScan(0, map.width, simulation._constructSimData());
        return simulation;
    };

    it("are 2x2 buildings, demolished whole", () => {
        [LIBRARY, POLICEPOST, FIREPOST].forEach((centre) => expect((ZoneUtils as any).getZoneSize(centre)).toBe(2));
    });

    it("cover their neighbourhood half as well as a big station, for the same budget", () => {
        const post = scanned(POLICEPOST);
        expect(post._census.policePostPop).toBe(1);
        // Half as strong, and half again without power (there is no power plant)
        expect(post.blockMaps.policeStationMap.worldGet(20, 20)).toBe(Math.floor(post.budget.policeEffect / 4));

        const fire = scanned(FIREPOST);
        expect(fire._census.firePostPop).toBe(1);
        expect(fire.blockMaps.fireStationMap.worldGet(20, 20)).toBeGreaterThan(0);
    });

    it("educate a little, like a small school", () => {
        const library = scanned(LIBRARY);
        expect(library._census.libraryPop).toBe(1);
        // Half as strong without power
        expect(library.blockMaps.educationMap.worldGet(20, 20)).toBe(200);
    });

    it("cost half the upkeep of a big station", () => {
        const budget = new (Budget as any)();
        budget.setFunds(1000);
        budget.collectTax(0, {totalPop: 0, policeStationPop: 1, policePostPop: 2, fireStationPop: 0, firePostPop: 1,
                              libraryPop: 1, roadTotal: 0, railTotal: 0, landValueAverage: 0}, 0);
        expect(budget.policeMaintenanceBudget).toBe(200);
        expect(budget.fireMaintenanceBudget).toBe(50);
        expect(budget.upkeepFund).toBe(-50);
    });
});


describe("The recycling centre and the water treatment plant", () => {
    const scanned = (centre: number | null, recycles: boolean): any => {
        const simulation = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED);
        const map = simulation._map;
        if (recycles)
            simulation.budget.setOrdinances(1 << (Ordinances as any).byId("recycling").bit);
        if (centre !== null)
            (ZoneUtils as any).putZone(map, 20, 20, centre, true);
        simulation._clearCensus();
        simulation._mapScanner.mapScan(0, map.width, simulation._constructSimData());
        BlockMapUtils.crimeScan({}, simulation.blockMaps);
        return simulation;
    };

    it("sorts the waste only when the city recycles", () => {
        expect(scanned(RECYCLING, false).blockMaps.cleanupEffectMap.worldGet(20, 20)).toBe(0);
        const recycling = scanned(RECYCLING, true);
        expect(recycling._census.recyclingPop).toBe(1);
        expect(recycling.blockMaps.cleanupEffectMap.worldGet(20, 20)).toBeGreaterThan(0);
    });

    it("cleans up the pollution of the neighbourhood, by up to half", () => {
        const pollutionNear = (withPlant: boolean): number => {
            const simulation = scanned(withPlant ? WATERWORKS : null, false);
            const map = simulation._map;
            // A tile of a coal plant just beside it
            map.setTile(24, 18, POWERPLANT, 0);
            BlockMapUtils.pollutionTerrainLandValueScan(map, simulation._census, simulation.blockMaps);
            return simulation.blockMaps.pollutionDensityMap.worldGet(24, 18);
        };

        const polluted = pollutionNear(false);
        expect(polluted).toBeGreaterThan(0);
        expect(pollutionNear(true)).toBeLessThan(polluted);
        expect(pollutionNear(true)).toBeGreaterThanOrEqual(Math.floor(polluted / 2) - 1);
    });

    it("makes the land by the water more valuable", () => {
        const landValueByWater = (withPlant: boolean): number => {
            const simulation = scanned(withPlant ? WATERWORKS : null, false);
            const map = simulation._map;
            map.setTile(24, 26, RIVER, 0);
            map.setTile(22, 24, ROADS, 0);
            BlockMapUtils.pollutionTerrainLandValueScan(map, simulation._census, simulation.blockMaps);
            return simulation.blockMaps.landValueMap.worldGet(22, 24);
        };

        expect(landValueByWater(true)).toBeGreaterThan(landValueByWater(false));
    });
});


describe("The buses", () => {
    const transitAt = (withDepot: boolean): any => {
        const simulation = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED);
        const map = simulation._map;
        map.setTile(20, 20, BUSSTOP, ZONEBIT);
        map.setTile(21, 20, ROADS, 0);
        if (withDepot)
            (ZoneUtils as any).putZone(map, 60, 60, BUSDEPOT, true);
        simulation._clearCensus();
        simulation._mapScanner.mapScan(0, map.width, simulation._constructSimData());
        BlockMapUtils.crimeScan(simulation._census, simulation.blockMaps);
        return simulation;
    };

    it("only run once the city has a depot", () => {
        const noDepot = transitAt(false);
        expect(noDepot._census.busStopPop).toBe(1);
        expect(noDepot.blockMaps.transitEffectMap.worldGet(20, 20)).toBe(0);
        expect(transitAt(true).blockMaps.transitEffectMap.worldGet(20, 20)).toBeGreaterThan(0);
    });

    it("take cars off the roads around the stops", () => {
        const trafficAfterTrip = (withDepot: boolean): number => {
            const simulation = transitAt(withDepot);
            const traffic = new (Traffic as any)(simulation._map, simulation.spriteManager);
            traffic._stack = [{x: 21, y: 20}];
            traffic.addToTrafficDensityMap(simulation.blockMaps);
            return simulation.blockMaps.trafficDensityMap.worldGet(21, 20);
        };

        expect(trafficAfterTrip(true)).toBeLessThan(trafficAfterTrip(false));
        expect(trafficAfterTrip(true)).toBeGreaterThanOrEqual(Math.floor(trafficAfterTrip(false) / 2));
    });
});
