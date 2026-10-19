// What the game does with the city's messages, without the page (the game's methods on an object of the same fields)
// (a module: what it declares stays its own)
export {};

jest.mock("jquery", () => ({__esModule: true, default: () => { throw new Error("No page here"); }}));
// The game's module asks the window for its frames when it loads
(global as any).window = {requestAnimationFrame: () => 0};

const { Game } = require("../src/game.js");
const Messages = require("../src/messages");

const fakeGame = () => ({
    name: "Kobe",
    dialogOpen: false,
    _openWindow: null as string | null,
    _congrats: [] as string[],
    lastBadMessageTime: null,
    tickerNews: {report: jest.fn()},
    _notificationBar: {goodNews: jest.fn()},
    congratsWindow: {open: jest.fn()},
    showCongrats: Game.prototype.showCongrats
});

describe("A milestone", () => {
    it("is congratulated at once, or once the window open closes (a shared city's messages come at any time)", () => {
        const game = fakeGame();
        Game.prototype.processFrontEndMessage.call(game, {subject: Messages.REACHED_TOWN});
        expect(game.congratsWindow.open.mock.calls).toEqual([["Kobe is now a town!"]]);
        expect([game.dialogOpen, game._openWindow]).toEqual([true, "congratsWindow"]);

        // The evaluation window is open: the window waits, the open one stays the one the game knows
        const busy = fakeGame();
        Object.assign(busy, {dialogOpen: true, _openWindow: "evalWindow"});
        Game.prototype.processFrontEndMessage.call(busy, {subject: Messages.REACHED_CITY});
        Game.prototype.processFrontEndMessage.call(busy, {subject: Messages.REACHED_CAPITAL});
        expect(busy.congratsWindow.open).not.toHaveBeenCalled();
        expect(busy._openWindow).toBe("evalWindow");
        expect(busy._notificationBar.goodNews).toHaveBeenCalledTimes(2);

        // It closes: the congratulations come, one after the other
        busy.dialogOpen = false;
        busy.showCongrats();
        busy.showCongrats();
        expect(busy.congratsWindow.open.mock.calls).toEqual([["Kobe is now a city!"]]);
        busy.dialogOpen = false;
        busy.showCongrats();
        expect(busy.congratsWindow.open.mock.calls).toEqual([["Kobe is now a city!"], ["Kobe is now a capital!"]]);
        busy.dialogOpen = false;
        busy.showCongrats();
        expect(busy.congratsWindow.open).toHaveBeenCalledTimes(2);
    });
});

describe("Switching views", () => {
    it("gives back the zoom a view had, even at the most zoom", () => {
        const zoomLevels = [0.5, 0.75, 1, 1.5, 2, 3, 4];
        const canvas = {
            zoom: 4, isometric: true,
            getZoom() { return this.zoom; },
            isIsometric() { return this.isometric; },
            setIsometric(isometric: boolean) { this.isometric = isometric; },
            setZoom(zoom: number) { this.zoom = Math.min(Math.max(zoom, zoomLevels[0]), 4); }
        };
        const game: any = {gameCanvas: canvas, monsterTV: {canvas: {setIsometric: jest.fn()}},
                           ambientLife: {setIsometric: jest.fn()}};

        Game.prototype.setIsometric.call(game, false);
        expect(canvas.zoom).toBe(4);
        Game.prototype.setIsometric.call(game, true);
        expect(canvas.zoom).toBe(4);

        // Zoomed in between: the same scale
        Game.prototype.setIsometric.call(game, false);
        canvas.zoom = 2;
        Game.prototype.setIsometric.call(game, true);
        expect(canvas.zoom).toBe(1);
    });
});
