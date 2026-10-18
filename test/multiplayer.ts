// The connection to a shared city (see Multiplayer.Connection), with a fake WebSocket and a fake clock: no page, no
// game and no server
jest.mock("jquery", () => ({__esModule: true, default: () => { throw new Error("The connection must not touch the page"); }}));
jest.mock("../src/game.js", () => ({Game: function() { throw new Error("No game in this test"); }}));
jest.mock("../src/accountScreens.js", () => ({AccountScreens: {stop: () => undefined}}));

import { ERROR_TEXTS, KICK_REASONS } from "../src/apiErrors.js";
import { Multiplayer } from "../src/multiplayer.js";

const M = Multiplayer as any;
const CITY = "Cityidcityidcityidcity";

// A WebSocket the test drives: open(), receive(message), drop()
class FakeSocket {
    readyState = 0;
    sent: any[] = [];
    closedWith: number | null = null;
    onopen: any = null;
    onmessage: any = null;
    onclose: any = null;
    onerror: any = null;

    constructor(public url: string) {}

    send(text: string) {
        if (this.readyState !== 1)
            throw new Error("send on a socket that is not open");
        this.sent.push(JSON.parse(text));
    }

    close(code?: number) {
        this.closedWith = code === undefined ? 1005 : code;
        this.readyState = 3;
    }

    open() {
        this.readyState = 1;
        this.onopen({});
    }

    receive(message: any) {
        this.onmessage({data: typeof message === "string" ? message : JSON.stringify(message)});
    }

    drop() {
        this.readyState = 3;
        this.onclose({code: 1006});
    }
}

// Timers that run when the test moves the clock on
class FakeTimers {
    now = 0;
    private next = 1;
    private timers = new Map<number, {at: number, fn: () => void}>();

    setTimeout = (fn: () => void, delay: number) => {
        const id = this.next++;
        this.timers.set(id, {at: this.now + delay, fn});
        return id;
    };

    clearTimeout = (id: number) => {
        this.timers.delete(id);
    };

    advance(ms: number) {
        const end = this.now + ms;
        for (;;) {
            let first: [number, {at: number, fn: () => void}] | null = null;
            this.timers.forEach((timer, id) => {
                if (timer.at <= end && (first === null || timer.at < first[1].at))
                    first = [id, timer];
            });
            if (first === null)
                break;
            const [id, timer] = first as [number, {at: number, fn: () => void}];
            this.timers.delete(id);
            this.now = timer.at;
            timer.fn();
        }
        this.now = end;
    }

    pending() {
        return this.timers.size;
    }
}

