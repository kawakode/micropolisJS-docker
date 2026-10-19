import * as crypto from "crypto";

import { Captcha } from "../src/captcha.js";

const realFetch = global.fetch;
const sha256 = (text: string): string => crypto.createHash("sha256").update(text, "utf8").digest("hex");

// A challenge as the server makes it, hiding the number n
const challengeFor = (action: string, n: number, maxnumber: number) => {
    const salt = crypto.randomBytes(16).toString("hex") + "." + (Date.now() + 600000) + "." + action;
    const challenge = sha256(salt + n);
    return {algorithm: "SHA-256", salt: salt, challenge: challenge, maxnumber: maxnumber,
            signature: crypto.createHmac("sha256", "key").update(salt + ":" + challenge + ":" + maxnumber).digest("hex")};
};

const json = (status: number, body: any): Response =>
    new Response(JSON.stringify(body), {status: status, headers: {"Content-Type": "application/json"}});

// The server's challenges, one per request (a number n, or a ready answer)
const serve = (...answers: (number | Response)[]): string[] => {
    const urls: string[] = [];
    (global as any).fetch = (url: string) => {
        urls.push(url);
        const next = answers.shift();
        if (next === undefined)
            return new Promise(() => {});
        return Promise.resolve(typeof next === "number" ? json(200, challengeFor("login", next, 3000)) : next);
    };
    return urls;
};

const isAnswer = (payload: any): boolean =>
    Object.keys(payload).sort().join(",") === "challenge,maxnumber,number,salt,signature" &&
    sha256(payload.salt + payload.number) === payload.challenge;

const failureOf = (promise: Promise<any>): Promise<any> => promise.then(() => { throw new Error("no failure"); }, error => error);

const tick = () => new Promise(resolve => setTimeout(resolve, 0));


