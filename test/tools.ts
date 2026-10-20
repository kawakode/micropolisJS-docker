import { BaseTool } from "../src/baseTool.js";
import { GameTools } from "../src/gameTools.js";
import { GameMap } from "../src/gameMap.js";
import { BLBNBIT, BULLBIT } from "../src/tileFlags";
import { DAM, DIRT, METRO, POLICEPOSTBASE, RIVER, RUBBLE, SCHOOL, TINYEXP, LASTTINYEXP, WOODS } from "../src/tileValues";

// Placing tools on a small, bare map, as the game does (see Game.handleTool)
const makeMap = (): any => new (GameMap as any)(20, 20, DIRT);
const makeTools = (map: any): any => new (GameTools as any)(map);

const apply = (map: any, tool: any, x: number, y: number) => {
    const budget = {totalFunds: 100000, spend: function(amount: number) { this.totalFunds -= amount; }};
    tool.doTool(x, y, null);
    const result = tool.result;
    const before = budget.totalFunds;
    tool.modifyIfEnoughFunding(budget);
    return {result: result, cost: before - budget.totalFunds, value: map.getTileValue(x, y)};
};

const OK = 0;
const FAILED = 1;
const NEEDS_BULLDOZE = 3;

describe("Automatic bulldozing", () => {

    afterEach(() => {
        BaseTool.setAutoBulldoze(true);
    });

    // Each tool, and its own cost
    const cases: Array<[string, number]> = [
        ["road", 10], ["dirtroad", 4], ["avenue", 25], ["rail", 20], ["wire", 5],
        ["park", 10], ["garden", 25], ["plaza", 40], ["water", 100],
    ];

    cases.forEach(([toolName, cost]) => {
        it(`lets the ${toolName} tool clear trees for $1`, () => {
            const map = makeMap();
            map.setTile(5, 5, WOODS, BLBNBIT);
            const tools = makeTools(map);

            const outcome = apply(map, tools[toolName], 5, 5);

            expect(outcome.result).toBe(OK);
            expect(outcome.cost).toBe(cost + 1);
            expect(outcome.value).not.toBe(WOODS);
        });

        it(`makes the ${toolName} tool ask for the bulldozer when it is off`, () => {
            BaseTool.setAutoBulldoze(false);
            const map = makeMap();
            map.setTile(5, 5, WOODS, BLBNBIT);
            const tools = makeTools(map);

            const outcome = apply(map, tools[toolName], 5, 5);

            expect(outcome.result).toBe(NEEDS_BULLDOZE);
            expect(outcome.cost).toBe(0);
            expect(outcome.value).toBe(WOODS);
        });
    });

    it("clears rubble to plant trees", () => {
        const map = makeMap();
        map.setTile(5, 5, RUBBLE, BULLBIT);
        const tools = makeTools(map);

        expect(apply(map, tools.trees, 5, 5)).toEqual({result: OK, cost: 6, value: WOODS});
    });

    it("clears the site of a building", () => {
        const map = makeMap();
        map.setTile(4, 4, WOODS, BLBNBIT);
        map.setTile(6, 6, RUBBLE, BULLBIT);
        const tools = makeTools(map);

        const outcome = apply(map, tools.school, 5, 5);

        expect(outcome.result).toBe(OK);
        expect(outcome.cost).toBe(1000 + 2);
        expect(outcome.value).toBe(SCHOOL);
    });

    it("leaves the site of a building alone when it is off", () => {
        BaseTool.setAutoBulldoze(false);
        const map = makeMap();
        map.setTile(4, 4, WOODS, BLBNBIT);
        const tools = makeTools(map);

        expect(apply(map, tools.school, 5, 5).result).toBe(NEEDS_BULLDOZE);
        expect(map.getTileValue(4, 4)).toBe(WOODS);
    });

    it("is kept in saved games", () => {
        BaseTool.setAutoBulldoze(false);
        const saveData: any = {};
        BaseTool.save(saveData);
        BaseTool.setAutoBulldoze(true);
        BaseTool.load(saveData);

        expect(BaseTool.getAutoBulldoze()).toBe(false);
    });
});

