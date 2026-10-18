import { Budget } from "../src/budget.js";
import { GameMap } from "../src/gameMap.js";
import { Neighbours } from "../src/neighbours.js";
import { PowerManager } from "../src/powerManager.js";
import { Position } from "../src/position";
import { BULLBIT, BURNBIT, CONDBIT } from "../src/tileFlags";
import { DIRT, LHPOWER, ROADS } from "../src/tileValues";

// A bare map, with neighbours of a known size
const makeMap = (): any => new (GameMap as any)(30, 20, DIRT);

const sequence = (seed: number) => () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
};

const makeNeighbours = (map: any = makeMap(), population = 50000): any => {
    const neighbours = new (Neighbours as any)(map, sequence(5));
    neighbours.generate();
    neighbours.list.forEach((n: any) => { n.population = population; });
    return neighbours;
};

const road = (map: any, x: number, y: number) => map.setTile(x, y, ROADS, BULLBIT | BURNBIT);
const wire = (map: any, x: number, y: number) => map.setTile(x, y, LHPOWER, CONDBIT | BURNBIT | BULLBIT);

// A power line along a row, from the west edge
const wireRow = (map: any, y: number, length: number) => {
    for (let x = 0; x < length; x++)
        wire(map, x, y);
};

const census = (changes: any = {}): any => Object.assign({coalPowerPop: 0, nuclearPowerPop: 0, gasPowerPop: 0,
                                                          solarPowerPop: 0, windPowerPop: 0}, changes);

const scanPower = (map: any, neighbours: any, plants: any = {}) => {
    const power = new (PowerManager as any)(map);
    power.clearPowerStack();
    neighbours.findLinks();
    power.doPowerScan(census(plants), neighbours.powerSupply());
    neighbours.deliverPower(power.powerGridMap, power.spare);
    return power;
};


