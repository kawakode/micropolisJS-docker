import { GameMap } from "../src/gameMap.js";
import { I18n } from "../src/i18n.js";
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

const Jokes = (TickerNews as any).JOKES;

describe("The news ticker", () => {

    beforeEach(() => {
        I18n.setLanguage("en", false);
    });

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
        expect(jokes.some(item => Jokes.en.nuclear.indexOf(item.text) !== -1)).toBe(true);
    });

    it("jokes about the mayor doing nothing", () => {
        let now = 0;
        const news = makeNews(5, () => now);
        now = 10 * 60 * 1000;
        const jokes = take(news, makeStatus(), 30).filter(item => item.kind === "joke");
        expect(jokes.some(item => Jokes.en.idle.indexOf(item.text) !== -1)).toBe(true);
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

    it("fills in every joke, in every language", () => {
        const news = makeNews();
        const context = {pop: 12000, yes: 70, no: 30, tax: 7, funds: "$15,000", n: 12};
        Object.keys(Jokes).forEach(language => {
            Object.keys(Jokes[language]).forEach(topic => {
                Jokes[language][topic].forEach((joke: string) => {
                    expect(news._fill(joke, context)).not.toMatch(/[{}]/);
                });
            });
        });
    });

    it("has jokes on every topic in every language", () => {
        Object.keys(Jokes).forEach(language => {
            expect(Object.keys(Jokes[language]).sort()).toEqual(Object.keys(Jokes.en).sort());
            Object.keys(Jokes[language]).forEach(topic => expect(Jokes[language][topic].length).toBeGreaterThan(0));
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

    it("tells where to build the link a deal with the neighbours waits for", () => {
        const news = makeNews();
        const report = news.cityReport(makeStatus({dealsOnHold: [
            {side: "east", name: "Belmonte", kind: "trade", state: "noLink", x: 119, y: 50},
            {side: "west", name: "Roseval", kind: "sellPower", state: "noPower", x: 0, y: 50}]}));
        const deal = report.find((item: any) => item.key === "dealOnHold");

        expect(deal.text).toBe("The trade agreement with Belmonte is on hold: build a road or a railway to the east edge of the map.");
        expect([deal.x, deal.y]).toEqual([119, 50]);
    });

    it("tells what a deal with another player's city waits for, and who", () => {
        const news = makeNews();
        const textFor = (deal: any) => news.cityReport(makeStatus({dealsOnHold: [Object.assign({side: "north",
            name: "Lyon", player: true, ownerName: "bob", x: 60, y: 0}, deal)]}))
            .find((item: any) => item.key === "dealOnHold").text;

        expect(textFor({kind: "trade", state: "proposed"}))
            .toBe("Deal proposed to Lyon (Trade agreement): it waits for bob to sign it too.");
        expect(textFor({kind: "twinning", state: "offered"}))
            .toBe("bob, mayor of Lyon, offers a deal (Twinning): sign it in the Neighbours window to accept.");
        expect(textFor({kind: "trade", state: "theirLink"}))
            .toBe("The trade agreement with Lyon waits for bob to build a road or a railway to their edge.");
        expect(textFor({kind: "sellPower", state: "theirLink"}))
            .toBe("The power deal with Lyon waits for bob to build a power line to their edge.");
        expect(textFor({kind: "buyPower", state: "noPower"}))
            .toBe("No electricity comes from Lyon: bob has none to spare at their edge.");
        expect(textFor({kind: "sellPower", state: "noPower"}))
            .toBe("Lyon gets none of the electricity it buys: link the power line at the north edge to the grid, or " +
                  "build another power plant.");
        expect(textFor({kind: "trade", state: "noLink"}))
            .toBe("The trade agreement with Lyon (bob) is on hold: build a road or a railway to the north edge of the map.");
    });

    it("knows that power bought from the neighbours is power", () => {
        const news = makeNews();
        const keys = (status: any) => news.cityReport(status).map((item: any) => item.key);
        expect(keys(makeStatus({}, {coalPowerPop: 0}))).toContain("noPower");
        expect(keys(makeStatus({powerBought: 500}, {coalPowerPop: 0}))).not.toContain("noPower");
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


describe("The news ticker in French", () => {

    beforeEach(() => {
        I18n.setLanguage("fr", false);
        Object.keys(I18n.missing).forEach(key => delete (I18n.missing as any)[key]);
    });

    afterEach(() => {
        I18n.setLanguage("en", false);
    });

    it("tells French jokes", () => {
        const news = makeNews(3);
        news.record("nuclear");
        const items = take(news, makeStatus(), 30);
        const jokes = items.filter(item => item.kind === "joke");
        const french = Object.keys(Jokes.fr).reduce((all: string[], topic) => all.concat(Jokes.fr[topic]), []);

        expect(jokes.length).toBeGreaterThan(10);
        jokes.forEach(item => {
            expect(["POTINS", "RUMEUR", "TRIBUNE", "SATIRE"]).toContain(item.tag);
            expect(french.some(joke => news._fill(I18n.typeset(joke), news._context(makeStatus())) === item.text)).toBe(true);
        });
    });

    it("writes numbers, money and punctuation the French way", () => {
        const news = makeNews();
        const report = news.cityReport(makeStatus({funds: 500}));
        const funds = report.find((item: any) => item.key === "funds");
        expect(funds.text).toBe("Plus que 500\u00a0$ en caisse\u00a0: dépensez avec sagesse, ou augmentez les impôts.");

        const summary = report.find((item: any) => item.key === "summary");
        expect(summary.text).toBe("Testville, ville\u00a0: 12\u00a0000 habitants, 70\u00a0% d'opinions favorables, score 600.");
    });

    it("has every piece of news in French", () => {
        const news = makeNews();
        const crisis = makeStatus({monster: {x: 1, y: 2}, tornado: {x: 3, y: 4}, flooding: true, funds: 50, cashFlow: -300,
                                   resCap: true, comCap: true, indCap: true, tax: 15, approval: 20, populationDelta: -50,
                                   policePercent: 0.5, firePercent: 0.5, roadPercent: 0.5, resValve: 1500, comValve: 1000,
                                   indValve: 1000, problems: [0, 1, 2, 3, 4, 5, 6].map(problem => ({problem: problem, votes: 20}))},
                                  {firePop: 4, unpoweredZoneCount: 20, policeStationPop: 0, fireStationPop: 0,
                                   pollutionAverage: 100, crimeAverage: 150, trafficAverage: 100});
        const variants = [
            crisis,
            makeStatus({resValve: -1500, comValve: -1000, indValve: -1000, populationDelta: -1, funds: 500}, {firePop: 1, unpoweredZoneCount: 1}),
            makeStatus({populationDelta: 1}),
            makeStatus({}, {firePop: 1, uncoveredFirePop: 1}),
            makeStatus({}, {firePop: 4, uncoveredFirePop: 2}),
            makeStatus({population: 0}, {resZonePop: 0, comZonePop: 0, indZonePop: 0}),
            makeStatus({}, {coalPowerPop: 0}),
        ];
        ["VILLAGE", "TOWN", "CITY", "CAPITAL", "METROPOLIS", "MEGALOPOLIS"].forEach(cityClass => variants.push(makeStatus({cityClass})));

        // Each kind of deal with the neighbours on hold
        ["trade", "buyPower", "sellPower"].forEach(kind => variants.push(makeStatus({dealsOnHold: [
            {side: "north", name: "Belmonte", kind: kind, state: "noLink", x: 60, y: 0}]})));
        variants.push(makeStatus({dealsOnHold: [{side: "west", name: "Belmonte", kind: "sellPower", state: "noPower", x: 0, y: 50}]}));

        // And with another player's city
        [["trade", "noLink"], ["trade", "proposed"], ["buyPower", "offered"], ["trade", "theirLink"],
         ["buyPower", "theirLink"], ["buyPower", "noPower"], ["sellPower", "noPower"]].forEach(([kind, state]) => {
            variants.push(makeStatus({dealsOnHold: [{side: "east", name: "Lyon", kind: kind, state: state, player: true,
                                                     ownerName: "bob", x: 119, y: 50}]}));
        });

        // Each problem in first place, and in second
        [0, 1, 2, 3, 4, 5, 6].forEach(problem => variants.push(makeStatus({problems: [{problem: problem, votes: 20}, {problem: (problem + 1) % 7, votes: 20}]})));

        variants.forEach(status => news.cityReport(status).forEach((item: any) => expect(item.text).not.toMatch(/[{}]/)));
        variants.forEach(status => take(news, status, 4));

        Object.keys(Messages).forEach(name => {
            const subject = (Messages as any)[name];
            if (typeof subject === "string") {
                news.report(subject, {x: 1, y: 1});
                take(news, makeStatus(), 4);
            }
        });

        expect(Object.keys(I18n.missing)).toEqual([]);
    });
});
