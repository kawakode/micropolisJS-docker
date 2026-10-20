import * as fs from "fs";
import * as path from "path";

import { BaseTool } from "../src/baseTool.js";
import { CityFile } from "../src/cityFile.js";
import { GameMap } from "../src/gameMap.js";
import * as Messages from "../src/messages";
import { RemoteCity, RemoteSprites } from "../src/remoteCity.js";
import { Simulation } from "../src/simulation.js";
import { SpriteManager } from "../src/spriteManager.js";
import { SPRITE_AIRPLANE, SPRITE_EXPLOSION, SPRITE_HELICOPTER, SPRITE_MONSTER, SPRITE_SHIP, SPRITE_TORNADO,
         SPRITE_TRAIN } from "../src/spriteConstants";
import { ALLBITS, BIT_MASK, BULLBIT, CONDBIT, POWERBIT, ZONEBIT } from "../src/tileFlags";
import { DIRT, RUBBLE } from "../src/tileValues";

const R = RemoteCity as any;
const Sprites = RemoteSprites as any;

// --- The sprites ---

// A sprite sample, as the server sends them: [id, type, frame, x, y]
const sample = (id: number, type: number, frame: number, x: number, y: number) => [id, type, frame, x, y];

const listen = (sprite: any) => {
    const heard: string[] = [];
    sprite.addEventListener(Messages.SPRITE_MOVED, (e: any) => heard.push("moved " + e.x + "," + e.y));
    sprite.addEventListener(Messages.SPRITE_DYING, () => heard.push("dying"));
    return heard;
};