describe("The check that the player is not a robot", () => {

    afterEach(() => {
        (global as any).fetch = realFetch;
        delete (global as any).Worker;
        jest.useRealTimers();
    });

    it("reads the server's challenges, and nothing else", () => {
        const challenge = challengeFor("register", 5, 150000);
        expect(Captcha.parseChallenge({...challenge, extra: true})).toEqual(challenge);

        [null, "challenge", {...challenge, algorithm: "SHA-1"}, {...challenge, salt: ""}, {...challenge, salt: 5},
         {...challenge, challenge: challenge.challenge.toUpperCase()}, {...challenge, challenge: "abc"},
         {...challenge, maxnumber: -1}, {...challenge, maxnumber: 1.5}, {...challenge, maxnumber: 1e12},
         {...challenge, maxnumber: "150000"}, {...challenge, signature: ""}, {...challenge, signature: null}]
            .forEach(data => expect(Captcha.parseChallenge(data)).toBeNull());
    });

    it("finds the number in the page, a slice at a time", async () => {
        const challenge = challengeFor("login", 2999, 3000);
        const tried: number[] = [];

        const number = await new Promise(resolve => Captcha.solveInPage(challenge, (n: number) => tried.push(n), resolve));
        expect(number).toBe(2999);
        tried.forEach((n, i) => expect(n).toBeGreaterThan(i ? tried[i - 1] : 0));
    });

    it("says when no number fits", async () => {
        const challenge = challengeFor("login", 50, 40);
        expect(await new Promise(resolve => Captcha.solveInPage(challenge, () => {}, resolve))).toBe(-1);
    });

    it("can stop looking", async () => {
        const challenge = challengeFor("login", 150000, 150000);
        let found = false;
        const stop = Captcha.solveInPage(challenge, () => {}, () => { found = true; });
        stop();
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(found).toBe(false);
    });

    it("prepares an answer as soon as the form shows", async () => {
        const urls = serve(1234);
        const states: string[] = [];
        const captcha = new Captcha("login", (state: string) => states.push(state));

        captcha.start();
        expect(captcha.state).toBe("solving");
        const payload = await captcha.take();

        expect(urls).toEqual(["/api/captcha?action=login"]);
        expect(isAnswer(payload)).toBe(true);
        expect(payload.number).toBe(1234);
        expect(states[0]).toBe("solving");
        expect(states).toContain("ready");
        expect(states[states.length - 1]).toBe("idle");
    });

    it("gives each answer once, and prepares the next on demand", async () => {
        const urls = serve(1, 2, 3);
        const captcha = new Captcha("register", () => {});

        captcha.start();
        await tick();
        const first = await captcha.take();
        captcha.renew();
        const second = await captcha.take();

        expect([first.number, second.number]).toEqual([1, 2]);
        expect(urls).toEqual(["/api/captcha?action=register", "/api/captcha?action=register"]);
        expect(captcha.state).toBe("idle");
    });

    it("keeps a ready answer while the form is hidden", async () => {
        const urls = serve(7, 8);
        const captcha = new Captcha("forgot", () => {});

        captcha.start();
        await captcha.take();
        captcha.renew();
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(captcha.state).toBe("ready");

        captcha.stop();
        captcha.start();
        expect(captcha.state).toBe("ready");
        expect((await captcha.take()).number).toBe(8);
        expect(urls.length).toBe(2);
        captcha.stop();
    });

    it("stops the work when the form hides", async () => {
        serve(2999);
        const captcha = new Captcha("login", () => {});

        captcha.start();
        const taken = failureOf(captcha.take());
        await tick();
        captcha.stop();

        expect((await taken).code).toBe("cancelled");
        expect(captcha.state).toBe("idle");
    });

    it("reports a server it cannot reach, or a challenge it cannot answer", async () => {
        serve(new Response("down", {status: 502}), json(200, {algorithm: "MD5"}),
              json(200, challengeFor("login", 99, 10)), json(429, {error: {code: "rate_limited"}}));
        const errors: any[] = [];
        const captcha = new Captcha("login", (state: string, detail: any) => { if (state === "error") errors.push(detail); });

        expect((await failureOf(captcha.take())).code).toBe("network");
        expect((await failureOf(captcha.take())).code).toBe("internal");
        expect((await failureOf(captcha.take())).code).toBe("captcha_failed");
        expect((await failureOf(captcha.take())).code).toBe("rate_limited");
        expect(errors.map(error => error.code)).toEqual(["network", "internal", "captcha_failed", "rate_limited"]);
        expect(captcha.state).toBe("error");
    });

    it("replaces an answer before its challenge expires", async () => {
        jest.useFakeTimers();
        const urls = serve(10, 20);
        const captcha = new Captcha("login", () => {});

        captcha.start();
        await jest.advanceTimersByTimeAsync(100);
        expect(captcha.state).toBe("ready");

        await jest.advanceTimersByTimeAsync(Captcha.REFRESH);
        expect(urls.length).toBe(2);
        await jest.advanceTimersByTimeAsync(100);
        expect((await captcha.take()).number).toBe(20);
        captcha.stop();
    });

    it("does not reuse an answer that went stale while the form was hidden", async () => {
        jest.useFakeTimers();
        const urls = serve(30, 40);
        const captcha = new Captcha("login", () => {});

        captcha.start();
        await jest.advanceTimersByTimeAsync(100);
        captcha.stop();
        await jest.advanceTimersByTimeAsync(Captcha.REFRESH);
        expect(urls.length).toBe(1);

        captcha.start();
        expect(captcha.state).toBe("solving");
        await jest.advanceTimersByTimeAsync(100);
        expect((await captcha.take()).number).toBe(40);
        captcha.stop();
    });

    it("refuses an action the server does not know", () => {
        expect(() => new Captcha("delete", () => {})).toThrow();
        expect(Captcha.ACTIONS).toEqual(["register", "login", "forgot"]);
    });
});


