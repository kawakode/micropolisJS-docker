import { BlockMapUtils } from "../src/blockMapUtils.js";
import { Budget } from "../src/budget.js";
import { GameMap } from "../src/gameMap.js";
import { French } from "../src/lang/fr.js";
import { Ordinances } from "../src/ordinances.js";
import { Simulation } from "../src/simulation.js";

const bitOf = (id: string): number => 1 << (Ordinances.LIST as any[]).find(o => o.id === id).bit;

const CENSUS = {totalPop: 0, policeStationPop: 0, fireStationPop: 0, roadTotal: 0, railTotal: 0, landValueAverage: 0};

describe("Ordinances", () => {
    it("gives each ordinance a bit of its own, and a French name", () => {
        const bits = Ordinances.LIST.map((o: any) => o.bit);
        expect(new Set(bits).size).toBe(bits.length);
        for (const o of Ordinances.LIST as any[]) {
            expect((French.strings as any)[o.name]).toBeDefined();
            expect((French.strings as any)[o.description]).toBeDefined();
        }
    });

    it("costs more in a larger city", () => {
        const lights = bitOf("streetLights");
        expect(Ordinances.cost(lights, 0)).toBe(100);
        expect(Ordinances.cost(lights, 20000)).toBe(100 + 600);
        expect(Ordinances.cost(0, 20000)).toBe(0);
    });

    it("adds up the effects of the ordinances in force", () => {
        const effects = Ordinances.effects(bitOf("streetLights") | bitOf("neighbourhoodWatch") | bitOf("cleanAir"));
        expect(effects.crime).toBeCloseTo(0.85 * 0.92);
        expect(effects.pollution).toBeCloseTo(0.8);
        expect([effects.res, effects.com, effects.ind]).toEqual([0, 0, -30]);
        expect(Ordinances.effects(0)).toEqual({crime: 1, pollution: 1, res: 0, com: 0, ind: 0});
    });

    it("keeps only known ordinances", () => {
        expect(Ordinances.clean(1 << 20 | 1)).toBe(1);
        expect(Ordinances.clean("3")).toBe(0);
    });

    it("are paid for each year, and kept in the save", () => {
        const budget = new (Budget as any)();
        budget.setFunds(1000);
        budget.setOrdinances(bitOf("recycling") | 1 << 20);
        expect(budget.ordinances).toBe(bitOf("recycling"));
        budget.collectTax(0, CENSUS, 0, 1, 10000);
        expect(budget.ordinanceFund).toBe(-550);
        expect(budget.totalFunds).toBe(450);

        const saved: any = {};
        budget.save(saved);
        const loaded = new (Budget as any)();
        loaded.load(saved);
        expect([loaded.ordinances, loaded.ordinanceFund]).toEqual([bitOf("recycling"), -550]);
    });

    it("lower the crime of each neighbourhood", () => {
        const crimeOf = (factor?: number): number => {
            const simulation = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED);
            const maps = simulation.blockMaps;
            maps.landValueMap.worldSet(10, 10, 20);
            maps.populationDensityMap.worldSet(10, 10, 100);
            const census: any = {};
            BlockMapUtils.crimeScan(census, maps, factor);
            return maps.crimeRateMap.worldGet(10, 10);
        };
        expect(crimeOf()).toBe(208);
        expect(crimeOf(0.85)).toBe(Math.floor(208 * 0.85));
    });

    it("change the demand for zones with the deals", () => {
        const simulation = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED);
        simulation.budget.setOrdinances(bitOf("tourism") | bitOf("housingGrants"));
        const bonus = simulation._demandBonus();
        expect([bonus.res, bonus.com, bonus.ind]).toEqual([40, 40, 0]);
    });
});
