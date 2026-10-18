import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { AirplaneSprite } from "../src/airplaneSprite.js";
import { BoatSprite } from "../src/boatSprite.js";
import { Budget } from "../src/budget.js";
import { BudgetWindow } from "../src/budgetWindow.js";
import { BulldozerTool } from "../src/bulldozerTool.js";
import { CityFile } from "../src/cityFile.js";
import { Config } from "../src/config.js";
import { CongratsWindow } from "../src/congratsWindow.js";
import { CopterSprite } from "../src/copterSprite.js";
import { DebugWindow } from "../src/debugWindow.js";
import { DisasterManager } from "../src/disasterManager.js";
import { DisasterWindow } from "../src/disasterWindow.js";
import { Evaluation } from "../src/evaluation.js";
import { EvaluationWindow } from "../src/evaluationWindow.js";
import { EventEmitter } from "../src/eventEmitter.js";
import { ExplosionSprite } from "../src/explosionSprite.js";
import { GameMap } from "../src/gameMap.js";
import { GameTools } from "../src/gameTools.js";
import { GraphsWindow } from "../src/graphsWindow.js";
import { InputStatus } from "../src/inputStatus.js";
import * as Messages from "../src/messages";
import { ModalWindow } from "../src/modalWindow.js";
import { MonsterSprite } from "../src/monsterSprite.js";
import { NeighboursWindow } from "../src/neighboursWindow.js";
import { PowerManager } from "../src/powerManager.js";
import { QueryTool } from "../src/queryTool.js";
import { QueryWindow } from "../src/queryWindow.js";
import { SaveWindow } from "../src/saveWindow.js";
import { ScenarioWindow } from "../src/scenarioWindow.js";
import { ScreenshotWindow } from "../src/screenshotWindow.js";
import { SettingsWindow } from "../src/settingsWindow.js";
import { Simulation } from "../src/simulation.js";
import { SpriteManager } from "../src/spriteManager.js";
import { SPRITE_EXPLOSION, SPRITE_HELICOPTER } from "../src/spriteConstants";
import { DIRT } from "../src/tileValues";
import { TornadoSprite } from "../src/tornadoSprite.js";
import { TrainSprite } from "../src/trainSprite.js";
import { Valves } from "../src/valves.js";

// A class decorated as the game's classes are
const makeClass = (): any => EventEmitter(function(this: any, name: string) { this.name = name; });

// A predictable source of random numbers, as a server room would have
const mulberry = (seed: number) => () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
};


