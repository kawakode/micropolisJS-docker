// The game of a shared city sends the player's commands to the server (see RemoteController), and applies its
// messages. The connection, the copy of the city, the game and the players panel are fakes that note what they get.
jest.mock("jquery", () => ({__esModule: true, default: () => { throw new Error("The controller must not touch the page"); }}));

import { ERROR_TEXTS, TOOL_TEXTS } from "../src/apiErrors.js";
import { BaseTool } from "../src/baseTool.js";
import { I18n } from "../src/i18n.js";
import { RemoteController } from "../src/remoteController.js";
import { SettingsWindow } from "../src/settingsWindow.js";
import { Text } from "../src/text.js";

const R = RemoteController as any;
const S = SettingsWindow as any;
const CITY = "Cityidcityidcityidcity";

const makeConnection = () => {
    const connection = {
        online: true,
        sent: [] as any[],
        requests: [] as {message: any, callback: (error: any, reply: any) => void}[],
        send(message: any) {
            if (!connection.online)
                return false;
            connection.sent.push(message);
            return true;
        },
        request(message: any, callback: (error: any, reply: any) => void) {
            if (!connection.online) {
                callback({code: "network"}, null);
                return 0;
            }
            connection.requests.push({message, callback});
            return connection.requests.length;
        },
        // The last command's answer
        answer(error: any, reply: any = null) {
            connection.requests[connection.requests.length - 1].callback(error, reply);
        },
        messages() {
            return connection.requests.map(r => r.message);
        }
    };
    return connection;
};

const makeCity = () => ({
    map: {},
    simulation: {
        budget: {roadPercent: 1, firePercent: 1, policePercent: 1, cityTax: 7, autoBudget: true},
        disasterManager: {disastersEnabled: true},
        getLevel: () => 0
    },
    autoBulldoze: true,
    speed: 2,
    paused: false,
    applyTiles: jest.fn(),
    applySprites: jest.fn(),
    applyState: jest.fn((): string[] => []),
    applyStats: jest.fn(),
    applyMaps: jest.fn(),
    applyWelcome: jest.fn(),
    animate: jest.fn(),
    resolveMessage: jest.fn((message: any) => ({subject: message.subject, data: {resolved: true}}))
});

const makeGame = () => ({
    dialogOpen: false,
    defaultSpeed: 2,
    _preview: {key: "old"},
    _local: {applyTool: jest.fn()},
    tickerNews: {record: jest.fn()},
    ambientLife: {dayNight: true, setDayNight: jest.fn()},
    inputStatus: {toolName: "road" as string | null, pointer: null as any, getPointer() { return this.pointer; }},
    showToolOutput: jest.fn(),
    notify: jest.fn(),
    recordBudgetChanges: jest.fn(),
    setIsometric: jest.fn(),
    refreshSpeed: jest.fn(),
    applyRole: jest.fn(),
    setCityName: jest.fn(),
    processFrontEndMessage: jest.fn()
});

const makeView = () => ({
    show: jest.fn(), setRole: jest.fn(), setPlayers: jest.fn(), setChat: jest.fn(), addChat: jest.fn(),
    addNotice: jest.fn(), setStatus: jest.fn(), translate: jest.fn()
});

const players = [
    {id: "me", username: "alice", role: "owner", colour: "#e6194b", online: true},
    {id: "bob", username: "bob", role: "player", colour: "#3cb44b", online: true},
    {id: "carol", username: "carol", role: "viewer", colour: "#4363d8", online: false}
];

const welcome = (role = "owner", extra: any = {}) => Object.assign({
    t: "welcome", build: "b1",
    you: {id: "me", username: "alice", role, colour: "#e6194b"},
    city: {id: CITY, name: "Kowloon", ownerName: "alice", region: null},
    save: {dayNight: false, timeOfDay: 0.25},
    state: {}, stats: {}, maps: {}, sprites: [],
    players: players,
    chat: [{from: {id: "bob", username: "bob", colour: "#3cb44b"}, text: "hi", at: 1}]
}, extra);

