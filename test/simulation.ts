import * as fs from "fs";
import * as path from "path";

import { CityFile } from "../src/cityFile.js";
import { GameMap } from "../src/gameMap.js";
import * as Messages from "../src/messages";
import { Simulation } from "../src/simulation.js";
import { SpriteManager } from "../src/spriteManager.js";
import { SPRITE_EXPLOSION, SPRITE_MONSTER, SPRITE_TRAIN } from "../src/spriteConstants";
import { DIRT } from "../src/tileValues";

const original = Math.random;

// A predictable source of random numbers
const mulberry = (seed: number) => () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const load = (file: string): any => {
    const buffer = fs.readFileSync(path.join(__dirname, "..", "cities", file));
    return (CityFile as any).read(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), {});
};

const saveOf = (simulation: any): any => {
    const saveData: any = {};
    simulation.save(saveData);
    return JSON.parse(JSON.stringify(saveData));
};

const rawTiles = (map: any): number[] => {
    const values = [];
    for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++)
            values.push(map.getTile(x, y).getRawValue());
    }
    return values;
};

// The save of a city that has been running for a while, as a server would send it
let liveSave: any = null;
const getLiveSave = (): any => {
    if (liveSave === null) {
        Math.random = mulberry(7);
        const simulation = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED, load("kowloon.cty"));
        for (let i = 0; i < 16 * 8; i++) {
            simulation.step();
            simulation.spriteManager.moveObjects(simulation._constructSimData());
        }
        Math.random = original;
        liveSave = saveOf(simulation);
    }
    return JSON.parse(JSON.stringify(liveSave));
};

// A simulation made from a save, with its own random numbers, run for some steps: its save
const runFrom = (save: any, options: any, steps: number, seed = 3): any => {
    Math.random = mulberry(seed);
    const map = new (GameMap as any)(120, 100);
    const simulation = options === undefined ?
        new (Simulation as any)(map, 0, Simulation.SPEED_MED, save) :
        new (Simulation as any)(map, 0, Simulation.SPEED_MED, save, options);
    for (let i = 0; i < steps; i++)
        simulation.step();
    Math.random = original;
    return saveOf(simulation);
};


describe("An inert simulation", () => {

    afterEach(() => {
        Math.random = original;
    });

    it("keeps the city it was loaded with: no scan, no sprite", () => {
        const save = getLiveSave();
        const map = new (GameMap as any)(120, 100);
        const copy = new (Simulation as any)(map, 0, Simulation.SPEED_MED, save, {inert: true});

        expect(copy.isInert()).toBe(true);
        expect(rawTiles(map)).toEqual(save.map.map((tile: any) => tile.value));
        expect(copy.spriteManager.getSpriteList()).toEqual([]);
        expect(saveOf(copy)).toEqual(save);
        expect(copy.getCityStatus().census.resPop).toBe(save.resPop);

        // A normal simulation made from the same save scans the map at once
        const running = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED, save);
        expect(running.isInert()).toBe(false);
        expect(saveOf(running)).not.toEqual(save);
    });

    it("passes on the messages of its parts", () => {
        const copy = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED, getLiveSave(),
                                             {inert: true});
        const heard: string[] = [];
        [Messages.FUNDS_CHANGED, Messages.POPULATION_UPDATED, Messages.VALVES_UPDATED, Messages.FRONT_END_MESSAGE]
            .forEach(message => copy.addEventListener(message, (v: any) => heard.push(message + " " + JSON.stringify(v))));

        copy.budget.setFunds(1234);
        copy.evaluation._emitEvent(Messages.POPULATION_UPDATED, 99);
        copy._valves._emitEvent(Messages.VALVES_UPDATED);
        copy.spriteManager._emitEvent(Messages.TRAIN_CRASHED, {x: 1, y: 2});

        expect(heard).toEqual([Messages.FUNDS_CHANGED + " 1234", Messages.POPULATION_UPDATED + " 99",
                               Messages.VALVES_UPDATED + " " + JSON.stringify({residential: copy._valves.resValve,
                                   commercial: copy._valves.comValve, industrial: copy._valves.indValve}),
                               Messages.FRONT_END_MESSAGE + " " + JSON.stringify({subject: Messages.TRAIN_CRASHED,
                                                                                  data: {x: 1, y: 2}})]);
    });

    it("never steps by itself", () => {
        const save = getLiveSave();
        const copy = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_FAST, save, {inert: true});

        for (let i = 0; i < 50; i++) {
            copy._lastTickTime = -1e9;
            copy.simTick();
            copy.step();
        }

        expect(saveOf(copy)).toEqual(save);
    });

    it("is not the default", () => {
        // Each simulation gets its own copy of the save: a simulation keeps the save's history arrays as its own
        const expected = runFrom(getLiveSave(), undefined, 80);

        [null, {}, {inert: false}, {inert: 0}].forEach(options => {
            expect(runFrom(getLiveSave(), options, 80)).toEqual(expected);
        });
        expect(runFrom(getLiveSave(), {inert: true}, 80)).toEqual(getLiveSave());
        expect(new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED).isInert()).toBe(false);
    });
});


