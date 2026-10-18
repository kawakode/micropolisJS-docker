import { GraphsWindow } from "../src/graphsWindow.js";
import { Simulation } from "../src/simulation.js";

// The histories of the city (see Census): each sample holds where it is in its history, 1000 + i for the monthly one
// and 2000 + i for the yearly one
const makeCensus = (): any => {
    const census: any = {};
    ["res", "com", "ind", "money", "crime", "pollution"].forEach(key => {
        census[key + "Hist10"] = Array.from({length: 120}, (_, i) => 1000 + i);
        census[key + "Hist120"] = Array.from({length: 120}, (_, i) => 2000 + i);
    });
    return census;
};

// The window's view of the city's history, without the page
const makeWindow = (historyTime: number, range: string, custom: any = null): any => {
    const window = Object.create((GraphsWindow as any).prototype);
    window._data = {census: makeCensus(), historyTime: historyTime, startingYear: 1900};
    window._range = range;
    window._custom = custom;
    return window;
};

const samples = (window: any) => (GraphsWindow as any).samplesInView(window._data.census, "res", window._view(),
                                                                     window._data.historyTime);

describe("The graphs", () => {

    it("show the last 10 years month by month, up to the last census", () => {
        const window = makeWindow(48 * 30 + 13, "10");
        const view = window._view();
        expect(view).toEqual({from: (48 * 30 + 12) - 119 * 4, to: 48 * 30 + 12});

        const points = samples(window);
        expect(points.length).toBe(120);
        expect(points[119]).toEqual({time: 48 * 30 + 12, value: 1000});
        expect(points[0].value).toBe(1119);
    });

    it("show the last 120 years year by year", () => {
        const points = samples(makeWindow(48 * 130 + 5, "120"));
        expect(points.length).toBe(120);
        expect(points.every((p: any) => p.value >= 2000)).toBe(true);
        expect(points[119]).toEqual({time: 48 * 130, value: 2000});
    });

    it("show the year to date, from January", () => {
        const window = makeWindow(48 * 20 + 13, "ytd");
        expect(window._view()).toEqual({from: 48 * 20, to: 48 * 21});
        expect(samples(window).map((p: any) => p.time)).toEqual([960, 964, 968, 972]);
    });

    it("show a young city's history from its founding", () => {
        expect(samples(makeWindow(9, "10")).map((p: any) => p.time)).toEqual([0, 4, 8]);
        expect(samples(makeWindow(2, "ytd")).map((p: any) => p.time)).toEqual([0]);
    });

    it("show the years chosen, month by month where the monthly history reaches", () => {
        // Years 15 to 30: the monthly history goes back to year 20
        const window = makeWindow(48 * 30 + 44, "custom", {from: 15, to: 30});
        const points = samples(window);
        const yearly = points.filter((p: any) => p.value >= 2000);

        expect(yearly.map((p: any) => p.time / 48)).toEqual([15, 16, 17, 18, 19, 20]);
        expect(points.length).toBe(6 + 120);
        const times = points.map((p: any) => p.time);
        expect(times).toEqual(times.slice().sort((a: number, b: number) => a - b));
    });

    it("show long periods year by year only", () => {
        const points = samples(makeWindow(48 * 60, "custom", {from: 20, to: 60}));
        expect(points.every((p: any) => p.value >= 2000)).toBe(true);
        expect(points.length).toBe(41);
    });

    it("keep the years chosen within the city's history", () => {
        const window = makeWindow(48 * 200 + 3, "custom");
        expect(window._years()).toEqual({first: 81, last: 200});
        expect(window._clampYears(10, 300)).toEqual({from: 81, to: 200});
        expect(window._clampYears(150, 120)).toEqual({from: 150, to: 150});
    });

    it("know when the last census was taken", () => {
        const historyTime = (Simulation as any).prototype.getHistoryTime;
        expect(historyTime.call({_phaseCycle: 5, _cityTime: 8})).toBe(7);
        expect(historyTime.call({_phaseCycle: 10, _cityTime: 8})).toBe(8);
        expect(historyTime.call({_phaseCycle: 0, _cityTime: 8})).toBe(8);
        expect(historyTime.call({_phaseCycle: 3, _cityTime: 0})).toBe(0);
    });
});
