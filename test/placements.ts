import * as fs from "fs";
import * as path from "path";

import { GameMap } from "../src/gameMap.js";
import { GameTools } from "../src/gameTools.js";
import { InputStatus } from "../src/inputStatus.js";
import * as Messages from "../src/messages";
import { Placements } from "../src/placements.js";
import { Toolbar } from "../src/toolbar.js";
import { DIRT } from "../src/tileValues";

const P = Placements as any;
const map = new (GameMap as any)(120, 100, DIRT);
const BOUNDS = {width: 120, height: 100};

// A predictable source of random numbers
const sequence = (seed: number) => () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
};

// The size and brush of each tool's button, as InputStatus.selectTool reads them from the page: the buttons built by
// the tool bar, and those written in index.html
const buttons = (): {[tool: string]: {size: number, brush: number}} => {
    const result: {[tool: string]: {size: number, brush: number}} = {};
    const tools = (Toolbar as any).TOOLS;
    Object.keys(tools).forEach(name => {
        result[name] = {size: tools[name].size - 0, brush: (tools[name].brush - 0) || 1};
    });

    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    (html.match(/<button[^>]*class="toolButton[^>]*>/g) || []).forEach(tag => {
        const attribute = (name: string) => (tag.match(new RegExp(" " + name + "=\"([^\"]*)\"")) || [])[1];
        result[attribute("data-tool")] = {size: (attribute("data-size") as any) - 0,
                                          brush: ((attribute("data-brush") as any) - 0) || 1};
    });
    return result;
};
const BUTTONS = buttons();

// What InputStatus._computePlacements gave before Placements, word for word but for `this`: the reference
const MAX_AREA_SIDE = 64;
const MAX_BUILDINGS = 100;
const categoryBefore = (toolName: string): string => ({
    road: "line", dirtroad: "line", avenue: "line", highway: "line", rail: "line", wire: "line",
    bulldozer: "area", bulldozer3: "area", bulldozer5: "area", bulldozer7: "area", park: "area", garden: "area",
    plaza: "area", trees: "area", water: "area", landfill: "area", query: "single"} as any)[toolName] || "building";

const placementsBefore = (self: any, anchor: any, current: any): any[] => {
    const placements: any[] = [];
    let x, y;
    const category = categoryBefore(self.toolName);

    switch (category) {
      case "single":
        placements.push({x: current.x, y: current.y});
        break;

      case "line": {
        const dx = current.x - anchor.x;
        const dy = current.y - anchor.y;
        const stepX = dx < 0 ? -1 : 1;
        const stepY = dy < 0 ? -1 : 1;

        if (Math.abs(dx) >= Math.abs(dy)) {
          for (x = anchor.x; x !== current.x + stepX; x += stepX)
            placements.push({x: x, y: anchor.y});
          for (y = anchor.y + stepY; y !== current.y + stepY; y += stepY)
            placements.push({x: current.x, y: y});
        } else {
          for (y = anchor.y; y !== current.y + stepY; y += stepY)
            placements.push({x: anchor.x, y: y});
          for (x = anchor.x + stepX; x !== current.x + stepX; x += stepX)
            placements.push({x: x, y: current.y});
        }
        break;
      }

      case "area": {
        const reach = Math.floor((self.toolBrush - 1) / 2);
        const minX = Math.min(anchor.x, current.x) - reach;
        const minY = Math.min(anchor.y, current.y) - reach;
        const maxX = Math.min(Math.max(anchor.x, current.x) + reach, minX + MAX_AREA_SIDE - 1);
        const maxY = Math.min(Math.max(anchor.y, current.y) + reach, minY + MAX_AREA_SIDE - 1);

        for (y = minY; y <= maxY; y++) {
          for (x = minX; x <= maxX; x++)
            placements.push({x: x, y: y});
        }
        break;
      }

      case "building": {
        const size = self.toolWidth - 0;
        const countX = Math.floor(Math.abs(current.x - anchor.x) / size) + 1;
        const countY = Math.floor(Math.abs(current.y - anchor.y) / size) + 1;
        const dirX = current.x < anchor.x ? -1 : 1;
        const dirY = current.y < anchor.y ? -1 : 1;

        for (let j = 0; j < countY; j++) {
          for (let i = 0; i < countX; i++) {
            if (placements.length >= MAX_BUILDINGS)
              break;
            placements.push({x: anchor.x + i * size * dirX, y: anchor.y + j * size * dirY});
          }
        }
        break;
      }
    }

    return placements.filter(p => self._map.testBounds(p.x, p.y));
};