describe("The captcha's worker", () => {

    afterEach(() => {
        delete (global as any).self;
    });

    // The worker's script, run as a worker would run it: its messages are collected
    const startWorker = (): {post: (data: any) => void, messages: any[]} => {
        const messages: any[] = [];
        const self: any = {postMessage: (message: any) => messages.push(message)};
        (global as any).self = self;
        jest.isolateModules(() => { require("../src/captchaWorker.js"); });
        return {post: (data: any) => self.onmessage({data: data}), messages: messages};
    };

    it("finds the number, and tells its progress", () => {
        const worker = startWorker();
        const challenge = challengeFor("register", 12345, 20000);

        worker.post({salt: challenge.salt, challenge: challenge.challenge, maxnumber: challenge.maxnumber});
        const last = worker.messages[worker.messages.length - 1];
        expect(last).toEqual({type: "solved", number: 12345});
        expect(worker.messages.slice(0, -1).map(m => m.type)).toEqual(["progress", "progress"]);
        expect(worker.messages[0].tried).toBe(5000);
    });

    it("says when it cannot", () => {
        const worker = startWorker();
        const challenge = challengeFor("register", 12, 10);

        worker.post({salt: challenge.salt, challenge: challenge.challenge, maxnumber: 10});
        worker.post({salt: challenge.salt, challenge: "nope", maxnumber: 10});
        worker.post({salt: challenge.salt, challenge: challenge.challenge, maxnumber: 1e12});
        worker.post(null);
        expect(worker.messages.map(m => m.type)).toEqual(["failed", "failed", "failed", "failed"]);
    });
});


describe("Solving a challenge", () => {

    afterEach(() => {
        delete (global as any).Worker;
    });

    // A Worker whose behaviour is given: it receives the challenge and answers with the given messages
    const fakeWorker = (behaviour: (worker: any, data: any) => void) => {
        const created: any[] = [];
        (global as any).Worker = function(this: any, url: string) {
            this.url = url;
            this.terminated = false;
            this.terminate = () => { this.terminated = true; };
            this.postMessage = (data: any) => setTimeout(() => behaviour(this, data), 0);
            created.push(this);
        };
        return created;
    };

    const solveWith = (challenge: any): Promise<number> =>
        new Promise(resolve => Captcha.solve(challenge, () => {}, resolve));

    it("is done in a worker when the browser has them", async () => {
        const workers = fakeWorker((worker, data) => {
            worker.onmessage({data: {type: "progress", tried: 5000}});
            worker.onmessage({data: {type: "solved", number: data.maxnumber}});
        });

        expect(await solveWith(challengeFor("login", 77, 77))).toBe(77);
        expect(workers.length).toBe(1);
        expect(workers[0].url).toMatch(/^src\/captchaWorker\.js\?v=/);
        expect(workers[0].terminated).toBe(true);
    });

    it("is done in the page when the worker fails", async () => {
        const challenge = challengeFor("login", 1500, 2000);
        fakeWorker(worker => worker.onerror({preventDefault: () => {}}));
        expect(await solveWith(challenge)).toBe(1500);

        // A worker of an older build, which cannot solve
        const workers = fakeWorker(worker => worker.onmessage({data: {type: "unavailable"}}));
        expect(await solveWith(challenge)).toBe(1500);
        expect(workers[0].terminated).toBe(true);

        (global as any).Worker = function() { throw new Error("blocked"); };
        expect(await solveWith(challenge)).toBe(1500);
    });

    it("believes a worker that found no number", async () => {
        const workers = fakeWorker(worker => worker.onmessage({data: {type: "failed"}}));
        expect(await solveWith(challengeFor("login", 50, 40))).toBe(-1);
        expect(workers[0].terminated).toBe(true);
    });

    it("stops the worker when the answer is no longer needed", () => {
        const workers = fakeWorker(() => {});
        const stop = Captcha.solve(challengeFor("login", 1, 10), () => {}, () => {});
        stop();
        expect(workers[0].terminated).toBe(true);
    });
});
