import { Router } from "../src/router.js";

const TOKEN = "Gq3bVxRj0yU1_x-8wZ5T2nE7kLmPqRsTuVwXyZ01234";

// The page's address and history, as the browser gives them
const browser = (hash: string) => {
    const replaced: string[] = [];
    return {
        location: {hash: hash, pathname: "/kawacity/", search: "?debug=1"},
        history: {replaceState: (_state: any, _title: string, url: string) => { replaced.push(url); }},
        replaced: replaced
    };
};


describe("The page's address", () => {

    it("names the screens of the emails' links, with their tokens", () => {
        expect(TOKEN.length).toBe(43);
        expect(Router.parse("#/signup/" + TOKEN)).toEqual({name: "signup", token: TOKEN});
        expect(Router.parse("#/reset/" + TOKEN)).toEqual({name: "reset", token: TOKEN});
        expect(Router.parse("#/email/" + TOKEN)).toEqual({name: "email", token: TOKEN});
    });

    it("keeps a damaged token out", () => {
        expect(Router.parse("#/signup/")).toEqual({name: "signup", token: null});
        expect(Router.parse("#/reset/abc")).toEqual({name: "reset", token: null});
        expect(Router.parse("#/email/" + TOKEN + "<script>")).toEqual({name: "email", token: null});
        expect(Router.parse("#/signup/" + TOKEN + "/more")).toEqual({name: "signup", token: null});
        expect(Router.parse("#/reset/" + "a".repeat(300))).toEqual({name: "reset", token: null});
    });

    it("knows the lobby and the scenarios", () => {
        expect(Router.parse("#/lobby")).toEqual({name: "lobby"});
        expect(Router.parse("#/lobby/")).toEqual({name: "lobby"});
        expect(Router.parse("#scenario=dullsville")).toEqual({name: "scenario", id: "dullsville"});
    });

    it("ignores other addresses", () => {
        ["", "#", "#/", "#/lobbyist", "#/unknown/" + TOKEN, "#scenario=", "#scenario=Bad1", "/signup/" + TOKEN]
            .forEach(hash => expect(Router.parse(hash)).toBeNull());
        expect(Router.parse(undefined as any)).toBeNull();
    });

    it("removes a token from the address, and from the history", () => {
        ["#/signup/" + TOKEN, "#/reset/" + TOKEN, "#/email/" + TOKEN, "#/reset/broken"].forEach(hash => {
            const page = browser(hash);
            const route = Router.take(page.location, page.history);
            expect(route && route.name).toBe(hash.split("/")[1]);
            expect(page.replaced).toEqual(["/kawacity/?debug=1"]);
        });
    });

    it("leaves the other addresses as they are", () => {
        ["#/lobby", "#scenario=bern", "", "#anything"].forEach(hash => {
            const page = browser(hash);
            Router.take(page.location, page.history);
            expect(page.replaced).toEqual([]);
        });
        expect(Router.take(browser("#/lobby").location, undefined as any)).toEqual({name: "lobby"});
    });

    it("tells which routes carry a token", () => {
        expect(Router.hasToken({name: "signup", token: TOKEN})).toBe(true);
        expect(Router.hasToken({name: "email", token: null})).toBe(true);
        expect(Router.hasToken({name: "lobby"})).toBe(false);
        expect(Router.hasToken(null)).toBe(false);
    });
});
