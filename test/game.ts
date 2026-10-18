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
