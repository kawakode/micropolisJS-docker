import { GameMap } from "../src/gameMap.js";
import { Neighbours } from "../src/neighbours.js";
import { NeighboursWindow } from "../src/neighboursWindow.js";
import { DIRT } from "../src/tileValues";

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
