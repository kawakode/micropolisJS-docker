import * as fs from "fs";
import * as path from "path";

import { CityFile } from "../src/cityFile.js";
import { GameMap } from "../src/gameMap.js";
import { LobbyData } from "../src/lobbyData.js";
import { MapGenerator } from "../src/mapGenerator.js";
import { Scenarios } from "../src/scenarios.js";
import { Simulation } from "../src/simulation.js";
import { Storage } from "../src/storage.js";

// What the multiplayer lobby reads from the server and sends to it (see LobbyData): the answers checked and copied,
// the map of a region, and the save of a new shared city.

const D = (n: number) => String.fromCharCode(65 + n).repeat(22);
const ID = D(0);
const ID2 = D(1);
const ID3 = D(2);

// The keys the server takes in the save of a new city (see server/game/saveValidation.ts): any other is refused
const SERVER_KEYS = new Set([
    "name", "_reachedTown", "_reachedCity", "_reachedCapital", "_reachedMetropolis", "_reachedMegalopolis", "dayNight",
    "disastersEnabled", "timeOfDay", "autoBulldoze", "_cityTime", "_speed", "_gameLevel", "achievements", "weatherSnow", "weatherWind", "snowMonths", "cityCentreX", "cityCentreY",
    "pollutionMaxX", "pollutionMaxY", "width", "height", "cityClass", "cityScore", "cityPop", "resValve", "comValve",
    "indValve", "autoBudget", "totalFunds", "policePercent", "roadPercent", "firePercent", "roadSpend", "policeSpend",
    "fireSpend", "roadMaintenanceBudget", "policeMaintenanceBudget", "fireMaintenanceBudget", "cityTax", "roadEffect",
    "policeEffect", "fireEffect", "dealsFund", "upkeepFund", "debt", "debtPayment", "loanFund", "ordinances", "ordinanceFund", "resPop", "comPop", "indPop", "crimeRamp", "pollutionRamp",
    "landValueAverage", "pollutionAverage", "crimeAverage", "totalPop", "version", "isSavedGame", "everClicked",
    "scenario", "map", "roadClass", "neighbours",
    ...["res", "com", "ind", "crime", "money", "pollution"].flatMap(name => [name + "Hist10", name + "Hist120"])
]);
// The keys it requires
const REQUIRED_KEYS = ["_cityTime", "_speed", "cityCentreX", "cityCentreY", "pollutionMaxX", "pollutionMaxY", "width",
    "height", "cityClass", "cityScore", "resValve", "comValve", "indValve", "autoBudget", "totalFunds", "policePercent",
    "roadPercent", "firePercent", "roadSpend", "policeSpend", "fireSpend", "roadMaintenanceBudget",
    "policeMaintenanceBudget", "fireMaintenanceBudget", "cityTax", "roadEffect", "policeEffect", "fireEffect", "resPop",
    "comPop", "indPop", "crimeRamp", "pollutionRamp", "landValueAverage", "pollutionAverage", "crimeAverage", "totalPop",
    "map"];

const cityFile = (file: string): any => {
    const buffer = fs.readFileSync(path.join(__dirname, "..", "cities", file));
    return (CityFile as any).read(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
                                  {name: "Kowloon"});
};

// A save as the server checks it: known keys, the required ones, and the values it checks most
const expectAcceptable = (save: any) => {
    Object.keys(save).forEach(key => expect(SERVER_KEYS.has(key) ? key : "unknown key " + key).toBe(key));
    REQUIRED_KEYS.forEach(key => expect(save[key] === undefined ? "missing " + key : key).toBe(key));
    expect(save.version).toBe(4);
    // No scenario, or one the server takes as it is
    expect(save.scenario === null ? null : (Scenarios as any).clean(save.scenario)).toEqual(save.scenario);
    expect(save.width).toBe(120);
    expect(save.height).toBe(100);
    expect(save.map).toHaveLength(12000);
    expect(save.map.filter((tile: any) => Object.keys(tile).length !== 1 || !Number.isInteger(tile.value) ||
                                          tile.value < 0 || tile.value > 0x1FFFF)).toEqual([]);
    expect(save.roadClass).toMatch(/^[0-3]{12000}$/);
    expect([1, 2, 3]).toContain(save._speed);
    expect([0, 1, 2]).toContain(save._gameLevel);
    ["policePercent", "roadPercent", "firePercent", "timeOfDay"].forEach(key => {
        expect(save[key] >= 0 && save[key] <= 1).toBe(true);
    });
    expect(Number.isInteger(save.totalFunds) && save.totalFunds >= 0).toBe(true);
    // Through JSON, as it is sent: nothing is lost
    expect(JSON.parse(JSON.stringify(save))).toEqual(save);
};


