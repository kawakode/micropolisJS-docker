// The players' pointers on a shared city's map (see PlayerCursors): what the game sends, how often, and how the
// others' are drawn
import { Placements } from "../src/placements.js";
import { PlayerCursors } from "../src/playerCursors.js";

const C = PlayerCursors as any;


describe("Our pointer, for the other players", () => {

    it("says where it is, the tool held and where a drag started", () => {
        expect(C.message({x: 10, y: 20, anchor: null}, "road")).toEqual({t: "cursor", x: 10, y: 20, tool: "road"});
        expect(C.message({x: 10, y: 20, anchor: {x: 3, y: 4}}, "park"))
            .toEqual({t: "cursor", x: 10, y: 20, tool: "park", ax: 3, ay: 4});
        expect(C.message({x: 0, y: 99, anchor: null}, null)).toEqual({t: "cursor", x: 0, y: 99, tool: null});
    });

    it("says it left the map when it is not over it", () => {
        [null, {x: -1, y: 5, anchor: null}, {x: 120, y: 5, anchor: null}, {x: 5, y: 100, anchor: null},
         {x: 1.5, y: 5, anchor: null}, {x: "1", y: 5, anchor: null}, {x: NaN, y: 5}].forEach(pointer => {
            expect(C.message(pointer, "road")).toEqual({t: "cursor", x: null});
        });

        // A drag that started off the map is not one
        expect(C.message({x: 1, y: 2, anchor: {x: -3, y: 0}}, "road")).toEqual({t: "cursor", x: 1, y: 2, tool: "road"});
    });

    it("is sent as it changes, at most ten times a second, the latest last", () => {
        const sent: any[] = [];
        const sender = new C.Sender((message: any) => { sent.push([message.x, message.y]); return true; });
        expect(C.SEND_INTERVAL).toBe(100);

        // Each frame (60 a second) the pointer moves for 2 s
        for (let frame = 0; frame <= 120; frame++)
            sender.update(C.message({x: frame % 100, y: 1, anchor: null}, "road"), frame * 1000 / 60);
        expect(sent.length).toBeLessThanOrEqual(21);
        expect(sent.length).toBeGreaterThanOrEqual(18);
        for (let i = 1; i < sent.length; i++)
            expect(sent[i]).not.toEqual(sent[i - 1]);

        // Then it stays still: once its latest position went, nothing more
        const count = sent.length;
        for (let frame = 121; frame < 200; frame++)
            sender.update(C.message({x: 50, y: 1, anchor: null}, "road"), frame * 1000 / 60);
        expect(sent.length).toBe(count + 1);
        expect(sent[sent.length - 1]).toEqual([50, 1]);
    });

    it("says nothing until it is first on the map, and says when it leaves", () => {
        const sent: any[] = [];
        const sender = new C.Sender((message: any) => { sent.push(message); return true; });
        expect(sender.update(C.message(null, null), 0)).toBe(false);
        expect(sender.update(C.message({x: 5, y: 5, anchor: null}, null), 1000)).toBe(true);
        expect(sender.update(C.message(null, null), 1200)).toBe(true);
        expect(sent).toEqual([{t: "cursor", x: 5, y: 5, tool: null}, {t: "cursor", x: null}]);
    });

    it("is tried again when it could not be sent, and sent again after reconnecting", () => {
        let up = false;
        const sent: any[] = [];
        const sender = new C.Sender((message: any) => {
            if (up)
                sent.push(message);
            return up;
        });
        const here = C.message({x: 7, y: 8, anchor: null}, "wire");
        expect(sender.update(here, 0)).toBe(false);
        up = true;
        expect(sender.update(here, 16)).toBe(true);
        expect(sender.update(here, 500)).toBe(false);

        sender.reset();
        expect(sender.update(here, 510)).toBe(true);
        expect(sent.length).toBe(2);
    });
});