describe("The sprites of a shared city", () => {

    it("have the size and offsets of the game's own sprites", () => {
        const manager = new (SpriteManager as any)(new (GameMap as any)(120, 100));
        const types = [SPRITE_TRAIN, SPRITE_HELICOPTER, SPRITE_AIRPLANE, SPRITE_SHIP, SPRITE_MONSTER, SPRITE_TORNADO,
                       SPRITE_EXPLOSION];
        types.forEach(type => {
            const real = manager.makeSprite(type, 160, 160);
            expect(Sprites.SIZES[type]).toEqual({width: real.width, xOffset: real.xOffset, yOffset: real.yOffset});

            const sprites = new Sprites();
            sprites.receive([sample(1, type, 1, 160, 160)], 0);
            const proxy = sprites.get(1);
            expect([proxy.width, proxy.xOffset, proxy.yOffset]).toEqual([real.width, real.xOffset, real.yOffset]);
            expect([proxy.worldX, proxy.worldY]).toEqual([real.worldX, real.worldY]);
        });
    });

    it("appear where they are, then move between their last two positions, a delay behind", () => {
        const sprites = new Sprites();
        sprites.receive([sample(4, SPRITE_TRAIN, 2, 100, 50)], 1000);
        const train = sprites.get(4);
        expect([train.x, train.y, train.frame]).toEqual([100, 50, 2]);

        sprites.receive([sample(4, SPRITE_TRAIN, 3, 124, 50)], 1100);
        expect(train.frame).toBe(3);
        expect(Sprites.DELAY).toBe(100);
        expect(train.x).toBe(100);
        sprites.animate(1150);
        expect(train.x).toBe(112);
        sprites.animate(1200);
        expect(train.x).toBe(124);
        sprites.animate(5000);
        expect([train.x, train.y]).toEqual([124, 50]);

        // The next position: from where it was then
        sprites.receive([sample(4, SPRITE_TRAIN, 3, 124, 74)], 1200);
        sprites.animate(1250);
        expect([train.x, train.y]).toEqual([124, 62]);
    });

    it("jump when they moved further than they could", () => {
        const sprites = new Sprites();
        sprites.receive([sample(1, SPRITE_AIRPLANE, 1, 100, 100)], 0);
        const plane = sprites.get(1);

        sprites.receive([sample(1, SPRITE_AIRPLANE, 1, 164, 100)], 100);
        sprites.animate(150);
        expect(plane.x).toBe(132);

        sprites.receive([sample(1, SPRITE_AIRPLANE, 1, 300, 100)], 200);
        expect(plane.x).toBe(300);
        sprites.animate(250);
        expect(plane.x).toBe(300);
        expect(Sprites.SNAP_DISTANCE).toBe(64);
    });

    it("tell their listeners when they move and when they go", () => {
        const sprites = new Sprites();
        sprites.receive([sample(7, SPRITE_MONSTER, 1, 160, 160), sample(8, SPRITE_TORNADO, 1, 320, 320)], 0);
        const monster = sprites.get(7);
        const tornado = sprites.get(8);
        const heardMonster = listen(monster);
        const heardTornado = listen(tornado);

        sprites.receive([sample(7, SPRITE_MONSTER, 2, 176, 160), sample(8, SPRITE_TORNADO, 2, 320, 320)], 100);
        expect(heardMonster).toEqual(["moved 11,10"]);
        expect(heardTornado).toEqual([]);

        sprites.receive([sample(8, SPRITE_TORNADO, 2, 336, 320)], 200);
        expect(heardMonster).toEqual(["moved 11,10", "dying"]);
        expect(monster.frame).toBe(0);
        expect(sprites.get(7)).toBeNull();
        expect(heardTornado).toEqual(["moved 21,20"]);

        // A listener may stop listening as the sprite dies (as MonsterTV does)
        const stop = () => tornado.removeEventListener(Messages.SPRITE_DYING, stop);
        tornado.addEventListener(Messages.SPRITE_DYING, stop);
        sprites.receive([], 300);
        expect(heardTornado).toEqual(["moved 21,20", "dying"]);
        expect(sprites.getSpriteList()).toEqual([]);
    });

    it("are new when an id comes back as another kind of sprite", () => {
        const sprites = new Sprites();
        sprites.receive([sample(3, SPRITE_SHIP, 1, 100, 100)], 0);
        const ship = sprites.get(3);
        const heard = listen(ship);
        sprites.receive([sample(3, SPRITE_EXPLOSION, 1, 500, 500)], 100);
        expect(heard).toEqual(["dying"]);
        expect(sprites.get(3)).not.toBe(ship);
        expect(sprites.get(3).type).toBe(SPRITE_EXPLOSION);
    });

    it("ignore what is not a sprite", () => {
        const sprites = new Sprites();
        sprites.receive([sample(1, 1, 1, 10, 10), sample(1, 1, 1, 50, 50), [2, 1, 0, 10, 10], [3, 1, 1, 1.5, 10],
                         [0, 1, 1, 10, 10], [4, 1, 1, 10], "x", null, {id: 5}, [6, "1", 1, 10, 10]], 0);
        expect(sprites.getSpriteList().map((s: any) => [s.id, s.x])).toEqual([[1, 10]]);
        sprites.receive(null, 100);
        expect(sprites.getSpriteList()).toEqual([]);
    });

    it("are found in view as the game's own sprites are", () => {
        const map = new (GameMap as any)(120, 100);
        const manager = new (SpriteManager as any)(map);
        const sprites = new Sprites();
        const samples: number[][] = [];
        [[SPRITE_TRAIN, 40, 40], [SPRITE_AIRPLANE, 400, 300], [SPRITE_TORNADO, 330, 200], [SPRITE_SHIP, 900, 900],
         [SPRITE_MONSTER, 16, 1500], [SPRITE_EXPLOSION, 1000, 40]].forEach(([type, x, y], i) => {
            const real = manager.makeSprite(type, x, y);
            real.frame = 1;
            samples.push(sample(real.id, type, 1, x, y));
            expect(real.id).toBe(i + 1);
        });
        sprites.receive(samples, 0);

        const views = [[0, 0, 640, 480], [20, 15, 320, 240], [-3, -3, 2000, 2000], [50, 50, 100, 100], [0, 90, 400, 400]];
        views.forEach(([x, y, w, h]) => {
            const ids = (list: any[]) => list.map(s => s.id);
            expect(ids(sprites.getSpritesInView(x, y, w, h))).toEqual(ids(manager.getSpritesInView(x, y, w, h)));
        });
        expect(sprites.getSprite(SPRITE_TORNADO).id).toBe(3);
        expect(sprites.getSprite(SPRITE_HELICOPTER)).toBeNull();
    });

    it("can be followed from the message that names them, before their first position", () => {
        const sprites = new Sprites();
        const monster = sprites.track(9, 30, 20, SPRITE_MONSTER, 0);
        expect(sprites.track(9, 1, 1, SPRITE_MONSTER, 0)).toBe(monster);
        const heard = listen(monster);

        // Not drawn until it has a position
        expect(sprites.getSpriteList()).toEqual([]);
        expect(sprites.getSprite(SPRITE_MONSTER)).toBeNull();

        sprites.receive([sample(9, SPRITE_MONSTER, 1, 480, 320)], 50);
        expect(sprites.get(9)).toBe(monster);
        expect([monster.x, monster.y]).toEqual([480, 320]);
        expect(sprites.getSprite(SPRITE_MONSTER)).toBe(monster);
        sprites.receive([sample(9, SPRITE_MONSTER, 2, 496, 320)], 150);
        expect(heard).toEqual(["moved 31,20"]);

        // One that never comes goes, at the next sprites, or after a while
        const ghost = sprites.track(10, 5, 5, SPRITE_TORNADO, 200);
        const heardGhost = listen(ghost);
        sprites.receive([sample(9, SPRITE_MONSTER, 2, 496, 320)], 250);
        expect(heardGhost).toEqual(["dying"]);

        const late = sprites.track(11, 5, 5, SPRITE_TORNADO, 300);
        const heardLate = listen(late);
        sprites.animate(300 + Sprites.PENDING_LIFETIME);
        expect(heardLate).toEqual([]);
        sprites.animate(301 + Sprites.PENDING_LIFETIME);
        expect(heardLate).toEqual(["dying"]);
        expect(sprites.get(11)).toBeNull();
    });

    it("are all replaced by a new snapshot", () => {
        const sprites = new Sprites();
        sprites.receive([sample(1, SPRITE_TRAIN, 1, 10, 10)], 0);
        const train = sprites.get(1);
        const heard = listen(train);
        sprites.reset([sample(1, SPRITE_TRAIN, 1, 12, 10)], 100);
        expect(heard).toEqual(["dying"]);
        expect(sprites.get(1)).not.toBe(train);
        expect(sprites.get(1).x).toBe(12);
    });
});