describe("The lobby's names", () => {

    it("are cleaned and counted as the server does", () => {
        expect(LobbyData.checkName("  Springfield ", 15)).toEqual({text: "Springfield", reason: null});
        expect(LobbyData.checkName("", 15).reason).toBe("required");
        expect(LobbyData.checkName(" ​‮\n ", 15).reason).toBe("required");
        expect(LobbyData.checkName("Spring‮field", 15)).toEqual({text: "Springfield", reason: null});
        // NFC: a letter and its accent are one character
        expect(LobbyData.checkName("Zé", 15)).toEqual({text: "Zé", reason: null});
        expect(LobbyData.checkName("a".repeat(15), 15).reason).toBeNull();
        expect(LobbyData.checkName("a".repeat(16), 15).reason).toBe("too_long");
        // Characters, not UTF-16 units
        expect(LobbyData.checkName("\u{1F3D9}".repeat(15), 15).reason).toBeNull();
        expect(LobbyData.checkName("r".repeat(30), LobbyData.REGION_NAME_MAX).reason).toBeNull();
        expect(LobbyData.checkName(42, 15).reason).toBe("required");
        // Something must show: Hangul fillers, the braille blank, the combining grapheme joiner, marks alone do not
        ["\u3164", "\uFFA0", "\u115F\u1160", "\u2800\u2800", "\u034F", "\u17B4", "\u180B", "\u0301\u0301"]
            .forEach(name => expect([name, LobbyData.checkName(name, 15).reason]).toEqual([name, "required"]));
        expect(LobbyData.checkName("Bob\u3164town", 15)).toEqual({text: "Bobtown", reason: null});
        expect(LobbyData.checkName("\u0301Ville", 15)).toEqual({text: "Ville", reason: null});
    });

    it("of players to invite are trimmed, and not too long", () => {
        expect(LobbyData.checkUsername(" bob ", 20)).toEqual({text: "bob", reason: null});
        expect(LobbyData.checkUsername("   ", 20).reason).toBe("required");
        expect(LobbyData.checkUsername("b".repeat(21), 20).reason).toBe("too_long");
        expect(LobbyData.checkUsername(undefined, 20).reason).toBe("required");
    });

    it("from the server are shown without control characters, and not too long", () => {
        expect(LobbyData.shownName("Bob‮\u0000")).toBe("Bob");
        expect(LobbyData.shownName("x".repeat(100))).toHaveLength(40);
        expect(LobbyData.shownName(null)).toBe("");
        expect(LobbyData.shownName({toString: () => "no"})).toBe("");
    });
});