const setUp = (options: any = {}) => {
    const sockets: FakeSocket[] = [];
    const timers = new FakeTimers();
    const events: any[] = [];
    const connection = new M.Connection(Object.assign({
        url: "ws://example.org/api/ws",
        city: CITY,
        createSocket: (url: string) => {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
        onWelcome: (welcome: any) => events.push(["welcome", welcome.n]),
        onMessage: (message: any) => events.push(["message", message.t]),
        onStatus: (status: string) => events.push(["status", status]),
        onEnd: (kind: string, code: string) => events.push(["end", kind, code]),
        timers: timers,
        random: () => 0.5
    }, options));
    const last = () => sockets[sockets.length - 1];
    return {connection, sockets, timers, events, last};
};

// A connection that was welcomed
const online = (options: any = {}) => {
    const setup = setUp(options);
    setup.connection.start();
    setup.last().open();
    setup.last().receive({t: "welcome", n: 1});
    setup.events.length = 0;
    return setup;
};


describe("The connection to a shared city", () => {

    it("is made to /api/ws on the page's own server, secure when the page is", () => {
        expect(M.socketURL({protocol: "http:", host: "localhost:8080"})).toBe("ws://localhost:8080/api/ws");
        expect(M.socketURL({protocol: "https:", host: "kawacity.example.org"})).toBe("wss://kawacity.example.org/api/ws");
    });

    it("waits 1 s, then twice as long each time up to 30 s, give or take a fifth", () => {
        expect(M.RETRY_FIRST).toBe(1000);
        expect(M.RETRY_MAX).toBe(30000);
        const at = (attempt: number, random: number) => M.backoff(attempt, () => random);

        expect([0, 1, 2, 3, 4].map(n => at(n, 0.5))).toEqual([1000, 2000, 4000, 8000, 16000]);
        expect([at(0, 0), at(0, 0.999999)]).toEqual([800, 1200]);
        expect([at(3, 0), at(3, 0.999999)]).toEqual([6400, 9600]);
        [5, 6, 10, 50, 1e6].forEach(n => {
            expect(at(n, 0)).toBe(24000);
            expect(at(n, 0.5)).toBe(30000);
            expect(at(n, 0.999999)).toBe(30000);
        });

        // Random waits spread the players of a city over time, and never exceed the bounds
        for (let i = 0; i < 1000; i++) {
            const attempt = i % 12;
            const delay = M.backoff(attempt, Math.random);
            const base = Math.min(30000, 1000 * Math.pow(2, attempt));
            expect(delay).toBeGreaterThanOrEqual(Math.floor(base * 0.8));
            expect(delay).toBeLessThanOrEqual(Math.min(30000, Math.ceil(base * 1.2)));
        }
    });

    it("joins the city first, then hands on the welcome and what follows", () => {
        const {connection, events, last, sockets} = setUp();
        connection.start();
        connection.start();
        expect(sockets.length).toBe(1);
        expect(last().url).toBe("ws://example.org/api/ws");
        expect(events).toEqual([["status", "connecting"]]);

        last().open();
        expect(last().sent).toEqual([{t: "join", city: CITY}]);
        expect(connection.isOnline()).toBe(false);

        // Nothing but the welcome counts before it
        last().receive({t: "tiles", c: [], r: []});
        expect(events).toEqual([["status", "connecting"]]);

        last().receive({t: "welcome", n: 1});
        last().receive({t: "tiles", c: [], r: []});
        last().receive({t: "chat", text: "hi"});
        expect(events).toEqual([["status", "connecting"], ["status", "online"], ["welcome", 1], ["message", "tiles"],
                                ["message", "chat"]]);
        expect(connection.isOnline()).toBe(true);
        expect(connection.status).toBe("online");
    });

    it("ignores frames that are not messages", () => {
        const {last, events} = online();
        ["", "not json", "[1,2]", "null", "42", "\"text\"", JSON.stringify({type: "tiles"}), JSON.stringify({t: 5})]
            .forEach(frame => last().receive(frame));
        last().onmessage({data: new ArrayBuffer(4)});
        expect(events).toEqual([]);
    });

    it("numbers the commands and hands each answer to its command", () => {
        const {connection, last} = online();
        const answers: any[] = [];
        const callback = (name: string) => (error: any, reply: any) => answers.push([name, error, reply && reply.t]);

        expect(connection.request({t: "tool", tool: "road", from: {x: 1, y: 1}, to: {x: 2, y: 1}}, callback("tool")))
            .toBe(1);
        expect(connection.request({t: "speed", speed: 3}, callback("speed"))).toBe(2);
        expect(connection.request({t: "budget", roadPercent: 100}, callback("budget"))).toBe(3);
        expect(last().sent.slice(1)).toEqual([
            {t: "tool", tool: "road", from: {x: 1, y: 1}, to: {x: 2, y: 1}, seq: 1},
            {t: "speed", speed: 3, seq: 2},
            {t: "budget", roadPercent: 100, seq: 3}
        ]);

        last().receive({t: "ok", seq: 2});
        last().receive({t: "error", code: "forbidden", seq: 3});
        last().receive({t: "toolResult", seq: 1, applied: 2, failed: 0, reason: null, cost: 20});
        // Answers to nothing are dropped
        last().receive({t: "ok", seq: 1});
        last().receive({t: "ok", seq: "2"});
        expect(answers).toEqual([["speed", null, "ok"], ["budget", {code: "forbidden"}, null], ["tool", null, "toolResult"]]);
    });

    it("does not change the message it is given", () => {
        const {connection} = online();
        const message = {t: "pause", paused: true};
        connection.request(message, () => undefined);
        expect(message).toEqual({t: "pause", paused: true});
    });

    it("gives an error the game knows, whatever the server says", () => {
        const {connection, last, events} = online();
        let error: any = null;
        connection.request({t: "speed", speed: 2}, (e: any) => { error = e; });
        last().receive({t: "error", code: "toString", seq: 1});
        expect(error).toEqual({code: "internal"});
        expect((ERROR_TEXTS as any)[error.code]).toBeDefined();

        // An error that answers no command is the game's
        last().receive({t: "error", code: "rate_limited"});
        last().receive({t: "error", code: "__proto__"});
        expect(events).toEqual([["message", "error"], ["message", "error"]]);
    });

    it("gives up waiting for an answer after a while", () => {
        const {connection, last, timers} = online();
        const answers: any[] = [];
        connection.request({t: "speed", speed: 2}, (error: any, reply: any) => answers.push([error, reply]));
        timers.advance(M.REPLY_TIMEOUT - 1);
        expect(answers).toEqual([]);
        timers.advance(1);
        expect(answers).toEqual([[{code: "timeout"}, null]]);
        last().receive({t: "ok", seq: 1});
        expect(answers.length).toBe(1);
    });

    it("sends nothing while it is down, and says so", () => {
        const {connection, sockets} = setUp();
        const answers: any[] = [];
        expect(connection.send({t: "chat", text: "hi"})).toBe(false);
        expect(connection.request({t: "speed", speed: 2}, (error: any) => answers.push(error))).toBe(0);
        expect(answers).toEqual([{code: "network"}]);

        connection.start();
        sockets[0].open();
        // Joined, not welcomed yet
        expect(connection.send({t: "chat", text: "hi"})).toBe(false);
        sockets[0].receive({t: "welcome", n: 1});
        expect(connection.send({t: "chat", text: "hi"})).toBe(true);
        expect(sockets[0].sent).toEqual([{t: "join", city: CITY}, {t: "chat", text: "hi"}]);
    });

    it("tries again when the connection drops, waiting longer each time, and starts afresh once welcomed", () => {
        const {connection, sockets, last, timers, events} = online();
        const answers: any[] = [];
        connection.request({t: "speed", speed: 2}, (error: any) => answers.push(error));

        last().drop();
        expect(answers).toEqual([{code: "network"}]);
        expect(events).toEqual([["status", "reconnecting"]]);
        expect(connection.isOnline()).toBe(false);

        // 1 s, 2 s, 4 s...
        const waits: number[] = [];
        for (let i = 0; i < 6; i++) {
            const count = sockets.length;
            const start = timers.now;
            while (sockets.length === count)
                timers.advance(100);
            waits.push(timers.now - start);
            last().drop();
        }
        expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);

        timers.advance(30000);
        last().open();
        expect(last().sent).toEqual([{t: "join", city: CITY}]);
        last().receive({t: "welcome", n: 2});
        expect(events.filter(e => e[0] !== "status")).toEqual([["welcome", 2]]);
        expect(connection.status).toBe("online");

        // Welcomed again: the next drop waits 1 s
        const count = sockets.length;
        last().drop();
        timers.advance(999);
        expect(sockets.length).toBe(count);
        timers.advance(1);
        expect(sockets.length).toBe(count + 1);
    });

    it("says 'connecting' until the first welcome, 'reconnecting' after it", () => {
        const {connection, last, timers, events} = setUp();
        connection.start();
        last().drop();
        timers.advance(1000);
        last().open();
        last().receive({t: "welcome", n: 1});
        last().drop();
        expect(events.filter(e => e[0] === "status").map(e => e[1])).toEqual(["connecting", "online", "reconnecting"]);
    });

    it("ignores what an old connection says after a new one started", () => {
        const {last, timers, events, sockets} = online();
        const old = last();
        old.drop();
        timers.advance(1000);
        expect(sockets.length).toBe(2);
        old.receive({t: "tiles", c: [], r: []});
        old.receive({t: "kicked", reason: "deleted"});
        old.onclose({code: 1006});
        expect(events).toEqual([["status", "reconnecting"]]);
    });

    it("tries again when the server does not welcome it in time", () => {
        const {connection, last, sockets, timers} = setUp();
        connection.start();
        last().open();
        timers.advance(M.WELCOME_TIMEOUT);
        expect(sockets[0].closedWith).toBe(4000);
        timers.advance(1000);
        expect(sockets.length).toBe(2);
    });

    it("stops for good when the server ends it, and says why", () => {
        KICK_REASONS.filter((reason: string) => reason !== "shutdown").forEach((reason: string) => {
            const {connection, last, timers, events, sockets} = online();
            const answers: any[] = [];
            connection.request({t: "speed", speed: 2}, (error: any) => answers.push(error));
            last().receive({t: "kicked", reason: reason});
            expect(events).toEqual([["status", "ended"], ["end", "kicked", reason]]);
            expect(answers).toEqual([{code: "network"}]);
            expect(sockets[0].closedWith).toBe(1000);

            last().drop();
            timers.advance(120000);
            expect(sockets.length).toBe(1);
            expect(timers.pending()).toBe(0);
        });

        const {last, events} = online();
        last().receive({t: "kicked", reason: "<script>"});
        expect(events).toEqual([["status", "ended"], ["end", "kicked", "error"]]);
    });

    it("waits for a server that stops to come back, and is welcomed again", () => {
        const {connection, last, timers, events, sockets} = online();
        const answers: any[] = [];
        connection.request({t: "speed", speed: 2}, (error: any) => answers.push(error));
        last().receive({t: "kicked", reason: "shutdown"});
        expect(events).toEqual([["status", "reconnecting"]]);
        expect(answers).toEqual([{code: "network"}]);
        expect(sockets[0].closedWith).toBe(4000);
        expect(connection.isOnline()).toBe(false);

        // The server is down for a while: each attempt fails, then one is welcomed
        timers.advance(1000);
        expect(sockets.length).toBe(2);
        last().drop();
        timers.advance(2000);
        expect(sockets.length).toBe(3);
        last().open();
        expect(last().sent).toEqual([{t: "join", city: CITY}]);
        last().receive({t: "welcome", n: 2});
        expect(events.slice(-2)).toEqual([["status", "online"], ["welcome", 2]]);
        expect(events.some(e => e[0] === "end")).toBe(false);
    });

    it("stops when the city cannot be joined, and tries again when the server is only busy", () => {
        ["not_found", "forbidden", "unauthenticated", "invalid_input"].forEach(code => {
            const {connection, last, events, timers, sockets} = setUp();
            connection.start();
            last().open();
            last().receive({t: "error", code: code});
            expect(events).toEqual([["status", "connecting"], ["status", "ended"], ["end", "failed", code]]);
            timers.advance(60000);
            expect(sockets.length).toBe(1);
        });

        const {connection, last, events, timers, sockets} = setUp();
        connection.start();
        last().open();
        last().receive({t: "error", code: "server_busy"});
        expect(connection.lastError).toBe("server_busy");
        last().drop();
        timers.advance(1000);
        expect(sockets.length).toBe(2);
        expect(events.filter(e => e[0] === "end")).toEqual([]);

        last().open();
        last().receive({t: "welcome", n: 1});
        expect(connection.lastError).toBe(null);
    });

    it("tells why it keeps trying: the server's answer to join, or connections refused before they open", () => {
        const troubles: string[] = [];
        const {connection, last, timers} = setUp({onTrouble: (code: string) => troubles.push(code)});
        connection.start();
        // Each time the server is full, the page is told (its card shows why)
        for (let i = 0; i < 3; i++) {
            last().open();
            last().receive({t: "error", code: "server_busy"});
            last().drop();
            timers.advance(30000);
        }
        expect(troubles).toEqual(["server_busy", "server_busy", "server_busy"]);
        last().open();
        last().receive({t: "welcome", n: 1});
        expect(connection.lastError).toBe(null);

        // Refused before opening (too many connections of the player: an HTTP status the page cannot read), from the
        // third time in a row
        const refused = setUp({onTrouble: (code: string) => troubles.push(code)});
        troubles.length = 0;
        refused.connection.start();
        refused.last().drop();
        refused.timers.advance(30000);
        refused.last().drop();
        expect(troubles).toEqual([]);
        refused.timers.advance(30000);
        refused.last().drop();
        expect(troubles).toEqual(["refused"]);
        // Once one opens, the count starts again
        refused.timers.advance(30000);
        refused.last().open();
        refused.last().drop();
        refused.timers.advance(30000);
        refused.last().drop();
        expect(troubles).toEqual(["refused"]);
    });

    it("checks the session when attempts keep failing, and stops if it is over", () => {
        let asked = 0;
        let answer: boolean | null = true;
        const {connection, last, timers, events, sockets} = setUp({
            checkSession: (callback: (loggedIn: boolean) => void) => {
                asked++;
                if (answer !== null)
                    callback(answer);
            }
        });
        connection.start();
        last().drop();
        expect(asked).toBe(0);
        timers.advance(1000);
        last().drop();
        expect(asked).toBe(M.SESSION_CHECK_AFTER - 1);
        timers.advance(2000);
        expect(sockets.length).toBe(3);

        answer = false;
        last().drop();
        expect(events.slice(-2)).toEqual([["status", "ended"], ["end", "kicked", "session"]]);
        timers.advance(60000);
        expect(sockets.length).toBe(3);
    });

    it("can be stopped, without trying again", () => {
        const {connection, last, timers, sockets, events} = online();
        const answers: any[] = [];
        connection.request({t: "speed", speed: 2}, (error: any) => answers.push(error));
        connection.stop();
        expect(sockets[0].closedWith).toBe(1000);
        expect(answers).toEqual([{code: "network"}]);
        expect(events).toEqual([["status", "ended"]]);
        last().onclose({code: 1000});
        timers.advance(60000);
        expect(sockets.length).toBe(1);
        expect(connection.send({t: "chat", text: "hi"})).toBe(false);
    });
});


describe("The card over the page, and the reconnecting banner", () => {
    const key = (name: string) => ({key: name, stopPropagation: jest.fn(), preventDefault: jest.fn()});

    it("keep their keys from the game's shortcuts (Space presses their button), and the card the focus", () => {
        const space = key(" ");
        expect(M.ownKey(space, true)).toBe(false);
        expect(space.stopPropagation).toHaveBeenCalled();
        expect(space.preventDefault).not.toHaveBeenCalled();

        const tab = key("Tab");
        expect(M.ownKey(tab, true)).toBe(true);
        expect(tab.preventDefault).toHaveBeenCalled();

        // The banner sits over the game, which goes on: Tab leaves it
        const fromBanner = key("Tab");
        expect(M.ownKey(fromBanner, false)).toBe(false);
        expect(fromBanner.stopPropagation).toHaveBeenCalled();
        expect(fromBanner.preventDefault).not.toHaveBeenCalled();
    });
});