describe("A step of the simulation", () => {

    afterEach(() => {
        Math.random = original;
    });

    it("is what the game's tick does, without the clock", () => {
        const save = getLiveSave();
        const stepped = runFrom(getLiveSave(), undefined, 100);

        Math.random = mulberry(3);
        const simulation = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED, getLiveSave());
        for (let i = 0; i < 100; i++) {
            simulation._simulate(simulation._constructSimData());
            simulation._updateTime();
        }
        Math.random = original;

        expect(saveOf(simulation)).toEqual(stepped);
        expect(stepped._cityTime).toBe(save._cityTime + 7);
    });

    it("moves the date on, even while the yearly budget waits", () => {
        const simulation = new (Simulation as any)(new (GameMap as any)(120, 100, DIRT), 0, Simulation.SPEED_FAST);
        const dates: any[] = [];
        simulation.addEventListener(Messages.DATE_UPDATED, (date: any) => dates.push(date));
        simulation.budget.awaitingValues = true;

        for (let i = 0; i < 16 * 4 + 1; i++)
            simulation.step();

        expect(simulation.getCityTime()).toBe(5);
        expect(dates).toEqual([{month: 0, year: 1900}, {month: 1, year: 1900}]);
    });

    it("needs a speed", () => {
        const simulation = new (Simulation as any)(new (GameMap as any)(120, 100, DIRT), 0, Simulation.SPEED_PAUSED);
        expect(() => simulation.step()).toThrow("A paused simulation cannot step");
        expect(simulation.getCityTime()).toBe(0);
    });
});


describe("The sprites", () => {

    it("are numbered by their manager", () => {
        const map = new (GameMap as any)(120, 100, DIRT);
        const first = new (SpriteManager as any)(map);
        const second = new (SpriteManager as any)(map);

        const train = first.makeSprite(SPRITE_TRAIN, 160, 160);
        first.makeExplosionAt(320, 320);
        const other = second.makeSprite(SPRITE_TRAIN, 160, 160);
        expect(first.getSpriteList().map((sprite: any) => sprite.id)).toEqual([1, 2]);
        expect(other.id).toBe(1);

        // A number is never given again
        train.frame = 0;
        first.pruneDeadSprites();
        expect(first.makeSprite(SPRITE_EXPLOSION, 100, 100).id).toBe(3);
        expect(first.getSpriteList().map((sprite: any) => sprite.id)).toEqual([2, 3]);
    });

    it("still come with the messages about them", () => {
        const simulation = new (Simulation as any)(new (GameMap as any)(120, 100, DIRT), 0, Simulation.SPEED_MED);
        const messages: any[] = [];
        simulation.addEventListener(Messages.FRONT_END_MESSAGE, (message: any) => messages.push(message));

        simulation.spriteManager.makeMonster();
        simulation.spriteManager.makeTornado();

        const monster = simulation.spriteManager.getSprite(SPRITE_MONSTER);
        expect(messages.map(message => message.subject)).toEqual([Messages.MONSTER_SIGHTED, Messages.TORNADO_SIGHTED]);
        expect(messages[0].data.sprite).toBe(monster);
        expect(messages[0].data.trackable).toBe(true);
        expect(typeof messages[0].data.sprite.id).toBe("number");
        expect(messages[1].data.sprite.id).toBe(monster.id + 1);
    });
});