describe("The lobby's answers from the server", () => {

    const goodCity = {id: ID, name: "Springfield", role: "player", ownerName: "alice", population: 1200, year: 1905,
                      online: 2, region: {id: ID2, name: "Valley", x: 1, y: 0}};

    it("give the cities as the lobby shows them", () => {
        expect(LobbyData.city(goodCity)).toEqual(goodCity);
        expect(LobbyData.city({...goodCity, region: null})!.region).toBeNull();
        // A copy: nothing else of the answer comes along
        const copy = LobbyData.city({...goodCity, extra: "<script>", __proto__: {polluted: true}} as any) as any;
        expect(Object.keys(copy).sort()).toEqual(Object.keys(goodCity).sort());
        expect(copy.polluted).toBeUndefined();
        expect(copy.region).not.toBe(goodCity.region);
    });

    it("drop the cities that are not, and the values of the wrong types", () => {
        [null, [], "city", {...goodCity, id: "short"}, {...goodCity, id: 22}, {...goodCity, name: ""},
         {...goodCity, name: "‮"}].forEach(entry => expect(LobbyData.city(entry)).toBeNull());

        const odd = LobbyData.city({...goodCity, role: "admin", population: -5, year: "1905", online: 1.5,
                                    ownerName: 7, region: {id: ID2, name: "Valley", x: 4, y: 0}}) as any;
        expect(odd.role).toBe("viewer");
        expect(odd.population).toBe(0);
        expect(odd.year).toBeNull();
        expect(odd.online).toBe(0);
        expect(odd.ownerName).toBe("");
        expect(odd.region).toBeNull();
        expect(LobbyData.city({...goodCity, population: Infinity})!.population).toBe(0);
        expect(LobbyData.city({...goodCity, region: {id: "x", name: "Valley", x: 0, y: 0}})!.region).toBeNull();
    });

    it("give the invitations, with their roles", () => {
        const city = {id: ID, kind: "city", target: {id: ID2, name: "Springfield"}, inviterId: ID3,
                      inviterName: "alice", role: "player"};
        expect(LobbyData.invitation(city)).toEqual(city);
        expect(LobbyData.invitation({...city, role: "owner"})!.role).toBe("viewer");
        expect(LobbyData.invitation({...city, kind: "region", role: "player"})!.role).toBeNull();
        expect(LobbyData.invitation({...city, inviterId: "nobody"})!.inviterId).toBeNull();
        [{...city, kind: "game"}, {...city, id: null}, {...city, target: null}, {...city, target: {id: "x"}}]
            .forEach(entry => expect(LobbyData.invitation(entry)).toBeNull());
    });

    it("give the regions, of 2 to 4 cities a side", () => {
        const region = {id: ID, name: "Valley", ownerName: "alice", width: 3, height: 2, public: false, mine: true,
                        cities: 4};
        expect(LobbyData.region(region)).toEqual(region);
        expect(LobbyData.region({...region, mine: "yes"})!.mine).toBe(false);
        expect(LobbyData.region({...region, public: true})!.public).toBe(true);
        expect(LobbyData.region({...region, public: "yes"})!.public).toBe(false);
        [{...region, width: 5}, {...region, height: 1}, {...region, width: "3"}, {...region, id: undefined}]
            .forEach(entry => expect(LobbyData.region(entry)).toBeNull());
    });

    it("give the public regions a player may join, with their members", () => {
        const region = {id: ID, name: "Plains", ownerName: "alice", width: 2, height: 2, public: true, mine: false,
                        cities: 1, members: 3};
        expect(LobbyData.publicRegion(region)).toEqual(region);
        expect(LobbyData.publicRegion({...region, members: -1})!.members).toBe(0);
        expect(LobbyData.publicRegion({...region, width: 9})).toBeNull();
    });

    it("give the whole lobby, whatever the answers hold", () => {
        const empty = {cities: [], invitations: [], regions: [], publicRegions: []};
        expect(LobbyData.lobby(null, undefined, null)).toEqual(empty);
        expect(LobbyData.lobby({cities: "no", invitations: {}}, {regions: [null]}, {regions: "no"})).toEqual(empty);
        const region = {id: ID3, name: "R", ownerName: "bob", width: 2, height: 2, mine: false, cities: 0};
        const lobby = LobbyData.lobby({cities: [goodCity, {id: "bad"}], invitations: []}, {regions: [region]},
                                      {regions: [{...region, id: ID2, public: true, members: 2}, {id: "bad"}]});
        expect(lobby.cities).toHaveLength(1);
        expect(lobby.regions).toHaveLength(1);
        expect(lobby.publicRegions).toEqual([{...region, id: ID2, public: true, members: 2}]);
    });

    it("group the invitations by the player who sent them", () => {
        const invitation = (id: string, inviterId: string | null, inviterName: string) =>
            ({id, kind: "city", target: {id: ID, name: "C"}, inviterId, inviterName, role: "player"});
        const list = [invitation("1", ID, "alice"), invitation("2", ID2, "bob"), invitation("3", ID, "alice"),
                      invitation("4", null, "?"), invitation("5", null, "?")];
        const groups = LobbyData.invitationGroups(list as any);
        expect(groups.map(group => [group.inviterName, group.invitations.map((i: any) => i.id)]))
            .toEqual([["alice", ["1", "3"]], ["bob", ["2"]], ["?", ["4"]], ["?", ["5"]]]);
        expect(LobbyData.invitationGroups([])).toEqual([]);
    });

    it("give a city's members, its owner first, and the invitations only to its owner", () => {
        const answer = {
            city: {...goodCity, role: "owner"},
            members: [{id: ID2, username: "zoe", role: "viewer", colour: "#ABCDEF", online: true},
                      {id: ID3, username: "bob", role: "player", colour: "red", online: "yes"},
                      {id: ID, username: "alice", role: "owner", colour: "#123456", online: false},
                      {id: "bad", username: "x", role: "player"}],
            invitations: [{id: D(5), username: "carol", userId: D(6), role: "viewer", createdAt: 1},
                          {id: D(7), username: "", role: "player"}]
        };
        const detail = LobbyData.cityDetail(answer) as any;
        expect(detail.members.map((m: any) => m.username)).toEqual(["alice", "bob", "zoe"]);
        expect(detail.members[2].colour).toBe("#abcdef");
        expect(detail.members[1].colour).toBe("#f8f8ff");
        expect(detail.members[1].online).toBe(false);
        expect(detail.invitations).toEqual([{id: D(5), username: "carol", userId: D(6), role: "viewer"}]);

        expect(LobbyData.cityDetail({...answer, city: goodCity})!.invitations).toBeNull();
        expect(LobbyData.cityDetail({...answer, city: null})).toBeNull();
        expect(LobbyData.cityDetail("no")).toBeNull();
    });

    it("give a region's map: one place for each slot, in reading order", () => {
        const answer = {
            region: {id: ID, name: "Valley", ownerName: "alice", width: 3, height: 2, public: false, mine: false,
                     cities: 2},
            slots: [
                {x: 2, y: 1, city: {id: ID2, name: "Mine", ownerName: "bob", population: 500, role: "owner"}},
                {x: 0, y: 0, city: {id: ID3, name: "Theirs", ownerName: "alice", population: 9000, role: null}},
                // Outside the region, and not a city: ignored
                {x: 3, y: 0, city: {id: D(4), name: "Out", ownerName: "x", population: 1, role: "owner"}},
                {x: 1, y: 0, city: {id: "bad"}}
            ],
            // The owner is the one the server says (a flag that is not true is not one)
            members: [{id: D(5), username: "bob", owner: "yes"}, {id: D(6), username: "alice", owner: true},
                      {id: "x", username: "y", owner: true}],
            invitations: [{id: D(7), username: "carol", userId: D(8), createdAt: 2}]
        };
        const detail = LobbyData.regionDetail(answer) as any;
        expect(detail.slots.map((s: any) => [s.x, s.y, s.city && s.city.name]))
            .toEqual([[0, 0, "Theirs"], [1, 0, null], [2, 0, null], [0, 1, null], [1, 1, null], [2, 1, "Mine"]]);
        expect(detail.members.map((m: any) => [m.username, m.owner])).toEqual([["alice", true], ["bob", false]]);
        // Only its owner sees the invitations
        expect(detail.invitations).toBeNull();
        const mine = LobbyData.regionDetail({...answer, region: {...answer.region, mine: true}}) as any;
        expect(mine.invitations).toEqual([{id: D(7), username: "carol", userId: D(8), role: null}]);

        expect(LobbyData.regionDetail({...answer, slots: null})!.slots).toHaveLength(6);
        expect(LobbyData.regionDetail({...answer, region: {...answer.region, width: 9}})).toBeNull();
    });

    it("say what a player can do with each place of a region", () => {
        const answer = {
            region: {id: ID, name: "Valley", ownerName: "alice", width: 2, height: 2, mine: false, cities: 3},
            slots: [
                {x: 0, y: 0, city: {id: ID2, name: "Mine", ownerName: "bob", population: 1, role: "owner"}},
                {x: 1, y: 0, city: {id: ID3, name: "Played", ownerName: "carol", population: 1, role: "player"}},
                {x: 0, y: 1, city: {id: D(4), name: "Theirs", ownerName: "dan", population: 1, role: null}},
                {x: 1, y: 1, city: null}
            ],
            members: []
        };
        const layout = LobbyData.regionLayout(LobbyData.regionDetail(answer) as any);
        expect(layout.map((c: any) => [c.row, c.column, c.play, c.build, c.clear])).toEqual([
            [1, 1, true, false, true],
            [1, 2, true, false, false],
            [2, 1, false, false, false],
            [2, 2, false, true, false]
        ]);

        // The region's owner may take any city out of it
        const owned = LobbyData.regionLayout(LobbyData.regionDetail({...answer, region: {...answer.region, mine: true}}) as any);
        expect(owned.map((c: any) => c.clear)).toEqual([true, true, true, false]);
    });

    it("name a copy of a city in ASCII", () => {
        expect(LobbyData.downloadName("Springfield")).toBe("Springfield.kawacity");
        expect(LobbyData.downloadName("Zoé ville")).toBe("Zo_ville.kawacity");
        expect(LobbyData.downloadName("東京")).toBe("_.kawacity");
        expect(LobbyData.downloadName("")).toBe("city.kawacity");
        expect(LobbyData.downloadName("x".repeat(60))).toBe("x".repeat(40) + ".kawacity");
    });
});