describe("An event emitter", () => {

    afterEach(() => {
        Config.debug = false;
        jest.restoreAllMocks();
    });

    it("keeps the listeners of each instance of a class apart", () => {
        const Thing = makeClass();
        const a = new Thing("a");
        const b = new Thing("b");
        const heard: string[] = [];
        a.addEventListener("ping", (v: string) => heard.push("a:" + v));
        b.addEventListener("ping", (v: string) => heard.push("b:" + v));

        a._emitEvent("ping", 1);
        b._emitEvent("ping", 2);
        new Thing("c")._emitEvent("ping", 3);

        expect(heard).toEqual(["a:1", "b:2"]);
    });

    it("decorates an object with its own listeners", () => {
        const first = EventEmitter({value: 1});
        const second = EventEmitter({value: 2});
        const heard: number[] = [];
        first.addEventListener("ping", (v: number) => heard.push(v));

        first._emitEvent("ping", 1);
        second._emitEvent("ping", 2);

        expect(heard).toEqual([1]);
        expect(Object.keys(first)).toEqual(["value", "addEventListener", "removeEventListener", "_emitEvent"]);
    });

    it("refuses to overwrite existing properties", () => {
        expect(() => EventEmitter({_emitEvent: 1})).toThrow("Cannot decorate object");
        const Thing = makeClass();
        expect(() => EventEmitter(Thing)).toThrow("Cannot decorate constructor");
    });

    it("adds a listener once, and removes it", () => {
        const thing = new (makeClass())("a");
        let count = 0;
        const listener = () => { count++; };

        thing.addEventListener("ping", listener);
        thing.addEventListener("ping", listener);
        thing._emitEvent("ping");
        expect(count).toBe(1);

        thing.removeEventListener("ping", listener);
        thing.removeEventListener("ping", listener);
        thing.removeEventListener("other", listener);
        thing._emitEvent("ping");
        expect(count).toBe(1);

        // Removing from an object that never had a listener is harmless too
        new (makeClass())("b").removeEventListener("ping", listener);
    });

    it("passes the value to every listener of the event, in order", () => {
        const thing = new (makeClass())("a");
        const heard: string[] = [];
        thing.addEventListener("ping", (v: any) => heard.push("first " + v.n));
        thing.addEventListener("ping", (v: any) => heard.push("second " + v.n));
        thing.addEventListener("pong", () => heard.push("pong"));

        thing._emitEvent("ping", {n: 7});
        thing._emitEvent("nothing listens", {n: 8});

        expect(heard).toEqual(["first 7", "second 7"]);
    });

    it("calls the listeners there were when the event was sent, even if they change", () => {
        const thing = new (makeClass())("a");
        const heard: string[] = [];
        const late = () => heard.push("late");
        const second = () => heard.push("second");
        const first = () => {
            heard.push("first");
            thing.removeEventListener("ping", first);
            thing.removeEventListener("ping", second);
            thing.addEventListener("ping", late);
        };
        thing.addEventListener("ping", first);
        thing.addEventListener("ping", second);

        thing._emitEvent("ping");
        expect(heard).toEqual(["first", "second"]);

        thing._emitEvent("ping");
        expect(heard).toEqual(["first", "second", "late"]);
    });

    it("warns about an undefined event, and throws in debug mode", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const thing = new (makeClass())("a");
        let heard = 0;
        thing.addEventListener("ping", () => { heard++; });

        thing._emitEvent(undefined);
        expect(warn).toHaveBeenCalledWith("Sending undefined event!");
        expect(heard).toBe(0);

        Config.debug = true;
        expect(() => thing._emitEvent(undefined)).toThrow("Sending undefined event!");
    });

    it("hides the listeners from the object's properties, and from saves", () => {
        const Thing = makeClass();
        const thing = new Thing("a");
        thing.addEventListener("ping", () => undefined);

        expect(Object.keys(thing)).toEqual(["name"]);
        expect(JSON.stringify(thing)).toBe("{\"name\":\"a\"}");
        expect(Object.assign({}, thing)).toEqual({name: "a"});
        expect(Object.prototype.propertyIsEnumerable.call(thing, (EventEmitter as any).LISTENERS)).toBe(false);
    });

    it("takes nothing from the prototype, nor from Object's", () => {
        const Thing = makeClass();
        const heard: string[] = [];
        Thing.prototype.addEventListener("ping", () => heard.push("prototype"));
        const thing = new Thing("a");
        const derived = Object.create(thing);

        thing._emitEvent("ping");
        derived._emitEvent("ping");
        thing._emitEvent("constructor");
        thing._emitEvent("__proto__");
        thing.addEventListener("toString", () => heard.push("toString"));
        thing._emitEvent("toString");

        expect(heard).toEqual(["toString"]);
        Thing.prototype._emitEvent("ping");
        expect(heard).toEqual(["toString", "prototype"]);
    });
});


