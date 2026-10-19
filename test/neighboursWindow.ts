import { GameMap } from "../src/gameMap.js";
import { I18n } from "../src/i18n.js";
import { Neighbours } from "../src/neighbours.js";
import { NeighboursWindow } from "../src/neighboursWindow.js";
import { BULLBIT, BURNBIT, CONDBIT } from "../src/tileFlags";
import { DIRT, LHPOWER, ROADS } from "../src/tileValues";

// The window's cards for neighbours as Neighbours.describe gives them, without the page
const makeWindow = (neighbours: any[]): any => {
    const neighboursWindow = Object.create((NeighboursWindow as any).prototype);
    neighboursWindow._neighbours = neighbours;
    neighboursWindow._draft = {};
    neighbours.forEach(n => {
        neighboursWindow._draft[n.side] = {};
        n.deals.forEach((deal: any) => { neighboursWindow._draft[n.side][deal.kind] = deal.signed; });
    });
    neighboursWindow._picture = () => "<span class=\"pixelIcon\"></span>";
    return neighboursWindow;
};

// Neighbours read from a save whose first neighbour has the given name
const describeWithName = (name: string): any[] => {
    const saveData: any = {};
    const neighbours = new (Neighbours as any)(new (GameMap as any)(30, 20, DIRT), () => 0.5);
    neighbours.generate();
    neighbours.save(saveData);
    saveData.neighbours[0].name = name;
    neighbours.load(saveData);
    return neighbours.describe();
};