// --- The city ---

const load = (file: string): any => {
    const buffer = fs.readFileSync(path.join(__dirname, "..", "cities", file));
    return (CityFile as any).read(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), {});
};

// A save of a running city, as the server has it (made here with the game's simulation)
let liveSave: any = null;
const getSave = (): any => {
    if (liveSave === null) {
        const simulation = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED,
                                                   load("kowloon.cty"));
        for (let i = 0; i < 32; i++)
            simulation.step();
        liveSave = {};
        simulation.save(liveSave);
        liveSave = JSON.parse(JSON.stringify(liveSave));
    }
    return JSON.parse(JSON.stringify(liveSave));
};

const welcomeOf = (save: any): any => ({
    save: save,
    state: {funds: save.totalFunds, population: 1000, cityClass: "TOWN", score: 640, date: {month: 0, year: 1950},
            valves: {res: 100, com: -50, ind: 20}, speed: 3, paused: false, autoBudget: true, autoBulldoze: true,
            disasters: true, level: 1, cityTime: save._cityTime},
    stats: {evaluation: {cityYes: 75}, historyTime: 7, cityStatus: {funds: 1, problems: []},
            neighbours: [{side: "north", name: "Lyon"}]},
    maps: {},
    sprites: [sample(1, SPRITE_TRAIN, 1, 100, 100)]
});

const raw = (city: any, index: number) => city.map._data[index].getRawValue();