// The state of InputStatus once the tool is selected
const selected = (toolName: string): any => ({toolName: toolName, toolWidth: BUTTONS[toolName].size,
                                              toolBrush: BUTTONS[toolName].brush, _map: map});

// Random drags, as the pointer gives them: tiles of the map or beyond its edges, short drags and long ones
const randomDrags = (count: number, seed: number): any[] => {
    const random = sequence(seed);
    const coordinate = (low: number, high: number) => low + Math.floor(random() * (high - low));
    const drags = [];
    for (let i = 0; i < count; i++) {
        const anchor = {x: coordinate(-30, 150), y: coordinate(-30, 130)};
        const reach = random() < 0.6 ? 12 : 180;
        drags.push({anchor: anchor, current: {x: anchor.x + coordinate(-reach, reach + 1),
                                              y: anchor.y + coordinate(-reach, reach + 1)}});
    }
    return drags;
};

const ALL_TOOLS = P.TOOL_NAMES.concat(["query"]);

// Placements as a short text, to compare many of them quickly
const text = (placements: any[]): string => placements.map(p => p.x + "," + p.y).join(" ");


describe("The placements of a drag", () => {

    it("are those InputStatus computed, for every tool and many drags", () => {
        let compared = 0;
        const different: string[] = [];
        ALL_TOOLS.forEach((toolName: string, t: number) => {
            const self = selected(toolName);
            randomDrags(1000, t + 1).forEach(drag => {
                const expected = placementsBefore(self, drag.anchor, drag.current);
                const computed = P.computePlacements(toolName, drag.anchor, drag.current, map);
                const fromInput = (InputStatus as any).prototype._computePlacements.call(self, drag.anchor, drag.current);
                if (text(computed) !== text(expected) || text(fromInput) !== text(expected))
                    different.push(toolName + " " + JSON.stringify(drag));
                compared += expected.length;
            });
        });
        expect(different).toEqual([]);
        expect(compared).toBeGreaterThan(100000);
    });

    it("are those InputStatus computed, for drags along the edges and corners of the map", () => {
        const special = [0, 1, 2, 59, 98, 99, 100, 118, 119, 120, -1, -5];
        const different: string[] = [];
        ["road", "bulldozer", "bulldozer7", "park", "residential", "airport", "wind", "query"].forEach(toolName => {
            const self = selected(toolName);
            special.forEach(ax => special.forEach(ay => [[0, 0], [119, 99], [ax, 0], [0, ay], [ax + 3, ay - 7]].forEach(c => {
                const anchor = {x: ax, y: ay};
                const current = {x: c[0], y: c[1]};
                if (text(P.computePlacements(toolName, anchor, current, BOUNDS)) !== text(placementsBefore(self, anchor, current)))
                    different.push(toolName + " " + JSON.stringify([anchor, current]));
            })));
        });
        expect(different).toEqual([]);
    });

    it("take each tool's size and brush from the tool, as its button has them", () => {
        const tools = new (GameTools as any)(map);
        ALL_TOOLS.forEach((toolName: string) => {
            expect(BUTTONS[toolName]).toBeDefined();
            expect(P.sizeOf(toolName)).toBe(BUTTONS[toolName].size);
            expect(P.brushOf(toolName)).toBe(BUTTONS[toolName].brush);
            if (P.getToolCategory(toolName) === P.BUILDING)
                expect(tools[toolName].size).toBe(P.sizeOf(toolName));
        });
        expect(P.brushOf("bulldozer5")).toBe(5);
        expect(P.sizeOf("airport")).toBe(6);
        expect(P.sizeOf("road")).toBe(1);
    });

    it("are worked out for each category of tool", () => {
        expect(P.computePlacements("road", {x: 2, y: 2}, {x: 5, y: 3}, BOUNDS)).toEqual([
            {x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 5, y: 3}]);
        expect(P.computePlacements("rail", {x: 5, y: 5}, {x: 4, y: 2}, BOUNDS)).toEqual([
            {x: 5, y: 5}, {x: 5, y: 4}, {x: 5, y: 3}, {x: 5, y: 2}, {x: 4, y: 2}]);
        expect(P.computePlacements("bulldozer3", {x: 0, y: 0}, {x: 0, y: 0}, BOUNDS)).toEqual([
            {x: 0, y: 0}, {x: 1, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}]);
        expect(P.computePlacements("park", {x: 3, y: 4}, {x: 2, y: 5}, BOUNDS)).toEqual([
            {x: 2, y: 4}, {x: 3, y: 4}, {x: 2, y: 5}, {x: 3, y: 5}]);
        expect(P.computePlacements("residential", {x: 10, y: 10}, {x: 4, y: 12}, BOUNDS)).toEqual([
            {x: 10, y: 10}, {x: 7, y: 10}, {x: 4, y: 10}]);
        expect(P.computePlacements("query", {x: 1, y: 1}, {x: 7, y: 8}, BOUNDS)).toEqual([{x: 7, y: 8}]);
        expect(P.computePlacements("query", {x: 1, y: 1}, {x: 120, y: 8}, BOUNDS)).toEqual([]);
    });

    it("stop at each category's limit, however far the drag goes", () => {
        const huge = {x: 2147483647, y: -2147483648};
        const far = {x: 1e15, y: 1e15};
        const corner = {x: 0, y: 0};
        const across = {x: 119, y: 99};

        expect(P.computePlacements("road", corner, across, BOUNDS).length).toBe(219);
        expect(P.computePlacements("road", huge, far, BOUNDS)).toEqual([]);
        expect(P.computePlacements("road", {x: -1e15, y: 50}, {x: 1e15, y: 50}, BOUNDS).length).toBe(120);
        expect(P.computePlacements("road", corner, {x: 1e15, y: 99}, BOUNDS).length).toBe(120);
        expect(P.computePlacements("road", corner, {x: 299, y: 299}, {width: 300, height: 300}).length).toBe(P.LIMITS.line);

        expect(P.computePlacements("bulldozer7", corner, across, BOUNDS).length).toBe(64 * 64 - 3 * 64 - 3 * 61);
        expect(P.computePlacements("trees", {x: -1e15, y: -1e15}, far, {width: 1e6, height: 1e6}).length).toBe(0);
        expect(P.computePlacements("trees", {x: 10, y: 10}, far, {width: 1e6, height: 1e6}).length).toBe(4096);

        expect(P.computePlacements("wind", corner, across, BOUNDS).length).toBe(100);
        expect(P.computePlacements("wind", corner, far, {width: 1e6, height: 1e6}).length).toBe(100);
        // The first row of the grid holds the first 100 buildings, of which 40 are on the map
        expect(P.computePlacements("police", {x: 1, y: 1}, {x: 1e15, y: 1e15}, BOUNDS).length).toBe(40);

        expect(P.LIMITS).toEqual({line: 221, area: 4096, building: 100, single: 1});
    });

    it("are none for what is not a tool, a tile or a map", () => {
        const tile = {x: 3, y: 3};
        ["", "nothing", "addEventListener", "_emitEvent", "__proto__", "constructor", "toString", null, 3, {}].forEach(name => {
            expect(P.computePlacements(name, tile, tile, BOUNDS)).toEqual([]);
        });
        [{x: 1.5, y: 2}, {x: "3", y: 3}, {x: NaN, y: 1}, {x: Infinity, y: 1}, {x: 1}, null, undefined, "3,3", [3, 3]]
            .forEach(bad => {
                expect(P.computePlacements("road", bad, tile, BOUNDS)).toEqual([]);
                expect(P.computePlacements("road", tile, bad, BOUNDS)).toEqual([]);
                expect(P.computePlacements("bulldozer", tile, bad, BOUNDS)).toEqual([]);
                expect(P.computePlacements("airport", bad, tile, BOUNDS)).toEqual([]);
            });
        [null, undefined, {}, {width: 0, height: 10}, {width: 10.5, height: 10}, {width: "120", height: 100},
         {width: Infinity, height: 100}].forEach(bounds => {
            expect(P.computePlacements("road", tile, tile, bounds)).toEqual([]);
        });
    });
});