// The attributes of an HTML start tag, in order
const attributesOf = (tag: string): string[] => {
    const names: string[] = [];
    const attribute = /\s([^\s"'>\/=]+)(?:="([^"]*)")?/g;
    let match;
    while ((match = attribute.exec(tag)) !== null)
        names.push(match[1]);
    return names;
};


describe("The neighbours window", () => {

    it("escapes every character that could end a text or an attribute", () => {
        expect((NeighboursWindow as any).escape("<b title=\"it's\">R&D</b>"))
            .toBe("&lt;b title=&quot;it&#39;s&quot;&gt;R&amp;D&lt;/b&gt;");
        expect((NeighboursWindow as any).escape(42)).toBe("42");
    });

    it("keeps a neighbour's name inside its attribute", () => {
        const html = makeWindow(describeWithName("a\" onmouseover=\"x"))._cards().html;
        const sections = html.match(/<section[^>]*>/g) || [];

        expect(sections.length).toBe(4);
        expect(sections[0]).toBe("<section class=\"neighbour\" aria-label=\"a&quot; onmouseover=&quot;x\">");
        sections.forEach((section: string) => expect(attributesOf(section)).toEqual(["class", "aria-label"]));
        expect(html).toContain("<span class=\"neighbourName\">a&quot; onmouseover=&quot;x</span>");
        expect(html).not.toContain("onmouseover=\"");
    });

    it("shows a neighbour's name as text, not as markup", () => {
        const html = makeWindow(describeWithName("<img src=x onerror='y'>"))._cards().html;

        expect(html).not.toContain("<img");
        expect(html).toContain("aria-label=\"&lt;img src=x onerror=&#39;y&#39;&gt;\"");
    });

    it("adds up the deals that would be in force", () => {
        const neighbours = describeWithName("Fairport");
        const neighboursWindow = makeWindow(neighbours);
        neighboursWindow._draft[neighbours[0].side].twinning = true;

        const twinning = neighbours[0].deals.filter((deal: any) => deal.kind === "twinning")[0];
        expect(neighboursWindow._cards().balance).toBe(twinning.yearly);
    });
});


// Neighbours whose northern one is a player's city, which signed the given deals and has the given links at its edge,
// this city having signed the deals given and having a road and a power line to its north edge
const describeWithPlayer = (theirs: string[], links: any, ours: string[], owner = "bob"): any[] => {
    const map = new (GameMap as any)(30, 20, DIRT);
    map.setTile(3, 0, ROADS, BULLBIT | BURNBIT);
    map.setTile(5, 0, LHPOWER, CONDBIT | BURNBIT | BULLBIT);
    const neighbours = new (Neighbours as any)(map, () => 0.5);
    neighbours.generate();
    const signed: any = {};
    (Neighbours as any).KINDS.forEach((kind: string) => { signed[kind] = theirs.indexOf(kind) !== -1; });
    neighbours.setRemote("north", {cityId: "c", name: "Lyon", ownerName: owner, population: 120000,
                                   edge: Object.assign({transport: false, power: false, powerOut: false, signed: signed}, links)});
    ours.forEach(kind => neighbours.setDeal("north", kind, true));
    return neighbours.describe();
};

// What the card says about a deal: [class, text], or null
const dealState = (html: string, side: string, kind: string): any => {
    const deal = html.split("<li").filter(item => item.indexOf("id=\"deal-" + side + "-" + kind + "\"") !== -1)[0];
    const state = deal.match(/<p class="dealState ([a-z]+)">([^<]*)<\/p>/);
    return state ? [state[1], state[2]] : null;
};


describe("The neighbours window, with another player's city", () => {

    afterEach(() => {
        I18n.setLanguage("en", false);
    });

    it("names the city's mayor", () => {
        const html = makeWindow(describeWithPlayer([], {}, []))._cards().html;
        const sections = html.split("<section").slice(1);

        expect(sections[0]).toContain("<span class=\"neighbourName\">Lyon</span><span class=\"neighbourOwner\">Mayor: bob</span>");
        expect(sections[0]).toContain("aria-label=\"Lyon\"");
        expect(sections[0]).toContain("120,000 inhabitants");
        sections.slice(1).forEach((section: string) => expect(section).not.toContain("neighbourOwner"));
    });

    it("shows the deals that city offers", () => {
        const neighbours = describeWithPlayer(["trade", "sellPower"], {transport: true, power: true}, []);
        const neighboursWindow = makeWindow(neighbours);
        const html = neighboursWindow._cards().html;

        expect(dealState(html, "north", "trade")).toEqual(["offer", "bob offers this deal: tick it to accept."]);
        expect(dealState(html, "north", "buyPower")).toEqual(["offer", "bob offers this deal: tick it to accept."]);
        expect(dealState(html, "north", "sellPower")).toBeNull();
        expect(dealState(html, "north", "twinning")).toBeNull();
        expect(neighboursWindow._cards().balance).toBe(0);

        // Ticking it puts it in force
        neighboursWindow._draft.north.trade = true;
        const trade = neighbours[0].deals.filter((deal: any) => deal.kind === "trade")[0];
        expect(dealState(neighboursWindow._cards().html, "north", "trade")).toEqual(["good", "In force"]);
        expect(neighboursWindow._cards().balance).toBe(trade.yearly);
    });

    it("tells what a deal signed waits for", () => {
        let html = makeWindow(describeWithPlayer([], {transport: true}, ["twinning"]))._cards().html;
        expect(dealState(html, "north", "twinning")).toEqual(["warning", "Proposed: waiting for bob to sign it too."]);

        html = makeWindow(describeWithPlayer(["trade", "buyPower"], {}, ["trade", "sellPower"]))._cards().html;
        expect(dealState(html, "north", "trade")).toEqual(["warning", "On hold: bob has no road or railway at this edge yet."]);
        expect(dealState(html, "north", "sellPower")).toEqual(["warning", "On hold: bob has no power line at this edge yet."]);

        html = makeWindow(describeWithPlayer(["sellPower"], {power: true}, ["buyPower"]))._cards().html;
        expect(dealState(html, "north", "buyPower")).toEqual(["warning", "Not delivered: bob has no power to spare at this edge."]);

        html = makeWindow(describeWithPlayer(["sellPower"], {power: true, powerOut: true}, ["buyPower"]))._cards().html;
        expect(dealState(html, "north", "buyPower")).toEqual(["good", "In force"]);

        // A deal ended in the window waits for nothing
        const neighboursWindow = makeWindow(describeWithPlayer([], {}, ["twinning"]));
        neighboursWindow._draft.north.twinning = false;
        expect(dealState(neighboursWindow._cards().html, "north", "twinning")).toBeNull();
    });

    it("counts only the deals in force", () => {
        const neighbours = describeWithPlayer(["twinning"], {}, ["trade", "twinning"]);
        const twinning = neighbours[0].deals.filter((deal: any) => deal.kind === "twinning")[0];
        expect(makeWindow(neighbours)._cards().balance).toBe(twinning.yearly);
    });

    it("keeps the mayor's name as text", () => {
        const html = makeWindow(describeWithPlayer(["trade"], {transport: true}, [], "<b>\"x'"))._cards().html;
        expect(html).toContain("Mayor: &lt;b&gt;&quot;x&#39;");
        expect(html).toContain("&lt;b&gt;&quot;x&#39; offers this deal");
        expect(html).not.toContain("<b>");
    });

    it("speaks French", () => {
        I18n.setLanguage("fr", false);
        const html = makeWindow(describeWithPlayer(["trade"], {transport: true}, ["twinning"]))._cards().html;
        expect(html).toContain("Maire\u00a0: bob");
        expect(dealState(html, "north", "trade")[1]).toBe("bob propose cet accord\u00a0: cochez-le pour l&#39;accepter.");
        expect(dealState(html, "north", "twinning")[1]).toBe("Proposé\u00a0: en attente de la signature de bob.");
    });
});