describe("A new shared city", () => {

    it("is saved from a generated map as the game saves a new city", () => {
        const map = MapGenerator(120, 100, {}) as any;
        const tiles = map._data.map((tile: any) => tile.getRawValue());

        [0, 1, 2].forEach(level => {
            const save = LobbyData.buildSave({map}, "Springfield", level) as any;
            expectAcceptable(save);
            expect(save.name).toBe("Springfield");
            expect(save._gameLevel).toBe(level);
            // A new city's funds depend on its level
            expect(save.totalFunds).toBe([20000, 10000, 5000][level]);
            expect(save._cityTime).toBe(0);
            expect(save._speed).toBe(Simulation.SPEED_MED);
            expect(save._reachedTown).toBe(false);
            expect(save.dayNight).toBe(true);
            expect(save.timeOfDay).toBe(0.2);
            expect(save.disastersEnabled).toBe(true);
            expect(save.neighbours).toHaveLength(4);
            expect(save.map.map((tile: any) => tile.value)).toEqual(tiles);
        });

        // The map is only read
        expect(map._data.map((tile: any) => tile.getRawValue())).toEqual(tiles);
    });

    it("is saved from a sample city as it is, at the level chosen", () => {
        const kowloon = cityFile("kowloon.cty");
        const before = JSON.stringify(kowloon);
        const save = LobbyData.buildSave({save: kowloon}, "Kowloon", Simulation.LEVEL_HARD) as any;

        expectAcceptable(save);
        expect(JSON.stringify(kowloon)).toBe(before);
        expect(save._gameLevel).toBe(Simulation.LEVEL_HARD);
        expect(save.totalFunds).toBe(kowloon.totalFunds);
        expect(save._cityTime).toBe(kowloon._cityTime);
        expect(save.resPop).toBe(kowloon.resPop);
        expect(save.map.map((tile: any) => tile.value)).toEqual(kowloon.map.map((tile: any) => tile.value));
        expect(save._reachedTown).toBe(kowloon._reachedTown);
        expect(save.isSavedGame).toBeUndefined();
    });

    it("is saved from a city file of every kind the game opens", () => {
        fs.readdirSync(path.join(__dirname, "..", "cities")).filter(file => file.endsWith(".cty")).forEach(file => {
            expectAcceptable(LobbyData.buildSave({save: cityFile(file)}, "City", 0));
        });
    });

    it("keeps the scenario of a scenario of the game, on its way or ended", async () => {
        const fetch = global.fetch;
        global.fetch = (async (url: string) => {
            const buffer = fs.readFileSync(path.join(__dirname, "..", url.replace(/\?.*$/, "")));
            return {ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset,
                                                                          buffer.byteOffset + buffer.byteLength)};
        }) as any;

        try {
            for (const scenario of (Scenarios as any).list) {
                const game = await (Scenarios as any).load(scenario.id);
                const save = LobbyData.buildSave({save: game}, scenario.name, 0) as any;
                expectAcceptable(save);
                expect(save.scenario).toEqual({id: scenario.id, goal: scenario.goal, disaster: scenario.disaster,
                                               disasterWait: scenario.disasterWait, scoreWait: scenario.scoreWait});
            }

            const game = await (Scenarios as any).load("bern");
            game.scenario = {...game.scenario, scoreWait: 0, ended: true, won: true};
            expect((LobbyData.buildSave({save: game}, "Bern", 0) as any).scenario).toMatchObject({ended: true, won: true});
        } finally {
            global.fetch = fetch;
        }
    });

    it("is saved from a game saved by KawaCity, paused or old", () => {
        const first = LobbyData.buildSave({map: MapGenerator(120, 100, {})}, "Old", 1) as any;

        // Saved while paused, with a scenario the server would refuse (dropped), at night
        const paused = {...JSON.parse(JSON.stringify(first)), _speed: 0, timeOfDay: 1.75, dayNight: false,
                        scenario: {id: "dullsville"}, _reachedCity: true, autoBulldoze: false, isSavedGame: true};
        const save = LobbyData.buildSave({save: paused}, "Again", 1) as any;
        expectAcceptable(save);
        expect(save._speed).toBe(Simulation.SPEED_MED);
        expect(save.scenario).toBeNull();
        expect(save.timeOfDay).toBe(0.75);
        expect(save.dayNight).toBe(false);
        expect(save._reachedCity).toBe(true);
        expect(save.autoBulldoze).toBe(false);

        // Saved again, a save stays the same
        expect(LobbyData.buildSave({save: save}, "Again", 1)).toEqual(save);

        // A file of version 3 (the original tiles), as the game reads it
        const old = JSON.parse(JSON.stringify(first));
        old.version = 3;
        const read = (Storage as any).parseSavedGame(JSON.stringify(old));
        const converted = LobbyData.buildSave({save: read}, "Old", 1) as any;
        expectAcceptable(converted);
        expect(converted.version).toBe(4);
    });

    it("needs a map or a saved game", () => {
        expect(() => LobbyData.buildSave({} as any, "X", 0)).toThrow();
        expect(() => LobbyData.buildSave({map: {}} as any, "X", 0)).toThrow();
        expect(() => LobbyData.buildSave(null as any, "X", 0)).toThrow();
        expect((LobbyData.buildSave({map: new GameMap(120, 100)}, "X", 7) as any)._gameLevel).toBe(0);
    });

    it("is asked for with its name, level and save, and its place in a region", () => {
        const save = {version: 4};
        expect(LobbyData.creationRequest("Springfield", 2, save, null)).toEqual({name: "Springfield", level: 2, save});
        expect(LobbyData.creationRequest("Springfield", 1, save, {region: {id: ID, name: "Valley"}, x: 2, y: 3}))
            .toEqual({name: "Springfield", level: 1, save, region: {id: ID, x: 2, y: 3}});
        expect(LobbyData.creationRequest("S", 5, save, null).level).toBe(0);
    });
});


describe("Changes sent once the player stops making them", () => {

    afterEach(() => jest.useRealTimers());

    it("wait, start again when changed meanwhile, and are all sent at once when what shows them closes", () => {
        jest.useFakeTimers();
        const sent: [string, boolean][] = [];
        const waiting = new LobbyData.Waiting(600);
        waiting.later("bob", (closing: boolean) => sent.push(["bob viewer", closing]));
        jest.advanceTimersByTime(500);
        waiting.later("bob", (closing: boolean) => sent.push(["bob player", closing]));
        jest.advanceTimersByTime(500);
        expect(sent).toEqual([]);
        jest.advanceTimersByTime(100);
        expect(sent).toEqual([["bob player", false]]);

        // The card closes within the wait: the change is sent then, once
        waiting.later("carol", (closing: boolean) => sent.push(["carol viewer", closing]));
        jest.advanceTimersByTime(100);
        waiting.now();
        jest.advanceTimersByTime(1000);
        expect(sent).toEqual([["bob player", false], ["carol viewer", true]]);
        waiting.now();
        expect(sent).toHaveLength(2);
    });
});