describe("The tools", () => {

    it("that may be applied for a player are all those of GameTools but the query tool", () => {
        const tools = new (GameTools as any)(map);
        const names = Object.keys(tools).filter(name => typeof tools[name].doTool === "function" && name !== "query");

        expect(P.TOOL_NAMES).toEqual(names.sort());
        expect(P.TOOL_NAMES).toContain("bulldozer7");
        expect(P.TOOL_NAMES).not.toContain("query");
        names.forEach(name => expect(P.isApplicable(name)).toBe(true));
        ["query", "addEventListener", "removeEventListener", "_emitEvent", "__proto__", "toString", "", null, undefined, 1]
            .forEach(name => expect(P.isApplicable(name)).toBe(false));
    });

    it("are dragged as InputStatus drags them", () => {
        ALL_TOOLS.concat(["unknown", "residential"]).forEach((toolName: string) => {
            expect(P.getToolCategory(toolName)).toBe(categoryBefore(toolName));
            expect((InputStatus as any).getToolCategory(toolName)).toBe(categoryBefore(toolName));
        });
        expect(P.getToolCategory("__proto__")).toBe(P.BUILDING);
        expect([(InputStatus as any).TOOL_LINE, (InputStatus as any).TOOL_AREA, (InputStatus as any).TOOL_BUILDING,
                (InputStatus as any).TOOL_SINGLE]).toEqual([P.LINE, P.AREA, P.BUILDING, P.SINGLE]);
    });
});