describe("The game's emitters", () => {

    it("keep the listeners of each instance of every class they decorate apart", () => {
        const classes: {[name: string]: any} = {
            AirplaneSprite, BoatSprite, Budget, BudgetWindow, BulldozerTool, CongratsWindow, CopterSprite, DebugWindow,
            DisasterManager, DisasterWindow, Evaluation, EvaluationWindow, ExplosionSprite, GraphsWindow, InputStatus,
            MonsterSprite, NeighboursWindow, PowerManager, QueryTool, QueryWindow, SaveWindow, ScenarioWindow,
            ScreenshotWindow, SettingsWindow, Simulation, SpriteManager, TornadoSprite, TrainSprite, Valves};
        const shared: string[] = [];

        Object.keys(classes).forEach(name => {
            const prototype = classes[name].prototype;
            expect([name, typeof prototype.addEventListener, typeof prototype._emitEvent])
                .toEqual([name, "function", "function"]);

            // Instances made without running the constructors, which may need the page
            const first = Object.create(prototype);
            const second = Object.create(prototype);
            const heard: string[] = [];
            first.addEventListener("ping", () => heard.push("first"));
            second.addEventListener("ping", () => heard.push("second"));
            first._emitEvent("ping");
            second._emitEvent("ping");
            Object.create(prototype)._emitEvent("ping");
            if (heard.join() !== "first,second")
                shared.push(name + ": " + heard.join());
        });

        expect(shared).toEqual([]);
    });

    it("keep each budget's listeners apart", () => {
        const first = new (Budget as any)();
        const second = new (Budget as any)();
        const heard: string[] = [];
        first.addEventListener(Messages.FUNDS_CHANGED, (funds: number) => heard.push("first " + funds));
        second.addEventListener(Messages.FUNDS_CHANGED, (funds: number) => heard.push("second " + funds));

        first.setFunds(100);
        second.setFunds(200);

        expect(heard).toEqual(["first 100", "second 200"]);
    });

    it("pass on each simulation's own messages only", () => {
        const first = new (Simulation as any)(new (GameMap as any)(120, 100, DIRT), 0, Simulation.SPEED_MED);
        const second = new (Simulation as any)(new (GameMap as any)(120, 100, DIRT), 0, Simulation.SPEED_MED);
        const heard: string[] = [];
        first.addEventListener(Messages.FUNDS_CHANGED, (funds: number) => heard.push("first " + funds));
        second.addEventListener(Messages.FUNDS_CHANGED, (funds: number) => heard.push("second " + funds));
        first.addEventListener(Messages.FRONT_END_MESSAGE, (m: any) => heard.push("first " + m.subject));
        second.addEventListener(Messages.FRONT_END_MESSAGE, (m: any) => heard.push("second " + m.subject));

        first.budget.spend(500);
        second.budget.spend(second.budget.totalFunds);
        first.disasterManager._emitEvent(Messages.EARTHQUAKE, {x: 1, y: 1});

        expect(heard).toEqual(["first 19500", "second 0", "second " + Messages.NO_MONEY, "first " + Messages.EARTHQUAKE]);
    });

    it("pass on the crashes of each sprite manager's own sprites", () => {
        const map = new (GameMap as any)(120, 100, DIRT);
        const managers = [new (SpriteManager as any)(map), new (SpriteManager as any)(map)];
        const heard: string[] = [];
        managers.forEach((manager: any, i: number) => {
            [Messages.HELICOPTER_CRASHED, Messages.HEAVY_TRAFFIC, Messages.EXPLOSION_REPORTED].forEach(message => {
                manager.addEventListener(message, (data: any) => heard.push(i + " " + message + " " + data.x));
            });
        });

        const copters = managers.map((manager: any) => manager.makeSprite(SPRITE_HELICOPTER, 320, 320));
        const explosion = managers[1].makeSprite(SPRITE_EXPLOSION, 160, 160);
        copters[0]._emitEvent(Messages.HELICOPTER_CRASHED, {x: 10});
        copters[1]._emitEvent(Messages.HEAVY_TRAFFIC, {x: 11});
        explosion._emitEvent(Messages.EXPLOSION_REPORTED, {x: 12});
        // A sprite passes on only the messages its kind sends
        explosion._emitEvent(Messages.HEAVY_TRAFFIC, {x: 13});

        expect(heard).toEqual(["0 " + Messages.HELICOPTER_CRASHED + " 10", "1 " + Messages.HEAVY_TRAFFIC + " 11",
                               "1 " + Messages.EXPLOSION_REPORTED + " 12"]);
    });

    it("let the tools of each map ask for their own query window", () => {
        const registries = [new (GameTools as any)(new (GameMap as any)(20, 20, DIRT)),
                            new (GameTools as any)(new (GameMap as any)(20, 20, DIRT))];
        const heard: string[] = [];
        registries.forEach((tools: any, i: number) => {
            tools.addEventListener(Messages.QUERY_WINDOW_NEEDED, () => heard.push("registry " + i));
            tools.query.addEventListener(Messages.QUERY_WINDOW_NEEDED, () => heard.push("query tool " + i));
        });

        registries[1].query._emitEvent(Messages.QUERY_WINDOW_NEEDED);
        registries[0].query._emitEvent(Messages.QUERY_WINDOW_NEEDED);

        expect(heard).toEqual(["registry 1", "query tool 1", "registry 0", "query tool 0"]);
        expect(registries[0].bulldozer3).toBe(registries[0].bulldozer);
    });

    it("keep each window's listeners apart", () => {
        const Window = ModalWindow(function() { /* no page needed */ });
        const first = new (Window as any)("opacity", "first");
        const second = new (Window as any)("opacity", "second");
        const heard: string[] = [];
        first.addEventListener(Messages.BUDGET_WINDOW_CLOSED, (v: string) => heard.push("first " + v));
        second.addEventListener(Messages.BUDGET_WINDOW_CLOSED, (v: string) => heard.push("second " + v));

        second._emitEvent(Messages.BUDGET_WINDOW_CLOSED, "ok");

        expect(heard).toEqual(["second ok"]);
        expect(first._windowID).toBe("#first");
    });
});