describe("The neighbouring cities", () => {

    it("are one beyond each edge of the map, each with its own name", () => {
        const neighbours = new (Neighbours as any)(makeMap(), sequence(3));
        neighbours.generate();

        expect(neighbours.list.map((n: any) => n.side)).toEqual(["north", "east", "south", "west"]);
        expect(new Set(neighbours.list.map((n: any) => n.name)).size).toBe(4);
        neighbours.list.forEach((n: any) => {
            expect(n.population).toBeGreaterThanOrEqual(3000);
            expect(n.population).toBeLessThanOrEqual(93000);
            expect(Object.values(n.deals).every(signed => signed === false)).toBe(true);
        });
    });

    it("are saved with the game", () => {
        const neighbours = makeNeighbours();
        neighbours.setDeal("east", "trade", true);
        neighbours.list[1].months.trade = 4;
        const saveData: any = {};
        neighbours.save(saveData);

        const loaded = new (Neighbours as any)(makeMap());
        loaded.load(JSON.parse(JSON.stringify(saveData)));
        expect(loaded.list).toEqual(neighbours.list);
    });

    it("are found anew for a game saved before there were neighbours", () => {
        const loaded = new (Neighbours as any)(makeMap(), sequence(9));
        loaded.load({});
        expect(loaded.list.length).toBe(4);
        loaded.load({neighbours: [{side: "north"}]});
        expect(loaded.list.map((n: any) => n.side)).toEqual(["north", "east", "south", "west"]);
    });

    it("are linked by the roads, railways and power lines reaching their edge", () => {
        const map = makeMap();
        road(map, 10, 0);
        wire(map, 29, 5);
        road(map, 10, 1);
        const links = makeNeighbours(map).findLinks();

        expect(links.north.transport).toBe(true);
        expect(links.north.power).toEqual([]);
        expect(links.east.transport).toBe(false);
        expect(links.east.power).toEqual([new Position(29, 5)]);
        expect(links.south).toEqual({transport: false, power: []});
        expect(links.west).toEqual({transport: false, power: []});
    });

    it("put deals on hold until their link is built, except twinning", () => {
        const map = makeMap();
        const neighbours = makeNeighbours(map);
        const north = neighbours.get("north");

        expect(neighbours.dealState(north, "trade")).toBe("noLink");
        expect(neighbours.dealState(north, "buyPower")).toBe("noLink");
        expect(neighbours.dealState(north, "twinning")).toBe("active");

        road(map, 3, 0);
        neighbours.findLinks();
        expect(neighbours.dealState(north, "trade")).toBe("active");
    });

    it("can't both buy power from a neighbour and sell it some", () => {
        const neighbours = makeNeighbours();
        neighbours.setDeal("west", "buyPower", true);
        neighbours.setDeal("west", "sellPower", true);
        expect(neighbours.get("west").deals).toEqual({trade: false, buyPower: false, sellPower: true, twinning: false});

        neighbours.setDeal("west", "buyPower", true);
        expect(neighbours.get("west").deals.sellPower).toBe(false);
        neighbours.setDeal("west", "trade", true);
        neighbours.setDeal("west", "trade", false);
        expect(neighbours.get("west").deals.buyPower).toBe(true);
    });

    it("add to the demand while the deals are in force, more for bigger neighbours", () => {
        const map = makeMap();
        const neighbours = makeNeighbours(map, 0);
        neighbours.setDeal("north", "trade", true);
        neighbours.setDeal("south", "twinning", true);
        expect(neighbours.demandBonus()).toEqual({res: 10, com: 0, ind: 0});

        road(map, 3, 0);
        neighbours.findLinks();
        expect(neighbours.demandBonus()).toEqual({res: 10, com: 15, ind: 15});

        neighbours.list.forEach((n: any) => { n.population = 200000; });
        expect(neighbours.demandBonus()).toEqual({res: 30, com: 50, ind: 50});
    });

    it("feed the power grid by the power line at their edge", () => {
        const map = makeMap();
        wireRow(map, 5, 12);
        const neighbours = makeNeighbours(map);

        // No power plant, and no deal: no power
        expect(scanPower(map, neighbours).powerGridMap.worldGet(11, 5)).toBe(0);

        neighbours.setDeal("west", "buyPower", true);
        const power = scanPower(map, neighbours);
        expect(power.powerGridMap.worldGet(0, 5)).toBe(1);
        expect(power.powerGridMap.worldGet(11, 5)).toBe(1);
        expect(power.spare).toBe(Neighbours.POWER_DEAL - 12);
        expect(neighbours.powerSupply().capacity).toBe(Neighbours.POWER_DEAL);
    });

    it("get the power they buy when the grid reaches their edge with power to spare", () => {
        const map = makeMap();
        wireRow(map, 5, 12);
        const neighbours = makeNeighbours(map);
        neighbours.setDeal("west", "sellPower", true);
        const west = neighbours.get("west");

        // A power line from a plant to the edge: the plant is at the line's far end, where the scan starts
        const scanWithPlant = (plants: any) => {
            const power = new (PowerManager as any)(map);
            power.clearPowerStack();
            neighbours.findLinks();
            power._powerStack.push(new Position(11, 5));
            power.doPowerScan(census(plants), neighbours.powerSupply());
            neighbours.deliverPower(power.powerGridMap, power.spare);
        };

        // A wind turbine has too little power to spare
        scanWithPlant({windPowerPop: 1});
        expect(neighbours.dealState(west, "sellPower")).toBe("noPower");

        scanWithPlant({coalPowerPop: 1});
        expect(neighbours.dealState(west, "sellPower")).toBe("active");

        // The line is cut before the edge
        map.setTile(0, 5, DIRT, 0);
        wire(map, 0, 6);
        scanWithPlant({coalPowerPop: 1});
        expect(neighbours.dealState(west, "sellPower")).toBe("noPower");
    });

    it("are paid for the months they were in force, and grow", () => {
        const map = makeMap();
        road(map, 0, 7);
        const neighbours = makeNeighbours(map, 100000);
        neighbours.findLinks();
        neighbours.setDeal("west", "trade", true);
        neighbours.setDeal("north", "trade", true);
        neighbours.setDeal("east", "twinning", true);

        for (let month = 0; month < 6; month++)
            neighbours.countMonth();
        neighbours.setDeal("east", "twinning", false);
        for (let month = 0; month < 6; month++)
            neighbours.countMonth();

        // A whole year of trade with the west (the north has no link), and half a year of twinning
        expect(neighbours.yearlyBalance()).toBe(-250);
        expect(neighbours.closeYear()).toBe(-250 - 50);
        expect(neighbours.closeYear()).toBe(0);
        neighbours.list.forEach((n: any) => expect(n.population).toBeGreaterThan(100000));
    });

    it("tell which deals are on hold, and why", () => {
        const neighbours = makeNeighbours();
        neighbours.setDeal("south", "trade", true);
        neighbours.setDeal("north", "twinning", true);
        neighbours.setDeal("east", "sellPower", true);
        expect(neighbours.dealsOnHold().map((d: any) => [d.side, d.kind, d.state])).toEqual([
            ["east", "sellPower", "noLink"], ["south", "trade", "noLink"]]);
        expect(neighbours.activeDeals()).toBe(1);
    });
});


describe("The budget, with deals", () => {

    it("pays for the deals with the taxes", () => {
        const budget = new (Budget as any)();
        budget.setFunds(1000);
        budget.collectTax(1, {policeStationPop: 0, fireStationPop: 0, roadTotal: 0, railTotal: 0, totalPop: 100,
                              landValueAverage: 120}, -300);

        expect(budget.dealsFund).toBe(-300);
        expect(budget.cashFlow).toBe(budget.taxFund - 300);
        expect(budget.totalFunds).toBe(1000 + budget.taxFund - 300);
    });

    it("settles the deals before anyone lives in the city", () => {
        const budget = new (Budget as any)();
        budget.setFunds(1000);
        budget.collectTax(1, {policeStationPop: 0, fireStationPop: 0, roadTotal: 0, railTotal: 0, totalPop: 0,
                              landValueAverage: 0}, 150);
        expect(budget.totalFunds).toBe(1150);
    });
});