const setUp = (role = "owner") => {
    const connection = makeConnection();
    const city = makeCity();
    const game = makeGame();
    const view = makeView();
    const downloads: any[] = [];
    const controller = new R(connection, city, welcome(role), {view, now: () => 1000,
                                                               download: (p: string, f: string) => downloads.push([p, f])});
    controller.attach(game);
    return {connection, city, game, view, controller, downloads};
};

const drag = (toolName: string, anchor: any, current: any, placements: any[] = [current]) =>
    ({toolName, anchor, current, placements});


describe("A shared city's commands", () => {

    afterEach(() => {
        I18n.setLanguage("en", false);
        BaseTool.setAutoBulldoze(true);
    });

    it("follow the rights of each role", () => {
        expect(R.RIGHTS).toEqual({
            owner: ["build", "budget", "speed", "settings", "deals", "disasters"],
            player: ["build", "budget", "speed", "settings", "deals"],
            viewer: []
        });
        expect(setUp("owner").controller.can("disasters")).toBe(true);
        expect(setUp("player").controller.can("disasters")).toBe(false);
        expect(setUp("player").controller.can("build")).toBe(true);
        expect(setUp("viewer").controller.can("build")).toBe(false);
        expect(setUp("admin").controller.role).toBe("viewer");
    });

    it("start the game with the welcome's players, chat and looks", () => {
        const {controller, view} = setUp("player");
        expect(controller.remote).toBe(true);
        expect(controller.cityInfo).toEqual({id: CITY, name: "Kowloon", ownerName: "alice", region: null});
        expect(controller.you).toEqual({id: "me", username: "alice", role: "player", colour: "#e6194b"});
        expect(controller.players.map((p: any) => p.username)).toEqual(["alice", "bob", "carol"]);
        expect([controller.dayNight, controller.timeOfDay]).toEqual([false, 0.25]);
        expect(view.setRole).toHaveBeenCalledWith("player");
        expect(view.setPlayers).toHaveBeenCalledWith(controller.players, "me");
        expect(view.show).toHaveBeenCalled();
    });

    it("send a tool's drag with where it started and ended, and say what the server did", () => {
        const {connection, controller, game} = setUp();
        controller.applyTool(drag("road", {x: 10, y: 20}, {x: 15, y: 20},
                                  [{x: 10, y: 20}, {x: 11, y: 20}, {x: 12, y: 20}, {x: 13, y: 20}, {x: 14, y: 20},
                                   {x: 15, y: 20}]));
        expect(connection.messages()).toEqual([{t: "tool", tool: "road", from: {x: 10, y: 20}, to: {x: 15, y: 20}}]);
        expect(game._preview).toBe(null);

        // Until the answer comes, the drag shows in our colour
        const waiting = controller.decorateOverlay(null, 1100);
        expect(waiting).toEqual({rects: [{x: 10, y: 20, width: 6, height: 1, colour: "#e6194b", outline: true}],
                                 label: null});

        connection.answer(null, {t: "toolResult", seq: 1, applied: 6, failed: 0, reason: null, cost: 60});
        expect(game.tickerNews.record.mock.calls).toEqual([["road", 6]]);
        expect(game.showToolOutput.mock.calls).toEqual([[null]]);
        expect(controller.decorateOverlay(null, 1200)).toBe(null);
    });

    it("say why a tool did nothing, as a city played alone does", () => {
        const answers: [any, any, string][] = [
            [null, {applied: 2, failed: 3, reason: "no_money"}, I18n.t(Text.toolMessages.noMoney)],
            [null, {applied: 0, failed: 3, reason: "needs_bulldoze"}, I18n.t(Text.toolMessages.needsDoze)],
            [null, {applied: 0, failed: 1, reason: "failed"}, I18n.t(TOOL_TEXTS.failed)],
            [{code: "rate_limited"}, null, I18n.t(ERROR_TEXTS.rate_limited)],
            [{code: "network"}, null, I18n.t(ERROR_TEXTS.network)],
            [{code: "valueOf"}, null, I18n.t(ERROR_TEXTS.internal)]
        ];
        answers.forEach(([error, reply, text]) => {
            const {connection, controller, game} = setUp();
            controller.applyTool(drag("residential", {x: 10, y: 20}, {x: 10, y: 20}));
            connection.answer(error, reply);
            expect(game.showToolOutput.mock.calls).toEqual([[text]]);
        });

        // Some applied, the others in the way: the tool's name
        const {connection, controller, game} = setUp();
        controller.applyTool(drag("wire", {x: 1, y: 1}, {x: 9, y: 1}));
        connection.answer(null, {applied: 4, failed: 5, reason: "needs_bulldoze"});
        expect(game.showToolOutput.mock.calls).toEqual([[null]]);
        expect(game.tickerNews.record.mock.calls).toEqual([["wire", 4]]);

        // The hint at the automatic bulldozer when it is off
        BaseTool.setAutoBulldoze(false);
        const second = setUp();
        second.controller.applyTool(drag("wire", {x: 1, y: 1}, {x: 9, y: 1}));
        second.connection.answer(null, {applied: 0, failed: 9, reason: "needs_bulldoze"});
        expect(second.game.showToolOutput.mock.calls).toEqual([[I18n.t(Text.toolMessages.needsDozeManual)]]);
        expect(second.game.tickerNews.record.mock.calls).toEqual([["needsBulldoze"]]);
    });

    it("look with the query tool at the game's own copy, without the server", () => {
        ["owner", "viewer"].forEach(role => {
            const {connection, controller, game} = setUp(role);
            const data = drag("query", {x: 5, y: 5}, {x: 5, y: 5});
            controller.applyTool(data);
            expect(game._local.applyTool.mock.calls).toEqual([[data]]);
            expect(connection.requests).toEqual([]);
        });
    });

    it("send no drag the server would refuse", () => {
        const {connection, controller, game} = setUp();
        [drag("road", {x: -1, y: 0}, {x: 3, y: 0}), drag("road", {x: 0, y: 0}, {x: 120, y: 0}),
         drag("road", {x: 0, y: 0}, {x: 3, y: 100}), drag("road", {x: 0.5, y: 0}, {x: 3, y: 0}),
         drag("road", null, {x: 3, y: 0}), drag("road", {x: "1", y: 0}, {x: 3, y: 0}),
         drag("__proto__", {x: 1, y: 1}, {x: 2, y: 2}), drag("toString", {x: 1, y: 1}, {x: 2, y: 2}),
         drag("teleport", {x: 1, y: 1}, {x: 2, y: 2})].forEach(data => controller.applyTool(data));
        expect(connection.requests).toEqual([]);

        // Nor while a window is open
        game.dialogOpen = true;
        controller.applyTool(drag("road", {x: 1, y: 1}, {x: 2, y: 1}));
        expect(connection.requests).toEqual([]);
    });

    it("let a viewer only watch, chat and look", () => {
        const {connection, controller, game, downloads} = setUp("viewer");
        controller.applyTool(drag("road", {x: 1, y: 1}, {x: 2, y: 1}));
        controller.applyBudget({cancelled: false, roadPercent: "50", firePercent: "50", policePercent: "50", taxPercent: "5"});
        controller.applySettings([{action: S.AUTOBUDGET, data: false}, {action: S.AUTOBULLDOZE, data: false},
                                  {action: S.SPEED, data: 3}, {action: S.DISASTERS_CHANGED, data: false},
                                  {action: S.LEVEL, data: 2}, {action: S.VIEW, data: false}]);
        controller.applyDisaster("Monster");
        controller.applyDeals([{side: "north", kind: "trade", signed: true}]);
        controller.setSpeed(3);
        controller.togglePause();
        controller.applyDebug([{action: 0}]);
        expect(connection.requests).toEqual([]);

        // Their own view is theirs, and every member may keep a copy
        expect(game.setIsometric.mock.calls).toEqual([[false]]);
        controller.save();
        expect(downloads).toEqual([["/api/cities/" + CITY + "/save", "Kowloon.kawacity"]]);
        expect(controller.sendChat("hello")).toBe(true);
        expect(connection.sent).toEqual([{t: "chat", text: "hello"}]);
    });

    it("send the budget's rates as whole numbers within bounds, when they changed", () => {
        const {connection, controller, game, city} = setUp("player");
        controller.applyBudget({cancelled: true, roadPercent: "50", firePercent: "50", policePercent: "50", taxPercent: "5"});
        controller.applyBudget({cancelled: false, roadPercent: "100", firePercent: "100", policePercent: "100",
                                taxPercent: "7"});
        expect(connection.requests).toEqual([]);

        controller.applyBudget({cancelled: false, roadPercent: "80", firePercent: "150", policePercent: "-5",
                                taxPercent: "25", e: {}, original: "submit"});
        controller.applyBudget({cancelled: false, roadPercent: "80.6", firePercent: 100, policePercent: "0",
                                taxPercent: "9"});
        controller.applyBudget({cancelled: false, roadPercent: "x", firePercent: "1", policePercent: "1", taxPercent: "1"});
        expect(connection.messages()).toEqual([
            {t: "budget", roadPercent: 80, firePercent: 100, policePercent: 0, taxPercent: 20},
            {t: "budget", roadPercent: 80, firePercent: 100, policePercent: 0, taxPercent: 9}
        ]);
        expect(game.recordBudgetChanges.mock.calls.length).toBe(2);

        // A refusal is told
        connection.answer({code: "forbidden"});
        expect(game.notify.mock.calls).toEqual([[I18n.t(ERROR_TEXTS.forbidden), "bad"]]);
        expect(city.simulation.budget.cityTax).toBe(7);
    });

    it("send the city's settings that changed, the owner's alone with the disasters, and apply the player's own", () => {
        const all = [{action: S.AUTOBUDGET, data: false}, {action: S.AUTOBULLDOZE, data: true},
                     {action: S.SPEED, data: 3}, {action: S.DISASTERS_CHANGED, data: false},
                     {action: S.VIEW, data: true}, {action: S.DAY_NIGHT, data: false},
                     {action: S.LEVEL, data: 2}, {action: S.LANGUAGE, data: "en"}];

        const owner = setUp("owner");
        owner.controller.applySettings(all);
        expect(owner.connection.messages()).toEqual([{t: "settings", autoBudget: false, disasters: false, level: 2},
                                                     {t: "speed", speed: 3}]);
        expect(owner.game.setIsometric.mock.calls).toEqual([[true]]);
        expect(owner.game.ambientLife.setDayNight.mock.calls).toEqual([[false]]);
        expect(owner.game.tickerNews.record.mock.calls.map((c: any) => c[0]))
            .toEqual(["disastersOff", "nightOff", "harder", "fast"]);

        const player = setUp("player");
        player.controller.applySettings(all);
        expect(player.connection.messages()).toEqual([{t: "settings", autoBudget: false, level: 2},
                                                      {t: "speed", speed: 3}]);

        // Nothing changed: nothing sent
        const same = setUp("owner");
        same.controller.applySettings([{action: S.AUTOBUDGET, data: true}, {action: S.AUTOBULLDOZE, data: true},
                                       {action: S.SPEED, data: 2}, {action: S.DISASTERS_CHANGED, data: true},
                                       {action: S.LEVEL, data: 0}, {action: S.LEVEL, data: 7}]);
        expect(same.connection.requests).toEqual([]);
    });

    it("leave as they are the budget and settings others changed while the window was open", () => {
        const shownSettings = {autoBudget: true, autoBulldoze: true, speed: 2, disasters: true, dayNight: true, level: 0,
                               language: "en", isometric: false};
        const untouched = [{action: S.AUTOBUDGET, data: true}, {action: S.AUTOBULLDOZE, data: true},
                           {action: S.SPEED, data: 2}, {action: S.DISASTERS_CHANGED, data: true},
                           {action: S.VIEW, data: true}, {action: S.DAY_NIGHT, data: true},
                           {action: S.LEVEL, data: 0}, {action: S.LANGUAGE, data: "en"}];
        const {connection, controller, game, city} = setUp("owner");
        // Meanwhile another player made it fast, then paused it, turned the automatic budget and bulldozer off, and the
        // disasters, and made it harder
        Object.assign(city, {speed: 3, paused: true, autoBulldoze: false});
        city.simulation.budget.autoBudget = false;
        city.simulation.disasterManager.disastersEnabled = false;
        city.simulation.getLevel = () => 2;
        controller.applySettings(untouched, shownSettings);
        expect(connection.requests).toEqual([]);
        expect(game.setIsometric.mock.calls).toEqual([[true]]);
        // What the player did change goes
        controller.applySettings(untouched.map(a => a.action === S.SPEED ? {action: S.SPEED, data: 1} : a), shownSettings);
        expect(connection.messages()).toEqual([{t: "speed", speed: 1}]);

        // The budget: another player set the roads to 80% and the tax to 9%
        const shownBudget = {roadRate: 100, fireRate: 100, policeRate: 100, taxRate: 7};
        const budget = city.simulation.budget;
        Object.assign(budget, {roadPercent: 0.8, cityTax: 9});
        controller.applyBudget({cancelled: false, roadPercent: "100", firePercent: "100", policePercent: "100",
                                taxPercent: "7"}, shownBudget);
        expect(connection.messages()).toHaveLength(1);
        controller.applyBudget({cancelled: false, roadPercent: "100", firePercent: "100", policePercent: "90",
                                taxPercent: "7"}, shownBudget);
        expect(connection.messages()[1]).toEqual({t: "budget", roadPercent: 80, firePercent: 100, policePercent: 90,
                                                  taxPercent: 9});

        // A rate of 29% is 29, not 28 (0.29 * 100 is 28.999...)
        Object.assign(budget, {roadPercent: 0.29, firePercent: 0.57, policePercent: 0.58, cityTax: 7});
        controller.applyBudget({cancelled: false, roadPercent: "29", firePercent: "57", policePercent: "58",
                                taxPercent: "7"}, {roadRate: 29, fireRate: 57, policeRate: 58, taxRate: 7});
        expect(connection.messages()).toHaveLength(2);
        controller.applyBudget({cancelled: false, roadPercent: "29", firePercent: "57", policePercent: "58",
                                taxPercent: "8"}, {roadRate: 29, fireRate: 57, policeRate: 58, taxRate: 7});
        expect(connection.messages()[2]).toEqual({t: "budget", roadPercent: 29, firePercent: 57, policePercent: 58,
                                                  taxPercent: 8});
    });

    it("send disasters (the owner's), deals, the speed and the pause", () => {
        const {connection, controller, game, city} = setUp("owner");
        controller.applyDisaster("None");
        controller.applyDisaster("Tornado");
        controller.applyDeals([{side: "north", kind: "trade", signed: true}, {side: "west", kind: "buyPower", signed: 0}]);
        controller.setSpeed(5);
        controller.setSpeed(1);
        city.paused = true;
        controller.togglePause();
        expect(connection.messages()).toEqual([
            {t: "disaster", kind: "Tornado"},
            {t: "deal", side: "north", kind: "trade", signed: true},
            {t: "deal", side: "west", kind: "buyPower", signed: false},
            {t: "speed", speed: 1},
            {t: "pause", paused: false}
        ]);
        expect(game.tickerNews.record.mock.calls.map((c: any) => c[0])).toEqual(["disaster:Tornado", "deal", "dealEnded",
                                                                                 "slow"]);

        const player = setUp("player");
        player.controller.applyDisaster("Monster");
        player.controller.togglePause();
        expect(player.connection.messages()).toEqual([{t: "pause", paused: true}]);
        expect(player.game.tickerNews.record.mock.calls).toEqual([["pause"]]);
    });

    it("download a copy of the city with a safe file name", () => {
        const {controller, downloads, game} = setUp("player");
        controller.receive({t: "renamed", name: "Zoé / ../city"}, 0);
        controller.save();
        expect(downloads).toEqual([["/api/cities/" + CITY + "/save", "Zo_city.kawacity"]]);
        expect(game.tickerNews.record.mock.calls).toEqual([["save"]]);
    });

    it("send chat messages as the server takes them, and say when they cannot go", () => {
        const {connection, controller, game} = setUp("viewer");
        expect(controller.sendChat("  ab  ")).toBe(true);
        expect(controller.sendChat(" ​ ")).toBe(false);
        connection.online = false;
        expect(controller.sendChat("lost")).toBe(false);
        expect(connection.sent).toEqual([{t: "chat", text: "ab"}]);
        expect(game.notify.mock.calls).toEqual([[I18n.t(ERROR_TEXTS.network), "bad"]]);
    });

    it("keep a chat message the server would refuse (5 at once, then about 1 a second), and say so once", () => {
        const connection = makeConnection();
        const view = makeView();
        let clock = 0;
        const controller = new R(connection, makeCity(), welcome("viewer"), {view, now: () => clock});
        controller.attach(makeGame());
        for (let i = 1; i <= 5; i++)
            expect(controller.sendChat("message " + i)).toBe(true);
        expect(controller.sendChat("message 6")).toBe(false);
        expect(controller.sendChat("message 6")).toBe(false);
        expect(view.addNotice.mock.calls).toEqual([[I18n.t("Not sent yet: the chat takes about one message a second. Send it again in a moment.")]]);
        clock += 1300;
        expect(controller.sendChat("message 6")).toBe(true);
        expect(controller.sendChat("message 7")).toBe(false);
        expect(view.addNotice).toHaveBeenCalledTimes(2);
        expect(connection.sent.map((m: any) => m.text)).toEqual(["message 1", "message 2", "message 3", "message 4",
                                                                  "message 5", "message 6"]);
    });

    it("tell the server where our pointer is, each frame, at most ten times a second", () => {
        const {connection, controller, game, city} = setUp();
        game.inputStatus.toolName = "park";
        game.inputStatus.pointer = {x: 10, y: 10, anchor: {x: 5, y: 6}};
        controller.animate(0);
        game.inputStatus.pointer = {x: 11, y: 10, anchor: {x: 5, y: 6}};
        controller.animate(16);
        controller.animate(110);
        game.inputStatus.pointer = null;
        controller.animate(300);
        expect(city.animate.mock.calls).toEqual([[0], [16], [110], [300]]);
        expect(connection.sent).toEqual([{t: "cursor", x: 10, y: 10, tool: "park", ax: 5, ay: 6},
                                         {t: "cursor", x: 11, y: 10, tool: "park", ax: 5, ay: 6},
                                         {t: "cursor", x: null}]);
    });
});