describe("Cities simulated side by side", () => {

    const STEPS = 16 * 24;
    const original = Math.random;

    afterEach(() => {
        Math.random = original;
    });

    const load = (file: string) => {
        const buffer = fs.readFileSync(path.join(__dirname, "..", "cities", file));
        return (CityFile as any).read(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), {});
    };

    // A city with its own source of random numbers, as a server room would run it, noting what it tells its players
    const makeRoom = (file: string, seed: number): any => {
        const random = mulberry(seed);
        Math.random = random;
        const map = new (GameMap as any)(120, 100);
        const simulation = new (Simulation as any)(map, 0, Simulation.SPEED_FAST, load(file));
        const events: string[] = [];
        ["FRONT_END_MESSAGE", "FUNDS_CHANGED", "POPULATION_UPDATED", "DATE_UPDATED", "VALVES_UPDATED"].forEach(name => {
            simulation.addEventListener((Messages as any)[name], (v: any) => {
                events.push(name + ":" + JSON.stringify(v && v.subject ? v.subject : v));
            });
        });
        const tools = new (GameTools as any)(map);
        Math.random = original;
        return {random: random, simulation: simulation, events: events, tools: tools};
    };

    const step = (room: any, i: number) => {
        Math.random = room.random;
        const simulation = room.simulation;
        simulation.step();
        simulation.spriteManager.moveObjects(simulation._constructSimData());
        if (simulation.budget.awaitingValues)
            simulation.budget.doBudgetWindow();
        if (i % 50 === 0) {
            room.tools.bulldozer.doTool(30 + (i % 40), 40, simulation.blockMaps);
            room.tools.bulldozer.modifyIfEnoughFunding(simulation.budget);
        }
        Math.random = original;
    };

    const hash = (room: any): string => {
        const saveData: any = {};
        room.simulation.save(saveData);
        const sprites = room.simulation.spriteManager.spriteList.map((s: any) => [s.id, s.type, s.x, s.y, s.frame]);
        return crypto.createHash("sha256").update(JSON.stringify(saveData) + JSON.stringify(sprites) +
                                                  room.events.join("|")).digest("hex");
    };

    it("run as each would alone", () => {
        const alone = makeRoom("kowloon.cty", 1);
        for (let i = 0; i < STEPS; i++)
            step(alone, i);

        const rooms = [makeRoom("kowloon.cty", 1), makeRoom("haight.cty", 2), makeRoom("kobe.cty", 3)];
        for (let i = 0; i < STEPS; i++)
            rooms.forEach(room => step(room, i));

        expect(alone.events.length).toBeGreaterThan(STEPS / 16);
        expect(rooms[0].events).toEqual(alone.events);
        expect(hash(rooms[0])).toBe(hash(alone));
        expect(hash(rooms[1])).not.toBe(hash(rooms[0]));
    });
});
