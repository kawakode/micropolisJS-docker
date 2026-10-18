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

    it("keep the names read from a save short, and without control or format characters", () => {
        const saveData: any = {};
        makeNeighbours().save(saveData);
        saveData.neighbours[0].name = "New\u202eYork\u0000\n" + "x".repeat(40);
        saveData.neighbours[1].name = "Zero\u200bWidth\ufeff";
        saveData.neighbours[2].name = "\u{1f3d9}".repeat(31);

        const loaded = new (Neighbours as any)(makeMap());
        loaded.load(saveData);
        expect(loaded.list[0].name).toBe("NewYork" + "x".repeat(23));
        expect(loaded.list[1].name).toBe("ZeroWidth");
        expect(loaded.list[2].name).toBe("\u{1f3d9}".repeat(30));
        expect(loaded.list[3].name).toBe(saveData.neighbours[3].name);
        expect((Neighbours as any).MAX_NAME_LENGTH).toBe(30);
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


// What a player's city has at the edge facing this one (see Neighbours.edgeState)
const edge = (signed: string[] = [], links: any = {}): any => Object.assign({transport: false, power: false,
    powerOut: false, signed: {trade: signed.indexOf("trade") !== -1, buyPower: signed.indexOf("buyPower") !== -1,
                              sellPower: signed.indexOf("sellPower") !== -1, twinning: signed.indexOf("twinning") !== -1}},
    links);

const player = (changes: any = {}): any => Object.assign({cityId: "Ab3_Ab3_Ab3_Ab3_Ab3_Ab", name: "Lyon",
                                                          ownerName: "bob", population: 200000, edge: edge()}, changes);

// Everything the neighbours tell the rest of the game
const everything = (neighbours: any): string => JSON.stringify({
    describe: neighbours.describe(), onHold: neighbours.dealsOnHold(), demand: neighbours.demandBonus(),
    supply: neighbours.powerSupply(), active: neighbours.activeDeals(), balance: neighbours.yearlyBalance(),
    states: neighbours.list.map((n: any) => (Neighbours as any).KINDS.map((kind: string) => neighbours.dealState(n, kind))),
    edges: neighbours.edgeState()});


describe("A neighbour that is another player's city", () => {

    it("replaces the neighbour of the save, which stays as it was", () => {
        const neighbours = makeNeighbours(makeMap(), 50000);
        const saved: any = {};
        neighbours.save(saved);
        const north = neighbours.get("north");
        expect(neighbours.yearly(north, "trade")).toBe(-175);

        neighbours.setRemote("north", player());
        const described = neighbours.describe();

        expect(described[0]).toMatchObject({side: "north", name: "Lyon", population: 200000, player: true,
                                            ownerName: "bob", cityId: "Ab3_Ab3_Ab3_Ab3_Ab3_Ab",
                                            theirLinks: {transport: false, power: false}});
        expect(described[0].deals.map((deal: any) => deal.theirs)).toEqual([false, false, false, false]);
        expect(neighbours.yearly(north, "trade")).toBe(-250);
        expect(neighbours.sizeOf(north)).toBe(1);
        expect(described[1].name).toBe(saved.neighbours[1].name);
        expect(described[1].player).toBeUndefined();

        const again: any = {};
        neighbours.save(again);
        expect(again).toEqual(saved);
        expect(JSON.stringify(again)).not.toContain("Lyon");

        neighbours.setRemote("north", null);
        expect(neighbours.describe()[0].name).toBe(saved.neighbours[0].name);
        expect(neighbours.getRemote("north")).toBeNull();
    });

    it("changes nothing when there is none", () => {
        const map = makeMap();
        road(map, 3, 0);
        wireRow(map, 5, 12);
        const neighbours = makeNeighbours(map);
        neighbours.setDeal("north", "trade", true);
        neighbours.setDeal("west", "sellPower", true);
        neighbours.setDeal("east", "twinning", true);
        neighbours.setDeal("south", "buyPower", true);
        scanPower(map, neighbours, {coalPowerPop: 1});
        const before = everything(neighbours);

        neighbours.setRemote("north", player({edge: edge(["trade"], {transport: true})}));
        neighbours.setRemote("west", player());
        expect(everything(neighbours)).not.toBe(before);
        neighbours.setRemote("north", null);
        neighbours.setRemote("west", undefined);

        expect(everything(neighbours)).toBe(before);
        const described = neighbours.describe();
        described.forEach((n: any) => {
            expect(Object.keys(n)).toEqual(["side", "name", "population", "links", "deals"]);
            n.deals.forEach((deal: any) => expect(Object.keys(deal)).toEqual(["kind", "signed", "state", "yearly"]));
        });
        neighbours.dealsOnHold().forEach((deal: any) => expect(Object.keys(deal)).toEqual(["side", "name", "kind", "state"]));
        expect(neighbours.remote).toEqual({});
    });

    it("puts a deal in force once both cities signed it and have their link", () => {
        const map = makeMap();
        road(map, 3, 0);
        const neighbours = makeNeighbours(map, 0);
        neighbours.findLinks();
        const north = neighbours.get("north");
        neighbours.setRemote("north", player());
        neighbours.setDeal("north", "trade", true);

        expect(neighbours.dealState(north, "trade")).toBe("proposed");
        expect(neighbours.demandBonus()).toEqual({res: 0, com: 0, ind: 0});

        // Their twinning is not our trade
        neighbours.setRemote("north", player({edge: edge(["twinning"], {transport: true})}));
        expect(neighbours.dealState(north, "trade")).toBe("proposed");

        neighbours.setRemote("north", player({edge: edge(["trade"])}));
        expect(neighbours.dealState(north, "trade")).toBe("theirLink");
        expect(neighbours.activeDeals()).toBe(0);

        neighbours.setRemote("north", player({edge: edge(["trade"], {transport: true})}));
        expect(neighbours.dealState(north, "trade")).toBe("active");
        expect(neighbours.demandBonus()).toEqual({res: 0, com: 50, ind: 50});
        expect(neighbours.activeDeals()).toBe(1);
        expect(neighbours.yearlyBalance()).toBe(-250);

        // Our link comes first
        map.setTile(3, 0, DIRT, 0);
        neighbours.findLinks();
        expect(neighbours.dealState(north, "trade")).toBe("noLink");
    });

    it("offers the deals it signed", () => {
        const map = makeMap();
        road(map, 3, 0);
        const neighbours = makeNeighbours(map);
        neighbours.findLinks();
        const north = neighbours.get("north");
        neighbours.setRemote("north", player({edge: edge(["trade", "twinning", "buyPower"], {transport: true})}));

        expect(neighbours.dealState(north, "trade")).toBe("offered");
        expect(neighbours.dealState(north, "twinning")).toBe("offered");
        expect(neighbours.dealState(north, "buyPower")).toBe("noLink");
        expect(neighbours.dealState(north, "sellPower")).toBe("noLink");
        expect(neighbours.activeDeals()).toBe(0);
        expect(neighbours.describe()[0].deals.map((deal: any) => [deal.kind, deal.theirs])).toEqual([
            ["trade", true], ["buyPower", false], ["sellPower", true], ["twinning", true]]);

        neighbours.setDeal("north", "twinning", true);
        expect(neighbours.dealState(north, "twinning")).toBe("active");
        expect(neighbours.demandBonus()).toEqual({res: 30, com: 0, ind: 0});
    });

    it("tells the news what its deals wait for", () => {
        const map = makeMap();
        road(map, 3, 0);
        const neighbours = makeNeighbours(map);
        neighbours.findLinks();
        neighbours.setRemote("north", player({edge: edge(["twinning", "buyPower"], {transport: false})}));
        neighbours.setDeal("north", "trade", true);
        neighbours.setDeal("north", "sellPower", true);
        neighbours.setDeal("south", "trade", true);

        expect(neighbours.dealsOnHold()).toEqual([
            {side: "north", name: "Lyon", kind: "trade", state: "proposed", player: true, ownerName: "bob"},
            {side: "north", name: "Lyon", kind: "sellPower", state: "noLink", player: true, ownerName: "bob"},
            {side: "north", name: "Lyon", kind: "twinning", state: "offered", player: true, ownerName: "bob"},
            {side: "south", name: neighbours.get("south").name, kind: "trade", state: "noLink"}]);

        neighbours.setRemote("north", player({edge: edge(["trade"])}));
        expect(neighbours.dealsOnHold()[0]).toMatchObject({kind: "trade", state: "theirLink"});
    });

    it("sells power when it agreed to buy it and has its power line", () => {
        const map = makeMap();
        wireRow(map, 5, 12);
        const neighbours = makeNeighbours(map);
        neighbours.setDeal("west", "sellPower", true);
        const west = neighbours.get("west");

        const scanWithPlant = () => {
            const power = new (PowerManager as any)(map);
            power.clearPowerStack();
            neighbours.findLinks();
            power._powerStack.push(new Position(11, 5));
            power.doPowerScan(census({coalPowerPop: 1}), neighbours.powerSupply());
            neighbours.deliverPower(power.powerGridMap, power.spare);
        };

        neighbours.setRemote("west", player({edge: edge([], {power: true})}));
        scanWithPlant();
        expect(neighbours.dealState(west, "sellPower")).toBe("proposed");
        expect(neighbours.edgeState().west.powerOut).toBe(false);

        neighbours.setRemote("west", player({edge: edge(["buyPower"])}));
        scanWithPlant();
        expect(neighbours.dealState(west, "sellPower")).toBe("theirLink");
        expect(neighbours.edgeState().west.powerOut).toBe(false);

        neighbours.setRemote("west", player({edge: edge(["buyPower"], {power: true})}));
        scanWithPlant();
        expect(neighbours.dealState(west, "sellPower")).toBe("active");
        expect(neighbours.edgeState().west).toEqual({transport: false, power: true, powerOut: true,
            signed: {trade: false, buyPower: false, sellPower: true, twinning: false}});
    });

    it("leaves the spare power to the deals agreed", () => {
        // A line from a plant reaching the north and west edges: enough power to spare for one sale only
        const map = makeMap();
        wireRow(map, 5, 12);
        for (let y = 0; y < 5; y++)
            wire(map, 11, y);
        const neighbours = makeNeighbours(map);
        neighbours.setDeal("north", "sellPower", true);
        neighbours.setDeal("west", "sellPower", true);
        neighbours.setRemote("north", player({edge: edge([], {power: true})}));

        const power = new (PowerManager as any)(map);
        power.clearPowerStack();
        neighbours.findLinks();
        power._powerStack.push(new Position(11, 5));
        power.doPowerScan(census({coalPowerPop: 1}), neighbours.powerSupply());
        expect(power.spare).toBeGreaterThanOrEqual(Neighbours.POWER_DEAL);
        expect(power.spare).toBeLessThan(2 * Neighbours.POWER_DEAL);
        neighbours.deliverPower(power.powerGridMap, power.spare);

        expect(neighbours.edgeState().north.powerOut).toBe(false);
        expect(neighbours.dealState(neighbours.get("west"), "sellPower")).toBe("active");
    });

    it("sends the power bought from it only when it has power to send", () => {
        const map = makeMap();
        wireRow(map, 5, 12);
        const neighbours = makeNeighbours(map);
        const west = neighbours.get("west");
        neighbours.setDeal("west", "buyPower", true);
        neighbours.setRemote("west", player({edge: edge(["sellPower"], {power: true})}));
        neighbours.findLinks();

        expect(neighbours.dealState(west, "buyPower")).toBe("noPower");
        expect(neighbours.powerSupply()).toEqual({capacity: 0, sources: []});
        expect(scanPower(map, neighbours).powerGridMap.worldGet(11, 5)).toBe(0);

        neighbours.setRemote("west", player({edge: edge(["sellPower"], {power: true, powerOut: true})}));
        expect(neighbours.dealState(west, "buyPower")).toBe("active");
        expect(neighbours.powerSupply()).toEqual({capacity: Neighbours.POWER_DEAL, sources: [new Position(0, 5)]});
        expect(scanPower(map, neighbours).powerGridMap.worldGet(11, 5)).toBe(1);
        expect(neighbours.dealsOnHold()).toEqual([]);
    });

    it("is paid for the months its deals were in force, but does not grow with this city", () => {
        const map = makeMap();
        road(map, 3, 0);
        road(map, 0, 7);
        const neighbours = makeNeighbours(map, 100000);
        neighbours.findLinks();
        neighbours.setRemote("north", player({population: 150000, edge: edge(["trade"], {transport: true})}));
        neighbours.setDeal("north", "trade", true);
        neighbours.setDeal("west", "trade", true);

        for (let month = 0; month < 12; month++)
            neighbours.countMonth();
        expect(neighbours.get("north").months.trade).toBe(12);
        expect(neighbours.closeYear()).toBe(-250 - 250);

        expect(neighbours.get("north").population).toBe(100000);
        expect(neighbours.getRemote("north").population).toBe(150000);
        expect(neighbours.get("west").population).toBeGreaterThan(100000);
    });

    it("counts no month while the other city has not signed", () => {
        const map = makeMap();
        road(map, 3, 0);
        const neighbours = makeNeighbours(map);
        neighbours.findLinks();
        neighbours.setRemote("north", player({edge: edge([], {transport: true})}));
        neighbours.setDeal("north", "trade", true);

        neighbours.countMonth();
        expect(neighbours.get("north").months.trade).toBe(0);
        expect(neighbours.closeYear()).toBe(0);
    });

    it("tells what this city has at each edge", () => {
        const map = makeMap();
        road(map, 3, 0);
        wire(map, 29, 5);
        const neighbours = makeNeighbours(map);
        neighbours.setDeal("north", "trade", true);
        neighbours.setDeal("east", "buyPower", true);

        const state = neighbours.edgeState();
        expect(Object.keys(state)).toEqual(["north", "east", "south", "west"]);
        expect(state.north).toEqual({transport: true, power: false, powerOut: false,
                                     signed: {trade: true, buyPower: false, sellPower: false, twinning: false}});
        expect(state.east).toEqual({transport: false, power: true, powerOut: false,
                                    signed: {trade: false, buyPower: true, sellPower: false, twinning: false}});

        state.north.signed.trade = false;
        expect(neighbours.get("north").deals.trade).toBe(true);

        // Each city's state is what the other one is told
        const other = makeNeighbours(makeMap());
        other.setRemote("south", player({edge: neighbours.edgeState().north}));
        other.setDeal("south", "trade", true);
        road(other._map, 3, 19);
        other.findLinks();
        expect(other.dealState(other.get("south"), "trade")).toBe("active");
    });

    it("is kept in shape, with a short name", () => {
        const neighbours = makeNeighbours();
        neighbours.setRemote("east", {cityId: 42, name: "Grand‮Lyon" + "x".repeat(40), ownerName: "bob\u0000",
                                      population: -5, edge: {transport: "yes", power: 1, powerOut: true,
                                                             signed: {trade: true, buyPower: "true", extra: true}},
                                      extra: "dropped"});
        expect(neighbours.getRemote("east")).toEqual({cityId: "42", name: "GrandLyon" + "x".repeat(21), ownerName: "bob",
            population: 0, edge: {transport: false, power: false, powerOut: true,
                                  signed: {trade: true, buyPower: false, sellPower: false, twinning: false}}});

        neighbours.setRemote("west", {cityId: "w", name: "Nice", ownerName: "eve", population: NaN, edge: null});
        expect(neighbours.getRemote("west").population).toBe(0);
        expect(neighbours.getRemote("west").edge.signed.trade).toBe(false);

        neighbours.setRemote("up", player());
        neighbours.setRemote("constructor", player());
        expect(Object.keys(neighbours.remote).sort()).toEqual(["east", "west"]);
        expect(neighbours.getRemote("constructor")).toBeNull();
        expect(neighbours.getRemote("toString")).toBeNull();
    });

    it("has its deals ended when it comes or goes", () => {
        const neighbours = makeNeighbours();
        neighbours.setDeal("north", "trade", true);
        neighbours.setDeal("north", "twinning", true);
        neighbours.setDeal("east", "trade", true);
        neighbours.get("north").months.trade = 5;

        neighbours.clearDeals("north");
        neighbours.clearDeals("nowhere");

        expect(neighbours.get("north").deals).toEqual({trade: false, buyPower: false, sellPower: false, twinning: false});
        expect(neighbours.get("north").months).toEqual({trade: 0, buyPower: 0, sellPower: 0, twinning: 0});
        expect(neighbours.get("east").deals.trade).toBe(true);
        expect((Neighbours as any).MATCH).toEqual({trade: "trade", buyPower: "sellPower", sellPower: "buyPower",
                                                   twinning: "twinning"});
    });
});
