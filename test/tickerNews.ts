import { GameMap } from "../src/gameMap.js";
import * as Messages from "../src/messages";
import { Simulation } from "../src/simulation.js";
import { TickerNews } from "../src/tickerNews.js";

// A quiet, fairly happy city: what Simulation.getCityStatus describes
const makeStatus = (changes: any = {}, census: any = {}): any => Object.assign({
    census: Object.assign({
        firePop: 0, poweredZoneCount: 30, unpoweredZoneCount: 0, totalPop: 200,
        coalPowerPop: 1, nuclearPowerPop: 0, gasPowerPop: 0, solarPowerPop: 0, windPowerPop: 0,
        resZonePop: 20, comZonePop: 6, indZonePop: 4, policeStationPop: 1, fireStationPop: 1,
        pollutionAverage: 20, crimeAverage: 20, trafficAverage: 10,
    }, census),
    cityTime: 480, population: 12000, populationDelta: 300, cityClass: "CITY", score: 600, approval: 70,
    problems: [], funds: 15000, tax: 7, cashFlow: 200,
    roadPercent: 1, firePercent: 1, policePercent: 1, roadMaintenance: 100, fireMaintenance: 100, policeMaintenance: 100,
    resValve: 0, comValve: 0, indValve: 0, resCap: false, comCap: false, indCap: false,
    monster: null, tornado: null, flooding: false, pollutionMax: {x: 10, y: 10},
}, changes);

// A predictable source of random numbers
const sequence = (seed: number) => () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
};

const makeNews = (seed = 1, clock?: () => number): any => new (TickerNews as any)("Testville", sequence(seed), clock);

const take = (news: any, status: any, count: number): any[] => {
    const items = [];
    for (let i = 0; i < count; i++)
        items.push(news.next(status));
    return items;
};

