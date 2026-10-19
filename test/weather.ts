import { Budget } from "../src/budget.js";
import { GameMap } from "../src/gameMap.js";
import * as Messages from "../src/messages";
import { Simulation } from "../src/simulation.js";
import { Weather } from "../src/weather.js";

const original = Math.random;

afterEach(() => {
    Math.random = original;
});

describe("Weather", () => {
    it("lets snow fall in winter only, and melt in March", () => {
        Math.random = () => 0;
        const weather = new (Weather as any)();
        expect(weather.newMonth(10)).toBe(false);
        expect(weather.snow).toBe(false);
        expect(weather.newMonth(11)).toBe(true);
        expect(weather.newMonth(0)).toBe(false);
        expect(weather.snow).toBe(true);
        weather.newMonth(2);
        expect(weather.snow).toBe(false);
        expect(weather.snowMonths).toBe(2);
    });

    it("gives the solar farms less in winter and under snow, and the wind turbines what the wind gives", () => {
        Math.random = () => 0.99;
        const weather = new (Weather as any)();
        weather.newMonth(6);
        expect(weather.solarFactor()).toBeCloseTo(1.2);
        expect(weather.wind).toBe(Weather.WINDY);
        expect(weather.windFactor()).toBeCloseTo(1.5);

        weather.newMonth(0);
        expect(weather.solarFactor()).toBeCloseTo(0.6);
        weather.snow = true;
        expect(weather.solarFactor()).toBeCloseTo(0.3);
        expect(weather.describe()).toEqual({snow: true, wind: Weather.WINDY, solar: 30, windPower: 150});
    });

    it("makes the roads cost more after a snowy year, then counts again", () => {
        const weather = new (Weather as any)();
        weather.snowMonths = 3;
        expect(weather.closeYear()).toBeCloseTo(1.3);
        expect(weather.closeYear()).toBe(1);

        const census = {roadTotal: 100, railTotal: 0, policeStationPop: 0, fireStationPop: 0, totalPop: 0,
                        landValueAverage: 0};
        const dry = new (Budget as any)();
        dry.collectTax(0, census, 0);
        const snowy = new (Budget as any)();
        snowy.collectTax(0, census, 0, 1.3);
        expect(snowy.roadMaintenanceBudget).toBe(Math.floor(dry.roadMaintenanceBudget * 1.3));
    });

    it("keeps the weather in the save, and takes no nonsense from it", () => {
        const weather = new (Weather as any)();
        weather.snow = true;
        weather.wind = Weather.CALM;
        weather.snowMonths = 2;
        const save: any = {};
        weather.save(save);

        const loaded = new (Weather as any)();
        loaded.load(save, 0);
        expect(loaded.describe()).toEqual(weather.describe());
        expect(loaded.snowMonths).toBe(2);

        loaded.load({weatherWind: 7, snowMonths: -1, weatherSnow: "yes"}, 0);
        expect(loaded.wind).toBe(Weather.BREEZE);
        expect(loaded.snowMonths).toBe(0);
        expect(loaded.snow).toBe(false);
    });

    it("tells the city when snow falls, at the start of a winter month", () => {
        Math.random = () => 0;
        const simulation = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED);
        const subjects: string[] = [];
        simulation.addEventListener(Messages.FRONT_END_MESSAGE, (message: any) => subjects.push(message.subject));
        simulation._cityTime = 11 * 4;
        simulation._newMonthWeather();
        expect(subjects).toEqual([Messages.SNOW_FELL]);
        expect(simulation.getWeather().snow).toBe(true);
        expect(simulation.getCityStatus().weather.snow).toBe(true);
    });
});