describe("A finished drag", () => {

    // InputStatus with a tool selected, without the page
    const makeInput = (toolName: string): any => {
        const input = Object.create((InputStatus as any).prototype);
        Object.assign(input, selected(toolName));
        return input;
    };

    it("asks for the tool to be applied, with the drag's ends", () => {
        const input = makeInput("road");
        const applied: any[] = [];
        input.addEventListener(Messages.TOOL_APPLY, (data: any) => applied.push(data));
        const gesture = {type: "tool", toolName: "road", anchor: {x: 2, y: 2}, current: {x: 4, y: 1}};

        input._applyDrag(gesture);

        expect(applied).toEqual([{toolName: "road", placements: [{x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 4, y: 1}],
                                  anchor: {x: 2, y: 2}, current: {x: 4, y: 1}}]);
        expect(applied[0].anchor).not.toBe(gesture.anchor);
        expect(P.computePlacements(applied[0].toolName, applied[0].anchor, applied[0].current, BOUNDS))
            .toEqual(applied[0].placements);
    });

    it("asks for nothing when the tool would act nowhere on the map", () => {
        const input = makeInput("residential");
        const applied: any[] = [];
        input.addEventListener(Messages.TOOL_APPLY, (data: any) => applied.push(data));

        input._applyDrag({type: "tool", toolName: "residential", anchor: {x: -9, y: 3}, current: {x: -5, y: 3}});

        expect(applied).toEqual([]);
    });
});