describe("The bulldozer", () => {

    it("does nothing on bare land", () => {
        const map = makeMap();
        const tools = makeTools(map);

        expect(apply(map, tools.bulldozer, 5, 5).result).toBe(FAILED);
    });

    it("has a tool for each size, all the same bulldozer", () => {
        const tools = makeTools(makeMap());

        expect(tools.bulldozer3).toBe(tools.bulldozer);
        expect(tools.bulldozer5).toBe(tools.bulldozer);
        expect(tools.bulldozer7).toBe(tools.bulldozer);
    });

    it("demolishes a building from any of its tiles, once in a batch", () => {
        const map = makeMap();
        const tools = makeTools(map);
        apply(map, tools.school, 5, 5);
        const bulldozer = tools.bulldozer;

        // Sweep the whole building, as a wide bulldozer does
        bulldozer.startBatch();
        let cost = 0;
        for (let y = 4; y <= 6; y++) {
            for (let x = 4; x <= 6; x++) {
                const outcome = apply(map, bulldozer, x, y);
                expect(outcome.result).toBe(OK);
                cost += outcome.cost;
            }
        }
        const demolished = bulldozer.getDemolished();
        bulldozer.endBatch();

        // Demolished once, and its explosions are left to play out
        expect(cost).toBe(1);
        expect(demolished.length).toBe(9);
        for (let y = 4; y <= 6; y++) {
            for (let x = 4; x <= 6; x++) {
                const value = map.getTileValue(x, y);
                expect(value >= TINYEXP && value <= LASTTINYEXP).toBe(true);
            }
        }
    });
});


describe("Rebuilding a road as another kind", () => {
    const drag = (map: any, tool: any, xs: number[], y: number) => {
        tool.startBatch(xs.length);
        const outcomes = xs.map((x) => apply(map, tool, x, y));
        tool.endBatch();
        return outcomes;
    };

    it("rebuilds a road clicked on its own, even as a smaller road", () => {
        const map = makeMap();
        const tools = makeTools(map);
        apply(map, tools.highway, 5, 5);

        const outcome = drag(map, tools.road, [5], 5)[0];
        expect([outcome.result, outcome.cost]).toEqual([OK, 10]);
        expect(map.getRoadClass(5, 5)).toBe((GameMap as any).ROAD_STREET);
    });

    it("leaves a bigger road as it is when a road is dragged across it, and upgrades smaller ones", () => {
        const map = makeMap();
        const tools = makeTools(map);
        apply(map, tools.highway, 6, 5);
        apply(map, tools.dirtroad, 7, 5);

        const outcomes = drag(map, tools.avenue, [5, 6, 7, 8], 5);
        expect(outcomes.map((o) => o.result)).toEqual([OK, FAILED, OK, OK]);
        expect([5, 6, 7, 8].map((x) => map.getRoadClass(x, 5))).toEqual([2, 3, 2, 2]);
    });

    it("charges a bridge's price for a bridge, and never makes it a dirt road", () => {
        const map = makeMap();
        const tools = makeTools(map);
        apply(map, tools.road, 4, 5);
        map.setTile(5, 5, RIVER, 0);
        const bridge = apply(map, tools.road, 5, 5);
        expect([bridge.result, bridge.cost]).toEqual([OK, 50]);

        expect(apply(map, tools.dirtroad, 5, 5).result).toBe(FAILED);
        expect(map.getRoadClass(5, 5)).toBe((GameMap as any).ROAD_STREET);

        const avenue = apply(map, tools.avenue, 5, 5);
        expect([avenue.result, avenue.cost]).toEqual([OK, 100]);
    });
});

