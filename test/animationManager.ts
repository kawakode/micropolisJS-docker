import { AnimationManager } from "../src/animationManager.js";
import { GameCanvas } from "../src/gameCanvas.js";
import { GameMap } from "../src/gameMap.js";
import { ANIMBIT, BULLBIT } from "../src/tileFlags";
import { DIRT, LASTRUBBLE, LASTTINYEXP, RUBBLE, TINYEXP } from "../src/tileValues";

const X = 2;
const Y = 3;

// A small map with a demolition explosion
const makeMap = (): any => {
    const map = new (GameMap as any)(10, 10, DIRT);
    map.setTile(X, Y, TINYEXP, ANIMBIT | BULLBIT);
    return map;
};

// The tile painted at the explosion over the next frames, each frame far enough from the last to animate
const paint = (manager: any, map: any, frames: number): number[] => {
    const painted = [];
    for (let i = 0; i < frames; i++) {
        manager.lastAnimation = new Date(0);
        const values = map.getTileValuesForPainting(0, 0, 10, 10, []);
        manager.getTiles(values, 0, 0, 10, 10, false);
        painted.push(values[Y * 10 + X]);
    }
    return painted;
};

const SEQUENCE = [861, 862, 863, 864, 865, 866, 867];


describe("The animations", () => {

    it("turn a finished explosion into rubble on the map", () => {
        const map = makeMap();
        const painted = paint(new (AnimationManager as any)(map), map, 10);

        expect(painted.slice(0, 7)).toEqual(SEQUENCE);
        const rubble = map.getTileValue(X, Y);
        expect(rubble).toBeGreaterThanOrEqual(RUBBLE);
        expect(rubble).toBeLessThanOrEqual(LASTRUBBLE);
        expect(painted.slice(7)).toEqual([rubble, rubble, rubble]);
    });

    it("can leave the map alone, holding the explosion's last frame", () => {
        const map = makeMap();
        const manager = new (AnimationManager as any)(map, {noWrite: true});
        const before = map.getTile(X, Y).getRawValue();

        expect(paint(manager, map, 12)).toEqual(SEQUENCE.concat([LASTTINYEXP, LASTTINYEXP, LASTTINYEXP, LASTTINYEXP,
                                                                 LASTTINYEXP]));
        expect(map.getTile(X, Y).getRawValue()).toBe(before);

        // Until the rubble comes from elsewhere
        map.setTile(X, Y, RUBBLE + 1, BULLBIT);
        expect(paint(manager, map, 2)).toEqual([RUBBLE + 1, RUBBLE + 1]);
    });

    it("take their options in either form, and keep the defaults", () => {
        const map = makeMap();
        const defaults = new (AnimationManager as any)(map);
        expect([defaults.animationPeriod, defaults.blinkPeriod, defaults.noWrite]).toEqual([50, 500, false]);

        const positional = new (AnimationManager as any)(map, 30, 200, {noWrite: true});
        expect([positional.animationPeriod, positional.blinkPeriod, positional.noWrite]).toEqual([30, 200, true]);

        const named = new (AnimationManager as any)(map, {animationPeriod: 40, blinkPeriod: 300, noWrite: true});
        expect([named.animationPeriod, named.blinkPeriod, named.noWrite]).toEqual([40, 300, true]);

        const empty = new (AnimationManager as any)(map, {});
        expect([empty.animationPeriod, empty.blinkPeriod, empty.noWrite]).toEqual([50, 500, false]);
    });
});


describe("The map's canvas", () => {

    // A canvas without the page
    const initCanvas = (animationManager: any, options?: any): any => {
        const canvas = Object.create((GameCanvas as any).prototype);
        canvas._calculateDimensions = () => false;
        canvas.centreOn = () => undefined;
        canvas.paint = () => undefined;
        const map = makeMap();
        if (options === undefined)
            canvas.init(map, {isValid: true}, {}, animationManager);
        else
            canvas.init(map, {isValid: true}, {}, animationManager, options);
        return canvas;
    };

    it("makes an animation manager that may write to the map, unless told not to", () => {
        expect(initCanvas(undefined).animationManager.noWrite).toBe(false);
        expect(initCanvas(null).animationManager.noWrite).toBe(false);
        expect(initCanvas(null, {}).animationManager.noWrite).toBe(false);
        expect(initCanvas(null, {noWrite: true}).animationManager.noWrite).toBe(true);
        expect(initCanvas(null).animationManager._map).toBeDefined();
    });

    it("uses the animation manager it is given", () => {
        const given = new (AnimationManager as any)(makeMap());
        expect(initCanvas(given, {noWrite: true}).animationManager).toBe(given);
    });
});