const hear = (simulation: any) => {
    const heard: string[] = [];
    [Messages.FUNDS_CHANGED, Messages.POPULATION_UPDATED, Messages.CLASSIFICATION_UPDATED, Messages.SCORE_UPDATED,
     Messages.VALVES_UPDATED, Messages.DATE_UPDATED, Messages.FRONT_END_MESSAGE].forEach(event => {
        simulation.addEventListener(event, (value: any) => heard.push(event + " " + JSON.stringify(value)));
    });
    return heard;
};


describe("The copy of a shared city", () => {

    let autoBulldoze: boolean;

    beforeEach(() => {
        autoBulldoze = (BaseTool as any).getAutoBulldoze();
    });

    afterEach(() => {
        (BaseTool as any).setAutoBulldoze(autoBulldoze);
        jest.restoreAllMocks();
    });

    it("is made from the welcome, inert, with the save's tiles", () => {
        const save = getSave();
        const welcome = welcomeOf(save);
        const city = R.fromWelcome(welcome, 0);

        expect(city.simulation.isInert()).toBe(true);
        expect(city.map._data.map((tile: any) => tile.getRawValue())).toEqual(save.map.map((tile: any) => tile.value));
        expect(city.simulation.spriteManager.getSpriteList().map((s: any) => s.id)).toEqual([1]);
        expect(city.simulation.getHistoryTime()).toBe(7);
        expect(city.simulation.getCityStatus()).toEqual({funds: 1, problems: []});
        expect(city.simulation.neighbours.describe()).toEqual([{side: "north", name: "Lyon"}]);
        expect(city.infoBarValues()).toEqual({classification: "TOWN", population: 1000, score: 640,
                                              funds: save.totalFunds, date: city.simulation.getDate()});
        expect([city.speed, city.paused, city.simulation.getLevel()]).toEqual([3, false, 1]);

        // Its own copy of the save
        city.simulation.getCensus().resHist10[0] = -1;
        expect(welcome.save.resHist10[0]).not.toBe(-1);

        // Never by itself
        const before = city.map._data.map((tile: any) => tile.getRawValue());
        city.simulation.simTick();
        city.simulation.step();
        expect(city.map._data.map((tile: any) => tile.getRawValue())).toEqual(before);

        expect(() => R.fromWelcome({save: {map: []}}, 0)).toThrow("Not the welcome of a shared city");
        expect(() => R.fromWelcome(null, 0)).toThrow("Not the welcome of a shared city");
    });

    it("takes each tile's number and flags, flags gone included", () => {
        const city = R.fromWelcome(welcomeOf(getSave()), 0);
        const powered = city.map._data.findIndex((tile: any) => (tile.getRawValue() & POWERBIT) !== 0);
        expect(powered).toBeGreaterThanOrEqual(0);

        const rubble = RUBBLE | BULLBIT;
        expect(city.applyTiles({c: [powered, DIRT, 5, rubble], r: [5, 3, 6, 2]})).toBe(4);
        expect(raw(city, powered)).toBe(DIRT);
        expect(raw(city, 5)).toBe(rubble);
        expect([city.map.getRoadClass(5, 0), city.map.getRoadClass(6, 0)]).toEqual([3, 2]);

        const zone = 2047 | ZONEBIT | CONDBIT | POWERBIT;
        expect(city.applyTiles({c: [7, zone]})).toBe(1);
        expect(raw(city, 7)).toBe(zone);
        expect(raw(city, 7) & ALLBITS).toBe(ZONEBIT | CONDBIT | POWERBIT);
        expect(raw(city, 7) & BIT_MASK).toBe(2047);

        // Nothing that is not a tile of the map
        const before = city.map._data.map((tile: any) => tile.getRawValue());
        expect(city.applyTiles({c: [-1, 1, 12000, 1, 1.5, 1, 8, -1, 9, 0x20000, 10, 1.5, 11, "3", 16, 2 ** 32, 12],
                                r: [13, 8, 14, -1, 12000, 1, 15, 1.5]})).toBe(0);
        expect(city.applyTiles(null)).toBe(0);
        expect(city.applyTiles({c: "1,2"})).toBe(0);
        expect(city.map._data.map((tile: any) => tile.getRawValue())).toEqual(before);
    });

    it("follows the state, with the events the game listens to", () => {
        const city = R.fromWelcome(welcomeOf(getSave()), 0);
        const simulation = city.simulation;
        const heard = hear(simulation);
        const setFunds = jest.spyOn(simulation.budget, "setFunds");

        const applied = city.applyState({funds: 0, population: 4321, cityClass: "CITY", score: 700,
                                         valves: {res: 1, com: 2, ind: 3}, cityTime: 48 * 60 + 9,
                                         date: {month: 3, year: 1960}, autoBudget: false, autoBulldoze: false,
                                         disasters: false, level: 2, speed: 2, paused: true});
        expect(applied).toEqual(["cityTime", "funds", "population", "cityClass", "score", "valves", "speed", "paused",
                                 "autoBudget", "autoBulldoze", "disasters", "level"]);
        expect(heard).toEqual([
            Messages.DATE_UPDATED + " " + JSON.stringify({month: 2, year: 1960}),
            Messages.FUNDS_CHANGED + " 0",
            Messages.POPULATION_UPDATED + " 4321",
            Messages.CLASSIFICATION_UPDATED + " \"CITY\"",
            Messages.SCORE_UPDATED + " 700",
            Messages.VALVES_UPDATED + " " + JSON.stringify({residential: 1, commercial: 2, industrial: 3})
        ]);

        // Not with setFunds: no warning of its own (the server sends it)
        expect(setFunds).not.toHaveBeenCalled();
        expect(simulation.budget.totalFunds).toBe(0);
        expect([simulation.getPopulation(), simulation._cityClassLive, simulation.evaluation.cityScore])
            .toEqual([4321, "CITY", 700]);
        expect([simulation._valves.resValve, simulation._valves.comValve, simulation._valves.indValve])
            .toEqual([1, 2, 3]);
        expect(simulation.getCityTime()).toBe(48 * 60 + 9);
        expect([simulation.budget.autoBudget, (BaseTool as any).getAutoBulldoze(), city.autoBulldoze,
                simulation.disasterManager.disastersEnabled, simulation.getLevel(), simulation.evaluation.gameLevel])
            .toEqual([false, false, false, false, 2, "2"]);
        expect([city.speed, city.paused, simulation.isPaused()]).toEqual([2, true, true]);
        expect(city.applyState({paused: false})).toEqual(["paused"]);
        expect([simulation._speed, simulation.isPaused()]).toEqual([2, false]);

        // Only what is valid
        heard.length = 0;
        expect(city.applyState({funds: "1", population: NaN, cityClass: 3, score: null, valves: {res: 1},
                                cityTime: -1, speed: 0, paused: "no", level: 3, autoBudget: 1, disasters: undefined,
                                autoBulldoze: null, other: 5})).toEqual([]);
        expect(city.applyState(null)).toEqual([]);
        expect(heard).toEqual([]);
    });

    it("takes the stats, and gives them back where the game reads them", () => {
        const city = R.fromWelcome(welcomeOf(getSave()), 0);
        const simulation = city.simulation;
        const history = Array.from({length: 120}, (_, i) => i);
        const status = {funds: 5, problems: [{problem: 1, votes: 30}], census: {resPop: 3}};
        city.applyStats({
            evaluation: {cityYes: 61, cityPop: 9000, cityPopDelta: 50, cityAssessedValue: 1e6, cityClass: "CITY",
                         cityScore: 612, cityScoreDelta: -3, problemVotes: [{index: 2, voteCount: 30, other: 1}],
                         problemOrder: [2, null, null, null]},
            budget: {taxFund: 1234, cashFlow: -56, cityTax: 9, roadPercent: 0.5, totalFunds: 99},
            census: {resPop: 77, totalPop: 88, resHist10: history, comHist10: [1, 2]},
            historyTime: 123,
            cityStatus: status,
            neighbours: [{side: "west", name: "Nice", player: true}]
        });

        expect(simulation.evaluation).toMatchObject({cityYes: 61, cityPop: 9000, cityPopDelta: 50, cityAssessedValue: 1e6,
                                                     cityClass: "CITY", cityScore: 612, cityScoreDelta: -3,
                                                     problemVotes: [{index: 2, voteCount: 30}],
                                                     problemOrder: [2, null, null, null]});
        expect(simulation.evaluation.getProblemNumber(0)).toBe(2);
        expect(simulation.evaluation.getProblemVotes(0)).toBe(30);
        expect(simulation.budget).toMatchObject({taxFund: 1234, cashFlow: -56, cityTax: 9, roadPercent: 0.5});
        expect(simulation.budget.totalFunds).not.toBe(99);
        expect(simulation.getCensus()).toMatchObject({resPop: 77, totalPop: 88, resHist10: history});
        expect(simulation.getCensus().resHist10).not.toBe(history);
        expect(simulation.getCensus().comHist10).toHaveLength(120);
        expect(simulation.getHistoryTime()).toBe(123);
        expect(simulation.getCityStatus()).toEqual(status);
        expect(simulation.getCityStatus()).not.toBe(status);
        expect(simulation.neighbours.describe()).toEqual([{side: "west", name: "Nice", player: true}]);

        // What is not valid is left as it was
        city.applyStats({evaluation: {cityYes: "1", problemVotes: [{index: "a"}], problemOrder: ["x"]},
                         budget: {taxFund: NaN}, census: {resHist10: history.slice(1)}, historyTime: "7",
                         cityStatus: [], neighbours: {}});
        expect(simulation.evaluation.cityYes).toBe(61);
        expect(simulation.evaluation.problemOrder).toEqual([2, null, null, null]);
        expect(simulation.budget.taxFund).toBe(1234);
        expect(simulation.getCensus().resHist10).toEqual(history);
        expect(simulation.getHistoryTime()).toBe(123);
        expect(simulation.getCityStatus()).toEqual(status);
    });

    it("takes the overlays of the minimap", () => {
        const city = R.fromWelcome(welcomeOf(getSave()), 0);
        const blockMaps = city.simulation.blockMaps;
        const crime = Array.from({length: 60 * 50}, (_, i) => i % 250);
        const growth = Array.from({length: 15 * 13}, (_, i) => i - 100);
        city.applyMaps({crimeRateMap: crime, rateOfGrowthMap: growth, landValueMap: [1, 2, 3], tempMap1: crime});

        expect(blockMaps.crimeRateMap.get(7, 2)).toBe(crime[2 * 60 + 7]);
        expect(blockMaps.rateOfGrowthMap.get(14, 12)).toBe(growth[12 * 15 + 14]);
        expect(blockMaps.landValueMap.get(0, 0)).not.toBe(1);
        expect(blockMaps.tempMap1.get(1, 0)).toBe(0);
        expect(R.MAP_NAMES).toHaveLength(10);
    });

    it("gives the sprite a message names", () => {
        const city = R.fromWelcome(welcomeOf(getSave()), 0);
        const message = city.resolveMessage({subject: Messages.MONSTER_SIGHTED,
                                             data: {trackable: true, x: 10, y: 12, spriteId: 5, sprite: "x"}}, 0);
        expect(message.data.sprite).toBe(city.sprites.get(5));
        expect(message.data.sprite.type).toBe(SPRITE_MONSTER);
        expect(message.data).toMatchObject({trackable: true, x: 10, y: 12, spriteId: 5});

        expect(city.resolveMessage({subject: Messages.TRAIN_CRASHED, data: {x: 1, y: 2}}, 0))
            .toEqual({subject: Messages.TRAIN_CRASHED, data: {x: 1, y: 2}});
        expect(city.resolveMessage({subject: Messages.NO_MONEY}, 0)).toEqual({subject: Messages.NO_MONEY});
        expect(city.resolveMessage({subject: 4}, 0)).toBeNull();
        expect(city.resolveMessage(null, 0)).toBeNull();
    });

    it("takes a new welcome into the same objects", () => {
        const save = getSave();
        const city = R.fromWelcome(welcomeOf(save), 0);
        const map = city.map;
        const simulation = city.simulation;
        const train = city.sprites.get(1);

        const later = JSON.parse(JSON.stringify(save));
        later.map[0].value = RUBBLE | BULLBIT;
        later.roadClass = "3".repeat(12000);
        later.pollutionMaxX = 17;
        city.applyWelcome({...welcomeOf(later), state: {funds: 42}}, 500);

        expect(city.map).toBe(map);
        expect(city.simulation).toBe(simulation);
        expect(raw(city, 0)).toBe(RUBBLE | BULLBIT);
        expect(map.getRoadClass(50, 50)).toBe(3);
        expect(map.pollutionMaxX).toBe(17);
        expect(simulation.budget.totalFunds).toBe(42);
        expect(city.sprites.get(1)).not.toBe(train);
        expect(train.frame).toBe(0);
    });

    it("tells which tiles the power reaches, from the powered tiles and those that conduct", () => {
        const city = R.fromWelcome(welcomeOf(getSave()), 0);
        const set = (x: number, y: number, value: number, flags: number) => city.map.getTile(x, y).set(value, flags);
        for (let y = 0; y < 100; y++)
            for (let x = 0; x < 120; x++)
                set(x, y, DIRT, 0);

        // A powered zone's centre, a line of wire from it, round a corner; a line apart; a gap that stops the power
        set(10, 10, 765, CONDBIT | POWERBIT | ZONEBIT);
        for (let x = 11; x <= 15; x++)
            set(x, 10, 210, CONDBIT);
        set(15, 11, 210, CONDBIT);
        set(15, 12, 210, CONDBIT);
        set(17, 12, 210, CONDBIT);
        for (let x = 30; x <= 35; x++)
            set(x, 40, 210, CONDBIT);
        // Corners do not join, nor the map's edges
        set(16, 13, 210, CONDBIT);
        set(119, 50, 210, CONDBIT | POWERBIT);
        set(0, 51, 210, CONDBIT);

        const powered = city.poweredTiles();
        const on: string[] = [];
        powered.forEach((value: number, i: number) => {
            if (value)
                on.push((i % 120) + "," + Math.floor(i / 120));
        });
        expect(on.sort()).toEqual(["10,10", "11,10", "12,10", "13,10", "14,10", "15,10", "15,11", "15,12",
                                   "119,50"].sort());
        expect(powered.length).toBe(12000);
    });

    it("tells mostly what the power grid tells, in a real city", () => {
        const simulation = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED,
                                                   load("kowloon.cty"));
        for (let i = 0; i < 32; i++)
            simulation.step();
        const save: any = {};
        simulation.save(save);
        const city = R.fromWelcome(welcomeOf(JSON.parse(JSON.stringify(save))), 0);
        const powered = city.poweredTiles();
        const grid = simulation._powerManager.powerGridMap;

        let conductive = 0;
        let agree = 0;
        for (let y = 0; y < 100; y++) {
            for (let x = 0; x < 120; x++) {
                if (!(city.map.getTile(x, y).getRawValue() & CONDBIT))
                    continue;
                conductive++;
                if ((grid.worldGet(x, y) > 0) === (powered[y * 120 + x] === 1))
                    agree++;
            }
        }
        expect(conductive).toBeGreaterThan(1000);
        expect(agree / conductive).toBeGreaterThan(0.95);
    });

    it("needs neither jQuery nor a page", () => {
        jest.isolateModules(() => {
            jest.doMock("jquery", () => { throw new Error("jQuery loaded"); });
            // The game's windows need it
            expect(() => require("../src/neighboursWindow.js")).toThrow("jQuery loaded");
        });
        jest.isolateModules(() => {
            jest.doMock("jquery", () => { throw new Error("jQuery loaded"); });
            expect(() => require("../src/remoteCity.js")).not.toThrow();
        });
        jest.dontMock("jquery");
    });
});