describe("The news ticker", () => {

    it("starts with the city's news", () => {
        expect(makeNews().next(makeStatus()).kind).not.toBe("joke");
    });

    it("tells how the city is doing at least once in three items", () => {
        const news = makeNews(7);
        news.record("road", 40);
        news.record("police");
        const items = take(news, makeStatus(), 300);

        for (let i = 0; i + 3 <= items.length; i++)
            expect(items.slice(i, i + 3).some(item => item.kind !== "joke")).toBe(true);

        // ... but it is mostly jokes
        expect(items.filter(item => item.kind === "joke").length).toBeGreaterThan(150);
    });

    it("reports on the city every other item during a disaster", () => {
        const news = makeNews();
        const items = take(news, makeStatus({tornado: {x: 4, y: 5}}), 20);

        for (let i = 0; i + 2 <= items.length; i++)
            expect(items.slice(i, i + 2).some(item => item.kind !== "joke")).toBe(true);

        const tornado = items.find(item => item.text.indexOf("tornado") !== -1);
        expect(tornado.kind).toBe("alert");
        expect([tornado.x, tornado.y]).toEqual([4, 5]);
    });

    it("breaks in with disasters, and where they are", () => {
        const news = makeNews();
        news.next(makeStatus());
        news.next(makeStatus());
        news.report(Messages.FIRE_REPORTED, {showable: true, x: 12, y: 34});

        const item = news.next(makeStatus());
        expect(item.tag).toBe("BREAKING");
        expect(item.kind).toBe("alert");
        expect([item.x, item.y]).toEqual([12, 34]);
    });

    it("celebrates milestones", () => {
        const news = makeNews();
        news.report(Messages.REACHED_TOWN);
        const item = news.next(makeStatus());
        expect(item.kind).toBe("good");
        expect(item.text).toBe("Testville is now a town: the population passes 2,000!");
    });

    it("ignores the messages that are not news", () => {
        const news = makeNews();
        news.report(Messages.NEED_MORE_ROADS);
        news.report(Messages.HEAVY_TRAFFIC);
        expect(news._breaking.length).toBe(0);
    });

    it("jokes about what the mayor did lately", () => {
        const news = makeNews(3);
        news.record("nuclear");
        const jokes = take(news, makeStatus(), 12).filter(item => item.kind === "joke");
        expect(jokes.some(item => (TickerNews as any).JOKES.nuclear.indexOf(item.text) !== -1)).toBe(true);
    });

    it("jokes about the mayor doing nothing", () => {
        let now = 0;
        const news = makeNews(5, () => now);
        now = 10 * 60 * 1000;
        const jokes = take(news, makeStatus(), 30).filter(item => item.kind === "joke");
        expect(jokes.some(item => (TickerNews as any).JOKES.idle.indexOf(item.text) !== -1)).toBe(true);
    });

    it("treats the bulldozer's sizes as one topic, and ignores unknown topics", () => {
        const news = makeNews();
        news.record("bulldozer5", 25);
        news.record("bulldozer");
        news.record("nonsense");
        expect(news._counts).toEqual({bulldozer: 26});
    });

    it("doesn't tell a joke again too soon", () => {
        const news = makeNews(11);
        const jokes = take(news, makeStatus(), 60).filter(item => item.kind === "joke").map(item => item.text);
        expect(new Set(jokes.slice(0, 12)).size).toBe(12);
    });

    it("fills in every joke", () => {
        const news = makeNews();
        const context = {pop: 12000, yes: 70, no: 30, tax: 7, funds: 15000, n: "12"};
        Object.keys((TickerNews as any).JOKES).forEach(topic => {
            (TickerNews as any).JOKES[topic].forEach((joke: string) => {
                expect(news._fill(joke, context)).not.toMatch(/[{}]/);
            });
        });
    });

    it("only tells a joke when it makes sense", () => {
        const news = makeNews();

        // The count must be large enough
        news.record("trees", 1);
        for (let i = 0; i < 10; i++)
            expect(news._pickJoke("trees", news._context(makeStatus())) || "").not.toMatch(/planted 1 trees/);

        // There must be someone to poll
        const empty = news._context(makeStatus({population: 0}));
        news._toldJokes = [];
        for (let i = 0; i < 20; i++)
            expect(news._pickJoke("generic", empty) || "").not.toMatch(/approve|Population/);
    });

    it("puts the most pressing news first", () => {
        const news = makeNews();
        const report = news.cityReport(makeStatus({funds: 50, tax: 15}, {firePop: 3, unpoweredZoneCount: 20}));
        const keys = report.map((item: any) => item.key);

        expect(report[0].severity).toBe(3);
        expect(keys.slice(0, 2).sort()).toEqual(["broke", "fire"]);
        expect(keys).toContain("taxHigh");
        expect(keys).toContain("unpowered");
        expect(keys).not.toContain("quiet");
    });

    it("advises a new city", () => {
        const news = makeNews();
        const status = makeStatus({population: 0, populationDelta: 0, problems: [{problem: 3, votes: 21}]},
                                  {resZonePop: 0, comZonePop: 0, indZonePop: 0, coalPowerPop: 0, totalPop: 0});
        expect(news.next(status).text).toMatch(/^Welcome to Testville!/);

        // An empty city is evaluated, but has no citizens to worry
        expect(news.cityReport(status).some((item: any) => item.key === "problem3")).toBe(false);
    });

    it("explains what citizens complain about", () => {
        const news = makeNews();
        const report = news.cityReport(makeStatus({problems: [{problem: 0, votes: 32}, {problem: 4, votes: 20}]}));
        const texts = report.map((item: any) => item.text);
        expect(texts).toContain("Citizens' biggest worry: crime (32% of voters). To fix it, build police stations " +
                                "where it is worst, and fund them fully.");
        expect(texts.some((text: string) => text.indexOf("Also worrying citizens: traffic") === 0)).toBe(true);
    });

    it("goes through the city's news instead of repeating the same item", () => {
        const news = makeNews();
        const status = makeStatus({resCap: true, comCap: true, resValve: 1500});
        const texts = [0, 1, 2].map(() => news._pickNews(news.cityReport(status)).text);
        expect(new Set(texts).size).toBe(3);
    });
});


describe("The city's status", () => {

    it("describes the whole city, even while the map is being scanned", () => {
        const simulation = new (Simulation as any)(new (GameMap as any)(120, 100), 0, Simulation.SPEED_MED);
        const status = simulation.getCityStatus();

        expect(status.funds).toBe(20000);
        expect(status.tax).toBe(7);
        expect(status.monster).toBeNull();
        expect(status.flooding).toBe(false);

        // The census is counted again during each scan
        simulation._census.poweredZoneCount = 99;
        simulation._clearCensus();
        expect(simulation.getCityStatus().census).toBe(status.census);
    });
});
