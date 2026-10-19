// The monster TV, without the page: its canvas only notes how it was set up
const mockCanvases: any[] = [];

jest.mock("jquery", () => {
    const element = {toggle: () => element, on: () => element};
    return {__esModule: true, default: () => element};
});

jest.mock("../src/gameCanvas.js", () => ({
    GameCanvas: function(this: any, id: string, parent: string) {
        this.id = id;
        this.parent = parent;
        this.init = function(this: any, ...args: any[]) { this.initArgs = args; };
        this.disallowOffMap = () => undefined;
        mockCanvases.push(this);
    }
}));

import { MonsterTV } from "../src/monsterTV.js";


describe("The monster TV", () => {

    beforeEach(() => {
        mockCanvases.length = 0;
    });

    it("sets its canvas up with the map, and the options of its animations", () => {
        const map = {width: 120, height: 100};
        const tileSet = {isValid: true};
        const spriteSheet = {};

        new (MonsterTV as any)(map, tileSet, spriteSheet, null, {noWrite: true});
        new (MonsterTV as any)(map, tileSet, spriteSheet, null);

        expect(mockCanvases.map(canvas => canvas.id)).toEqual(["#tvCanvas", "#tvCanvas"]);
        expect(mockCanvases[0].initArgs).toEqual([map, tileSet, spriteSheet, null, {noWrite: true}]);
        expect(mockCanvases[1].initArgs).toEqual([map, tileSet, spriteSheet, null, undefined]);
    });
});
