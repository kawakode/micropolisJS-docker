const realFetch = global.fetch;

const SESSION = {
    user: null,
    features: {accounts: true, registration: true, mail: true, multiplayer: false},
    publicUrl: "https://kawacity.example.org",
    operator: "Jane <jane@example.org>",
    build: "abc123",
    limits: {passwordMin: 12, passwordMax: 128, usernameMin: 3, usernameMax: 20, cityNameMax: 15, ownedCities: 5}
};

const ALICE = {id: "AAAAAAAAAAAAAAAAAAAAAA", username: "alice", email: "alice@example.org", locale: "en", createdAt: 1};

const json = (status: number, body: any): Response =>
    new Response(JSON.stringify(body), {status: status, headers: {"Content-Type": "application/json"}});

// A fresh game page: its own Session and I18n, and fetch answering with the given responses
const page = (...responses: (Response | null)[]) => {
    const sent: {url: string, init: any}[] = [];
    (global as any).fetch = (url: string, init: any) => {
        sent.push({url: url, init: init});
        const response = responses.shift();
        return response ? Promise.resolve(response) : new Promise(() => {});
    };

    let modules: any;
    jest.isolateModules(() => {
        modules = {Session: require("../src/session.js").Session, I18n: require("../src/i18n.js").I18n};
    });
    return {Session: modules.Session, I18n: modules.I18n, sent: sent};
};


describe("The session", () => {

    afterEach(() => {
        (global as any).fetch = realFetch;
        jest.useRealTimers();
    });

    it("reads the server's answer, and only what it expects", () => {
        const {Session} = page();
        const parsed = Session.parse({...SESSION, user: {...ALICE, password: "never"}, extra: 1});

        expect(parsed).toEqual({...SESSION, available: true, user: ALICE, operator: "Jane <jane@example.org>"});
        expect(parsed.user.password).toBeUndefined();
        expect(Session.parse({...SESSION, publicUrl: "https://kawacity.example.org/some/path"}).publicUrl)
            .toBe("https://kawacity.example.org");
        expect(Session.parse({...SESSION, operator: "  "}).operator).toBeNull();
    });

    it("refuses an answer that is not the game server's", () => {
        const {Session} = page();
        [null, [], "session", {}, {...SESSION, features: null}, {...SESSION, features: {accounts: true}},
         {...SESSION, features: {...SESSION.features, mail: "yes"}}, {...SESSION, user: {username: "alice"}},
         {...SESSION, user: undefined}, {...SESSION, publicUrl: "javascript:alert(1)"}, {...SESSION, publicUrl: 3}]
            .forEach(answer => expect(Session.parse(answer)).toBeNull());
    });

    it("keeps the server's limits, or the usual ones", () => {
        const {Session} = page();
        expect(Session.parse({...SESSION, limits: {passwordMin: 16, usernameMax: "20", cityNameMax: -1,
                                                   ownedCities: 3}}).limits)
            .toEqual({...SESSION.limits, passwordMin: 16, ownedCities: 3});
        expect(Session.parse({...SESSION, limits: undefined}).limits).toEqual(Session.DEFAULT_LIMITS);
    });

    it("finds the server, and tells the listeners", async () => {
        const {Session, sent} = page(json(200, {...SESSION, user: ALICE}));
        const changes: any[] = [];
        Session.onChange((info: any) => changes.push(info));

        expect(Session.info().available).toBe(false);
        expect(await Session.detect()).toBe(true);
        expect(await Session.detect()).toBe(true);
        expect(sent.map(request => request.url)).toEqual(["/api/session"]);
        expect(Session.info()).toEqual({...SESSION, available: true, user: ALICE});
        expect(changes.length).toBe(1);
        expect(Session.isPublicOrigin("https://kawacity.example.org")).toBe(true);
        expect(Session.isPublicOrigin("http://kawacity.example.org")).toBe(false);

        Session.setUser(null);
        expect(Session.info().user).toBeNull();
        expect(changes.length).toBe(2);
    });

    it("does without a server that is not there", async () => {
        const html = new Response("<h1>404</h1>", {status: 404, headers: {"Content-Type": "text/html"}});
        const staticHost = new Response("<!doctype html>", {status: 200, headers: {"Content-Type": "text/html"}});
        for (const response of [html, staticHost, json(200, {hello: "world"}), json(201, SESSION), json(500, {})]) {
            const {Session} = page(response);
            expect(await Session.detect()).toBe(false);
            expect(Session.info().available).toBe(false);
            Session.setUser(ALICE);
            expect(Session.info().user).toBeNull();
            expect(Session.isPublicOrigin("https://kawacity.example.org")).toBe(false);
        }
    });

    it("waits for the server a few seconds at most", async () => {
        jest.useFakeTimers();
        const {Session} = page(null);

        const detection = Session.detect();
        jest.advanceTimersByTime(Session.DETECTION_TIMEOUT);
        expect(await detection).toBe(false);
    });

    it("tells the server the language of the game, for the account's emails", async () => {
        const {Session, I18n, sent} = page(json(200, {...SESSION, user: ALICE}),
                                           json(200, {user: {...ALICE, locale: "fr"}}));
        await Session.detect();

        I18n.setLanguage("fr", false);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(sent[1].url).toBe("/api/account/locale");
        expect(JSON.parse(sent[1].init.body)).toEqual({locale: "fr"});
        expect(Session.info().user.locale).toBe("fr");

        // Nothing to say when the account already has it, or nobody is logged in
        await Session.postLocale("fr");
        Session.setUser(null);
        I18n.setLanguage("en", false);
        expect(sent.length).toBe(2);
    });

    it("forgets an account whose session ended", async () => {
        const {Session} = page(json(200, {...SESSION, user: ALICE}), json(401, {error: {code: "unauthenticated"}}));
        await Session.detect();

        await Session.postLocale("fr");
        expect(Session.info().user).toBeNull();
    });
});
