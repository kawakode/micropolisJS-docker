import { Achievements } from "../src/achievements.js";
import { GameMap } from "../src/gameMap.js";
import { French } from "../src/lang/fr.js";
import * as Messages from "../src/messages";
import { Simulation } from "../src/simulation.js";

const newSimulation = (savedGame?: any): any =>
    new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED, savedGame);

const metMessages = (simulation: any): string[] => {
    const met: string[] = [];
    simulation.addEventListener(Messages.FRONT_END_MESSAGE, (message: any) => {
        if (message.subject === Messages.ACHIEVEMENT_MET)
            met.push(message.data.id);
    });
    return met;
};

describe("Achievements", () => {
    it("gives each goal a bit and an id of its own", () => {
        const bits = Achievements.LIST.map((a: any) => a.bit);
        const ids = Achievements.LIST.map((a: any) => a.id);
        expect(new Set(bits).size).toBe(bits.length);
        expect(new Set(ids).size).toBe(ids.length);
        expect(Math.max(...bits)).toBeLessThan(31);
    });

    it("has every goal in French", () => {
        for (const a of Achievements.LIST as any[]) {
            expect((French.strings as any)[a.name]).toBeDefined();
            expect((French.strings as any)[a.goal]).toBeDefined();
        }
    });

    it("keeps only the bits of known goals from a save", () => {
        expect(Achievements.clean(1 << 30 | 1)).toBe(1);
        expect(Achievements.clean("7")).toBe(0);
        expect(Achievements.clean(undefined)).toBe(0);
    });

    it("shows the first goal not met as the next one", () => {
        expect(Achievements.next(0)!.id).toBe("school");
        expect(Achievements.next(1)!.id).toBe("park");
        const all = Achievements.LIST.reduce((mask: number, a: any) => mask | 1 << a.bit, 0);
        expect(Achievements.next(all)).toBeNull();
        expect(Achievements.count(all)).toBe(Achievements.LIST.length);
    });

    it("tells a goal once, at the monthly count, when the city meets it", () => {
        const simulation = newSimulation();
        const met = metMessages(simulation);

        simulation._census.schoolPop = 1;
        simulation._cityTime = 5;
        simulation._checkAchievements();
        expect(met).toEqual([]);

        simulation._cityTime = 8;
        simulation._checkAchievements();
        simulation._checkAchievements();
        expect(met).toEqual(["school"]);
        expect(Achievements.isMet(simulation.achievements, Achievements.byId("school"))).toBe(true);
    });

    it("keeps the goals met in the save, and meets those a saved city already meets without a word", () => {
        const simulation = newSimulation();
        simulation._census.schoolPop = 1;
        simulation._checkAchievements();
        const save: any = {};
        simulation.save(save);
        expect(save.achievements).toBe(1);

        const loaded = newSimulation(JSON.parse(JSON.stringify(save)));
        expect(loaded.achievements).toBe(1);

        const met = metMessages(loaded);
        loaded._census.stadiumPop = 1;
        loaded._checkAchievements();
        expect(met).toEqual([]);
        expect(Achievements.isMet(loaded.achievements, Achievements.byId("stadium"))).toBe(true);

        loaded._census.seaportPop = 1;
        loaded._checkAchievements();
        expect(met).toEqual(["seaport"]);
    });

    it("asks for clean power only, in a city large enough", () => {
        const cleanPower = Achievements.byId("cleanPower")!;
        const census = {solarPowerPop: 1, windPowerPop: 0, coalPowerPop: 0, gasPowerPop: 0, nuclearPowerPop: 0};
        expect(cleanPower.met({census, population: 2500})).toBe(true);
        expect(cleanPower.met({census, population: 1500})).toBe(false);
        expect(cleanPower.met({census: {...census, coalPowerPop: 1}, population: 2500})).toBe(false);
    });
});