describe("A shared city's messages", () => {

    it("change the copy of the city", () => {
        const {controller, city, game} = setUp();
        const tiles = {t: "tiles", c: [1, 2], r: []};
        controller.receive(tiles, 5);
        controller.receive({t: "sprites", s: [[1, 1, 1, 10, 10]]}, 6);
        controller.receive({t: "stats", stats: {historyTime: 3}}, 7);
        controller.receive({t: "maps", maps: {crimeRateMap: []}}, 8);
        controller.receive({t: "state", state: {funds: 5}}, 9);
        expect(city.applyTiles.mock.calls).toEqual([[tiles]]);
        expect(city.applySprites.mock.calls).toEqual([[[[1, 1, 1, 10, 10]], 6]]);
        expect(city.applyStats.mock.calls).toEqual([[{historyTime: 3}]]);
        expect(city.applyMaps.mock.calls).toEqual([[{crimeRateMap: []}]]);
        expect(city.applyState.mock.calls).toEqual([[{funds: 5}]]);
        expect(game.refreshSpeed).not.toHaveBeenCalled();

        // The speed buttons follow the server's speed and pause
        city.applyState.mockReturnValueOnce(["paused"]);
        controller.receive({t: "state", state: {paused: true}}, 10);
        expect(game.refreshSpeed).toHaveBeenCalledTimes(1);
    });

    it("pass the news to the game, with the sprite it names", () => {
        const {controller, city, game} = setUp();
        controller.receive({t: "msg", subject: "MONSTER_SIGHTED", data: {x: 1, y: 2, spriteId: 7}}, 42);
        expect(city.resolveMessage.mock.calls).toEqual([[{t: "msg", subject: "MONSTER_SIGHTED",
                                                           data: {x: 1, y: 2, spriteId: 7}}, 42]]);
        expect(game.processFrontEndMessage.mock.calls).toEqual([[{subject: "MONSTER_SIGHTED", data: {resolved: true}}]]);

        city.resolveMessage.mockReturnValueOnce(null as any);
        controller.receive({t: "msg", subject: 5}, 43);
        expect(game.processFrontEndMessage).toHaveBeenCalledTimes(1);

        controller.receive({t: "budgetApplied"}, 44);
        expect(game.notify.mock.calls).toEqual([[I18n.t("The yearly budget was applied with the current rates."),
                                                 "neutral"]]);
    });

    it("put what the others built in the news ticker, quietly", () => {
        const {controller, game} = setUp();
        controller.receive({t: "action", by: {id: "bob", username: "bob"}, tool: "residential", count: 3, x: 1, y: 1}, 0);
        controller.receive({t: "action", by: {id: "me", username: "alice"}, tool: "road", count: 9, x: 1, y: 1}, 0);
        controller.receive({t: "action", by: {id: "bob", username: "bob"}, tool: "park", count: -2}, 0);
        controller.receive({t: "action", by: null, tool: "park", count: 1}, 0);
        expect(game.tickerNews.record.mock.calls).toEqual([["residential", 3], ["park", 1]]);
        expect(game.notify).not.toHaveBeenCalled();
    });

    it("keep the players, tell who came and who left, and drop the pointers of those who left", () => {
        const {controller, view} = setUp();
        controller.receive({t: "cursors", list: [["bob", 10, 10, "road"], ["carol", 3, 3, null]]}, 0);
        const list = [
            {id: "me", username: "alice", role: "owner", colour: "#e6194b", online: true},
            {id: "bob", username: "bob", role: "player", colour: "#3cb44b", online: false},
            {id: "carol", username: "carol", role: "viewer", colour: "#4363d8", online: true},
            {id: "dave", username: "dave", role: "player", colour: "#f58231", online: true}
        ];
        controller.receive({t: "players", list}, 0);
        expect(view.addNotice.mock.calls).toEqual([[I18n.t("{name} left the city."), "bob"],
                                                   [I18n.t("{name} joined the city."), "carol"],
                                                   [I18n.t("{name} joined the city."), "dave"]]);
        expect(view.setPlayers).toHaveBeenLastCalledWith(controller.players, "me");
        expect(controller.pointers.get("bob")).toBe(null);
        expect(controller.pointers.get("carol")).toEqual([3, 3, null]);

        // Their pointers are drawn in their colours, ours is not
        controller.receive({t: "cursors", list: [["me", 1, 1, "road"], ["carol", 3, 3, null],
                                                 ["dave", 50, 50, "residential"]]}, 0);
        const overlay = controller.decorateOverlay({rects: [{x: 1, y: 1, width: 1, height: 1}], label: {text: "$10"}}, 0);
        expect(overlay.rects.map((r: any) => r.colour)).toEqual(["#4363d8", "#f58231", undefined]);
        expect(overlay.label).toEqual({text: "$10"});
    });

    it("pass the chat to the panel", () => {
        const {controller, view} = setUp();
        const message = {t: "chat", from: {id: "bob", username: "bob", colour: "#3cb44b"}, text: "hi", at: 5};
        controller.receive(message, 0);
        expect(view.addChat.mock.calls).toEqual([[message]]);
    });

    it("follow a new role, a new name, and tell the player", () => {
        const {controller, game, view} = setUp("viewer");
        controller.receive({t: "roleChanged", role: "player"}, 0);
        expect(controller.role).toBe("player");
        expect(controller.can("build")).toBe(true);
        expect(game.applyRole).toHaveBeenCalledTimes(1);
        expect(view.setRole).toHaveBeenLastCalledWith("player");
        expect(game.notify.mock.calls).toEqual([[I18n.t("Your role in this city is now: {role}.",
                                                        {role: I18n.t("role|Player")}), "neutral"]]);

        controller.receive({t: "roleChanged", role: "player"}, 0);
        controller.receive({t: "roleChanged", role: "admin"}, 0);
        expect(game.applyRole).toHaveBeenCalledTimes(1);

        controller.receive({t: "renamed", name: "Newtown"}, 0);
        controller.receive({t: "renamed", name: "Newtown"}, 0);
        controller.receive({t: "renamed", name: " "}, 0);
        expect(game.setCityName.mock.calls).toEqual([["Newtown"]]);
        expect(controller.cityInfo.name).toBe("Newtown");
    });

    it("tell the errors that answer no command", () => {
        const {controller, game} = setUp();
        controller.receive({t: "error", code: "rate_limited"}, 0);
        expect(game.notify.mock.calls).toEqual([[I18n.t(ERROR_TEXTS.rate_limited), "bad"]]);
        controller.receive({t: "something new"}, 0);
        expect(game.notify).toHaveBeenCalledTimes(1);
    });

    it("start again from a new welcome, on the same copy of the city", () => {
        const {connection, controller, city, game, view} = setUp("viewer");
        game.inputStatus.pointer = {x: 4, y: 4, anchor: null};
        controller.animate(0);
        controller.receive({t: "cursors", list: [["bob", 10, 10, "road"]]}, 0);
        controller.applyTool(drag("query", {x: 1, y: 1}, {x: 1, y: 1}));

        const second = welcome("player", {city: {id: CITY, name: "Newtown", ownerName: "alice", region: null},
                                          chat: [{from: {id: "bob", username: "bob"}, text: "back", at: 9}]});
        controller.applyWelcome(second, 500);
        expect(city.applyWelcome.mock.calls).toEqual([[second, 500]]);
        expect(controller.role).toBe("player");
        expect(controller.pointers.get("bob")).toBe(null);
        expect(view.setChat).toHaveBeenLastCalledWith(second.chat, "me");
        expect(game.refreshSpeed).toHaveBeenCalled();
        expect(game.setCityName.mock.calls).toEqual([["Newtown"]]);
        expect(game.applyRole).toHaveBeenCalledTimes(1);

        // The server knows nothing of our pointer any more: it is sent again
        controller.animate(510);
        expect(connection.sent).toEqual([{t: "cursor", x: 4, y: 4, tool: "road"}, {t: "cursor", x: 4, y: 4, tool: "road"}]);
    });

    it("forget the drags waiting for an answer when the connection drops", () => {
        const {connection, controller, view} = setUp();
        controller.applyTool(drag("road", {x: 1, y: 1}, {x: 3, y: 1}, [{x: 1, y: 1}, {x: 3, y: 1}]));
        expect(controller.decorateOverlay(null, 1000).rects.length).toBe(1);
        controller.setStatus("reconnecting");
        expect(view.setStatus).toHaveBeenLastCalledWith("reconnecting");
        expect(controller.decorateOverlay(null, 1000)).toBe(null);
        expect(connection.requests.length).toBe(1);

        // And after a while in any case
        controller.applyTool(drag("road", {x: 1, y: 1}, {x: 3, y: 1}, [{x: 1, y: 1}, {x: 3, y: 1}]));
        expect(controller.decorateOverlay(null, 1000 + R.PENDING_TOOL_TIME)).toBe(null);
    });
});