describe("The other players' pointers", () => {

    it("cover the tiles of the tool they hold", () => {
        expect(C.footprint("road")).toEqual({size: 1, offset: 0});
        expect(C.footprint("query")).toEqual({size: 1, offset: 0});
        expect(C.footprint(null)).toEqual({size: 1, offset: 0});
        expect(C.footprint("__proto__")).toEqual({size: 1, offset: 0});
        expect(C.footprint("residential")).toEqual({size: 3, offset: 1});
        expect(C.footprint("airport")).toEqual({size: 6, offset: 1});
        expect(C.footprint("coal")).toEqual({size: 4, offset: 1});
        // A 2x2 building is placed by the tile one in from its top left, like the bigger ones
        expect(C.footprint("policepost")).toEqual({size: 2, offset: 1});
        expect(C.footprint("bulldozer5")).toEqual({size: 5, offset: 2});
        Placements.TOOL_NAMES.forEach((tool: string) => {
            const size = Math.max(Placements.sizeOf(tool), Placements.brushOf(tool));
            expect(C.footprint(tool).size).toBe(size);
        });
    });

    it("are drawn as outlines in the player's colour, around the tool or the drag, on the map", () => {
        const outline = (entry: any[], colour = "#e6194b") => C.outline(entry, colour);

        expect(outline([10, 20, "road"])).toEqual({x: 10, y: 20, width: 1, height: 1, colour: "#e6194b", outline: true});
        expect(outline([10, 20, "residential"])).toEqual({x: 9, y: 19, width: 3, height: 3, colour: "#e6194b",
                                                          outline: true});
        // A drag, either way round
        expect(outline([10, 20, "road", 4, 25])).toEqual({x: 4, y: 20, width: 7, height: 6, colour: "#e6194b",
                                                          outline: true});
        expect(outline([2, 3, "bulldozer3", 6, 1])).toEqual({x: 1, y: 0, width: 7, height: 5, colour: "#e6194b",
                                                             outline: true});
        // Clipped to the map
        expect(outline([0, 0, "airport"])).toEqual({x: 0, y: 0, width: 5, height: 5, colour: "#e6194b", outline: true});
        expect(outline([119, 99, "stadium"])).toEqual({x: 118, y: 98, width: 2, height: 2, colour: "#e6194b",
                                                       outline: true});

        // Off the map, or not a colour
        expect(outline([120, 5, "road"])).toBe(null);
        expect(outline([5, 5, "road"], "red; background: url(x)").colour).toBe(C.DEFAULT_COLOUR);
        expect(C.outline([5, 5, "road"], undefined).colour).toBe(C.DEFAULT_COLOUR);
    });

    it("follow the cursors messages, and leave with their players", () => {
        const pointers = new C.Pointers();
        expect(pointers.receive([["bob", 10, 10, "road", null, null], ["carol", 5, 6, "park", 1, 2], ["me", 1, 1, null]]))
            .toBe(3);
        expect(pointers.get("bob")).toEqual([10, 10, "road"]);
        expect(pointers.get("carol")).toEqual([5, 6, "park", 1, 2]);

        const colours = {bob: "#3cb44b", carol: "#4363d8", me: "#ffe119"};
        const rects = pointers.outlines(colours, "me");
        expect(rects.map((r: any) => r.colour)).toEqual(["#3cb44b", "#4363d8"]);

        // Each message lists every pointer on the map: those not in it left (or say x null); what is not one is skipped
        expect(pointers.receive([["bob", null], ["", 1, 1], [7, 1, 1], "x", ["carol", 6, 6, "park"],
                                 ["dave", 6, 120, null], ["eve", 2, 2, 5, -1, 3]])).toBe(2);
        expect(pointers.get("bob")).toBe(null);
        expect(pointers.get("me")).toBe(null);
        expect(pointers.get("dave")).toBe(null);
        expect(pointers.get("carol")).toEqual([6, 6, "park"]);
        expect(pointers.get("eve")).toEqual([2, 2, null]);
        expect(pointers.receive("nothing")).toBe(0);
        expect(pointers.get("carol")).toEqual([6, 6, "park"]);
        expect(pointers.receive([])).toBe(0);
        expect(pointers.get("carol")).toBe(null);

        // Players who went offline
        pointers.receive([["bob", 3, 3, null], ["carol", 4, 4, "road"]]);
        pointers.keep(["bob", "me"]);
        expect(pointers.get("carol")).toBe(null);
        expect(pointers.get("bob")).toEqual([3, 3, null]);
        pointers.clear();
        expect(pointers.outlines(colours, "me")).toEqual([]);
    });
});
