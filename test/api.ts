import { Api } from "../src/api.js";

const realFetch = global.fetch;

interface Sent {
    url: string;
    init: any;
}

// fetch answers with the given responses, one per request, and records what was sent
const answer = (...responses: (Response | Error | null)[]): Sent[] => {
    const sent: Sent[] = [];
    (global as any).fetch = (url: string, init: any) => {
        sent.push({url: url, init: init});
        const response = responses.shift();
        if (response === null)
            return new Promise(() => {});
        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    };
    return sent;
};

const json = (status: number, body: any, headers?: {[name: string]: string}): Response =>
    new Response(JSON.stringify(body), {status: status, headers: {"Content-Type": "application/json; charset=utf-8", ...headers}});

const failureOf = (promise: Promise<any>): Promise<any> => promise.then(() => { throw new Error("no failure"); }, error => error);


describe("Requests to the server", () => {

    afterEach(() => {
        (global as any).fetch = realFetch;
        jest.useRealTimers();
    });

    it("ask for JSON, with the page's cookies only", async () => {
        const sent = answer(json(200, {ok: true}));

        expect(await Api.get("/api/session")).toEqual({ok: true});
        expect(sent[0].url).toBe("/api/session");
        expect(sent[0].init.method).toBe("GET");
        expect(sent[0].init.credentials).toBe("same-origin");
        expect(sent[0].init.mode).toBeUndefined();
        expect(sent[0].init.headers).toEqual({"Accept": "application/json"});
        expect(sent[0].init.body).toBeUndefined();
    });

    it("send JSON, an empty object at least", async () => {
        const sent = answer(json(200, {user: {}}), new Response(null, {status: 204}));

        expect(await Api.post("/api/auth/login", {login: "alice", password: "p"})).toEqual({user: {}});
        expect(sent[0].init.method).toBe("POST");
        expect(sent[0].init.headers["Content-Type"]).toBe("application/json");
        expect(JSON.parse(sent[0].init.body)).toEqual({login: "alice", password: "p"});

        expect(await Api.post("/api/auth/logout")).toBeNull();
        expect(sent[1].init.body).toBe("{}");
    });

    it("report the server's error, with the fields it names", async () => {
        answer(json(400, {error: {code: "weak_password", fields: {password: "too_short", other: "not_a_reason", n: 3}}}));

        expect(await failureOf(Api.post("/api/auth/reset-password", {}))).toEqual({
            code: "weak_password", fields: {password: "too_short"}, status: 400, retryAfter: null
        });
    });

    it("say how long to wait, when the server says it", async () => {
        answer(json(429, {error: {code: "too_many_attempts"}}, {"Retry-After": "120"}),
               json(429, {error: {code: "rate_limited"}}, {"Retry-After": new Date(Date.now() + 30000).toUTCString()}));

        const first = await failureOf(Api.post("/api/auth/login", {}));
        expect(first.code).toBe("too_many_attempts");
        expect(first.retryAfter).toBe(120);

        const second = await failureOf(Api.post("/api/auth/login", {}));
        expect(second.retryAfter).toBeGreaterThan(25);
        expect(second.retryAfter).toBeLessThanOrEqual(30);
    });

    it("read an error without a known code from its status", async () => {
        answer(new Response("<h1>Not found</h1>", {status: 404, headers: {"Content-Type": "text/html"}}),
               json(401, {error: {code: "no_such_code"}}),
               new Response("Bad gateway", {status: 502}),
               new Response("oops", {status: 500, headers: {"Content-Type": "application/json"}}),
               json(418, {error: "teapot"}));

        expect((await failureOf(Api.get("/api/session"))).code).toBe("not_found");
        expect((await failureOf(Api.get("/api/account"))).code).toBe("unauthenticated");
        expect((await failureOf(Api.get("/api/account"))).code).toBe("network");
        expect((await failureOf(Api.get("/api/account"))).code).toBe("internal");
        expect((await failureOf(Api.get("/api/account"))).code).toBe("invalid_input");
    });

    it("refuse what is not the server's JSON", async () => {
        answer(new Response("<!doctype html><title>Game</title>", {status: 200, headers: {"Content-Type": "text/html"}}),
               new Response("{not json", {status: 200, headers: {"Content-Type": "application/json"}}),
               json(201, {user: null}));

        expect(await failureOf(Api.get("/api/session"))).toEqual({code: "internal", fields: {}, status: 200, retryAfter: null});
        expect((await failureOf(Api.get("/api/session"))).code).toBe("internal");
        expect((await failureOf(Api.get("/api/session", {status: 200}))).code).toBe("internal");
    });

    it("tell when the server cannot be reached", async () => {
        answer(new TypeError("Failed to fetch"));

        expect(await failureOf(Api.get("/api/session"))).toEqual({code: "network", fields: {}, status: 0, retryAfter: null});
    });

    it("give up on a server that does not answer in time", async () => {
        jest.useFakeTimers();
        const sent = answer(null, null);

        const failure = failureOf(Api.get("/api/session", {timeout: 3000}));
        jest.advanceTimersByTime(3000);
        expect(await failure).toEqual({code: "timeout", fields: {}, status: 0, retryAfter: null});
        expect(sent[0].init.signal.aborted).toBe(true);

        const later = failureOf(Api.get("/api/session"));
        jest.advanceTimersByTime(Api.TIMEOUT - 1);
        expect(sent[1].init.signal.aborted).toBe(false);
        jest.advanceTimersByTime(1);
        expect((await later).code).toBe("timeout");
    });

    it("give a download as it is", async () => {
        answer(new Response("{\"account\": {}}", {status: 200, headers: {"Content-Type": "application/json",
                                                                          "Content-Disposition": "attachment"}}));

        const blob = await Api.request("GET", "/api/account/export", null, {blob: true});
        expect(await blob.text()).toBe("{\"account\": {}}");
    });
});