describe("Digging water", () => {
    it("draws a bank along a road, as along bare land", () => {
        const map = makeMap();
        const tools = makeTools(map);
        apply(map, tools.road, 6, 5);

        expect(apply(map, tools.water, 5, 5).value).toBe(13);
        expect(apply(map, tools.water, 10, 10).value).toBe(13);
    });

    it("lets the water go on under a bridge", () => {
        const map = makeMap();
        const tools = makeTools(map);
        apply(map, tools.road, 4, 5);
        map.setTile(5, 5, RIVER, 0);
        apply(map, tools.road, 5, 5);

        // West of the dug tile is the bridge: water on that side only
        expect(apply(map, tools.water, 6, 5).value).not.toBe(13);
    });
});


describe("The dam", () => {
    it("is built across water only", () => {
        const map = makeMap();
        const tools = makeTools(map);
        expect(apply(map, tools.dam, 5, 5)).toEqual({result: FAILED, cost: 0, value: DIRT});

        for (let x = 4; x <= 6; x++)
            for (let y = 4; y <= 6; y++)
                map.setTile(x, y, RIVER, 0);
        map.setTile(6, 6, DIRT, 0);
        expect(apply(map, tools.dam, 5, 5).result).toBe(FAILED);

        map.setTile(6, 6, RIVER, 0);
        expect(apply(map, tools.dam, 5, 5)).toEqual({result: OK, cost: 4000, value: DAM});
    });

    it("gives the water back when it is demolished", () => {
        const map = makeMap();
        const tools = makeTools(map);
        for (let x = 4; x <= 6; x++)
            for (let y = 4; y <= 6; y++)
                map.setTile(x, y, RIVER, 0);
        apply(map, tools.dam, 5, 5);

        expect(apply(map, tools.bulldozer, 4, 6).result).toBe(OK);
        for (let x = 4; x <= 6; x++)
            for (let y = 4; y <= 6; y++)
                expect(map.getTileValue(x, y)).toBe(RIVER);
    });
});


describe("The metro", () => {
    it("lays its tunnels under anything, at $100 a tile, once", () => {
        const map = makeMap();
        const tools = makeTools(map);
        expect(apply(map, tools.metro, 5, 5)).toEqual({result: OK, cost: 500, value: METRO});
        expect(apply(map, tools.metroline, 5, 5)).toEqual({result: OK, cost: 100, value: METRO});
        expect(map.hasTunnel(5, 5)).toBe(true);
        expect(apply(map, tools.metroline, 5, 5).cost).toBe(0);

        map.setTile(6, 5, RIVER, 0);
        expect(apply(map, tools.metroline, 6, 5)).toEqual({result: OK, cost: 100, value: RIVER});
    });

    it("keeps the road above its tunnel, and the tunnel under a road", () => {
        const map = makeMap();
        const tools = makeTools(map);
        apply(map, tools.metroline, 5, 5);
        apply(map, tools.avenue, 5, 5);
        expect(map.hasTunnel(5, 5)).toBe(true);
        expect(map.getRoadClass(5, 5)).toBe((GameMap as any).ROAD_AVENUE);
    });

    it("has its tunnels filled in by the bulldozer, where nothing is built", () => {
        const map = makeMap();
        const tools = makeTools(map);
        apply(map, tools.metroline, 5, 5);
        apply(map, tools.metro, 5, 5);
        // The station is demolished first, then the tunnel filled in
        apply(map, tools.bulldozer, 5, 5);
        expect(map.hasTunnel(5, 5)).toBe(true);
        map.setTile(5, 5, DIRT, 0);
        expect(apply(map, tools.bulldozer, 5, 5)).toEqual({result: OK, cost: 1, value: DIRT});
        expect(map.hasTunnel(5, 5)).toBe(false);
    });
});


describe("A 2x2 building", () => {
    it("covers its centre tile and the tiles above and to the left of it, as the cursor shows", () => {
        const map = makeMap();
        const tools = makeTools(map);
        expect(apply(map, tools.policepost, 5, 5).result).toBe(OK);
        expect(map.getTileValue(4, 4)).toBe(POLICEPOSTBASE);
        expect(map.getTileValue(5, 5)).toBe(POLICEPOSTBASE + 3);
        expect(map.getTileValue(6, 6)).toBe(DIRT);
    });
});
