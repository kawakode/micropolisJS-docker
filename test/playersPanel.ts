// The players panel of a shared city (see PlayersPanel): what it keeps of the server's and players' texts, and that
// it puts them in the page as text, never as HTML. jQuery is replaced by a small page of its own, written out as HTML
// (escaped as a browser would) to see what the panel made.
jest.mock("jquery", () => {
    class FakeNode {
        tag: string;
        attrs: Record<string, string> = {};
        classes: string[] = [];
        style: Record<string, string> = {};
        children: FakeNode[] = [];
        text: string | null = null;
        parent: FakeNode | null = null;
        handlers: Record<string, ((e: any) => void)[]> = {};
        value = "";
        props: Record<string, any> = {};
        scrollTop = 0;
        scrollHeight = 500;
        focused = false;

        constructor(tag: string) {
            this.tag = tag;
        }

        textContent(): string {
            return this.text !== null ? this.text : this.children.map(child => child.textContent()).join("");
        }
    }

    const byId = new Map<string, FakeNode>();

    class Wrapper {
        [index: number]: FakeNode;
        length: number;

        constructor(public nodes: FakeNode[]) {
            this.length = nodes.length;
            nodes.forEach((node, i) => { this[i] = node; });
        }

        each(fn: (node: FakeNode) => void) { this.nodes.forEach(fn); return this; }
        on(event: string, handler: (e: any) => void) {
            return this.each(n => { (n.handlers[event.split(".")[0]] ||= []).push(handler); });
        }
        trigger(event: string) {
            return this.each(n => {
                if (event === "focus")
                    n.focused = true;
                (n.handlers[event] || []).forEach(h => h({preventDefault: () => undefined, stopPropagation: () => undefined}));
            });
        }
        addClass(c: string) { return this.each(n => { c.split(" ").forEach(k => { if (!n.classes.includes(k)) n.classes.push(k); }); }); }
        removeClass(c: string) { return this.each(n => { n.classes = n.classes.filter(k => !c.split(" ").includes(k)); }); }
        toggleClass(c: string, on: boolean) { return on ? this.addClass(c) : this.removeClass(c); }
        hasClass(c: string) { return this.nodes.some(n => n.classes.includes(c)); }
        attr(name: any, value?: any): any {
            if (typeof name === "object")
                return this.each(n => Object.keys(name).forEach(k => { n.attrs[k] = String(name[k]); }));
            if (value === undefined)
                return this.nodes.length ? this.nodes[0].attrs[name] : undefined;
            return this.each(n => { n.attrs[name] = String(value); });
        }
        prop(name: string, value?: any): any {
            if (value === undefined)
                return this.nodes.length ? this.nodes[0].props[name] : undefined;
            return this.each(n => { n.props[name] = value; });
        }
        text(value?: any): any {
            if (value === undefined)
                return this.nodes.map(n => n.textContent()).join("");
            return this.each(n => { n.children = []; n.text = String(value); });
        }
        css(name: string, value: string) { return this.each(n => { n.style[name] = value; }); }
        val(value?: string): any {
            if (value === undefined)
                return this.nodes.length ? this.nodes[0].value : undefined;
            return this.each(n => { n.value = value; });
        }
        append(child: Wrapper) {
            const parent = this.nodes[0];
            child.nodes.forEach(c => { c.parent = parent; parent.text = null; parent.children.push(c); });
            return this;
        }
        appendTo(parent: Wrapper) { parent.append(this); return this; }
        empty() { return this.each(n => { n.children = []; n.text = null; }); }
        children() { return new Wrapper(this.nodes.flatMap(n => n.children)); }
        first() { return new Wrapper(this.nodes.slice(0, 1)); }
        remove() {
            return this.each(n => {
                if (n.parent)
                    n.parent.children = n.parent.children.filter(c => c !== n);
                n.parent = null;
            });
        }
        find(selector: string) {
            const found: FakeNode[] = [];
            const visit = (n: FakeNode) => n.children.forEach(c => {
                if (selector === ":focus" ? c.focused : c.tag === selector)
                    found.push(c);
                visit(c);
            });
            this.nodes.forEach(visit);
            return new Wrapper(found);
        }
    }

    const ATTRIBUTE = /\s+([\w-]+)="([^"]*)"/g;
    const $: any = (selector: string) => {
        const element = /^<(\w+)((?:\s+[\w-]+="[^"]*")*)><\/\1>$/.exec(selector);
        if (element) {
            const node = new FakeNode(element[1]);
            let attribute;
            while ((attribute = ATTRIBUTE.exec(element[2])) !== null) {
                if (attribute[1] === "class")
                    node.classes = attribute[2].split(" ");
                else
                    node.attrs[attribute[1]] = attribute[2];
            }
            return new Wrapper([node]);
        }

        if (/^#\w+$/.test(selector)) {
            const id = selector.slice(1);
            if (!byId.has(id)) {
                const node = new FakeNode("div");
                node.attrs.id = id;
                byId.set(id, node);
            }
            return new Wrapper([byId.get(id)!]);
        }

        throw new Error("The fake page does not know " + selector);
    };

    // The page as HTML, escaped as a browser writes it out
    const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escapeAttribute = (text: string) => escape(text).replace(/"/g, "&quot;");
    const html = (n: FakeNode): string => {
        const attrs = Object.keys(n.attrs).map(k => " " + k + "=\"" + escapeAttribute(n.attrs[k]) + "\"").join("") +
                      (n.classes.length ? " class=\"" + escapeAttribute(n.classes.join(" ")) + "\"" : "") +
                      (Object.keys(n.style).length ? " style=\"" + escapeAttribute(Object.keys(n.style)
                          .map(k => k + ": " + n.style[k]).join("; ")) + "\"" : "");
        const inside = n.text !== null ? escape(n.text) : n.children.map(html).join("");
        return "<" + n.tag + attrs + ">" + inside + "</" + n.tag + ">";
    };

    $.page = {byId, html, reset: () => byId.clear()};
    return {__esModule: true, default: $};
});

import { I18n } from "../src/i18n.js";
import { PlayersPanel } from "../src/playersPanel.js";

const P = PlayersPanel as any;
const $: any = (jest.requireMock("jquery") as any).default;
const page = $.page;
const html = (id: string) => page.html(page.byId.get(id));
const node = (id: string) => page.byId.get(id);

// The panel's elements, as in index.html (the panel starts closed)
const makePanel = (onSend: (text: string) => boolean = () => true) => {
    page.reset();
    $("#playersPanel").addClass("panel playersPanel hidden");
    $("#playersUnread").addClass("unreadBadge hidden");
    $("#playersPanel").append($("#chatForm").append($("#chatInput")));
    const backs: number[] = [];
    const panel = new P(onSend, () => backs.push(1));
    return {panel, backs};
};

const chat = (id: string, username: string, text: string, at = 1000, colour = "#3cb44b") =>
    ({t: "chat", from: {id, username, colour}, text, at});

const keydown = (key: string) => {
    const event = {key, prevented: false, stopped: false,
                   preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }};
    node("playersPanel").handlers.keydown.forEach((handler: any) => handler(event));
    return event;
};


describe("The chat of a shared city", () => {

    afterEach(() => {
        I18n.setLanguage("en", false);
    });

    it("sends messages as the server takes them", () => {
        expect(P.MAX_CHAT).toBe(300);
        expect(P.cleanChat("  hello  ")).toBe("hello");
        expect(P.cleanChat("e\u0301t\u00e9")).toBe("\u00e9t\u00e9");
        expect(P.cleanChat("a\u0000b\u0007c\u001bd\u007fe\u0085f")).toBe("abcdef");
        expect(P.cleanChat("left\u202eright\u2066x\u200by\ufeffz\u00adw")).toBe("leftrightxyzw");
        expect(P.cleanChat("line\none\ttwo")).toBe("lineonetwo");
        expect(P.cleanChat(" \u200b\n ")).toBe("");
        [null, undefined, 42, {}, ["hi"]].forEach(value => expect(P.cleanChat(value)).toBe(""));

        // At most 300 characters, an emoji counting as one
        expect(Array.from(P.cleanChat("\ud83c\udfd9".repeat(301))).length).toBe(300);
        expect(P.cleanChat("x".repeat(299) + " y")).toBe("x".repeat(299));
        expect(P.cleanChat("<b>&amp;</b>")).toBe("<b>&amp;</b>");
    });

    it("keeps only well-formed messages and players", () => {
        expect(P.chatEntry(chat("bob", "bob", "hi"))).toEqual({id: "bob", username: "bob", colour: "#3cb44b", text: "hi",
                                                                at: 1000});
        expect(P.chatEntry({from: {id: "bob", username: "bob"}, text: "hi"}))
            .toEqual({id: "bob", username: "bob", colour: "#f8f8ff", text: "hi", at: null});
        expect(P.chatEntry(chat("bob", "bob", "hi", 1, "red; background: url(x)")).colour).toBe("#f8f8ff");
        expect(P.chatEntry(chat("bob", "b\u202eob", "hi")).username).toBe("bob");
        [null, {}, {from: null, text: "x"}, {from: {id: 1, username: "a"}, text: "x"}, chat("a", "", "x"),
         chat("a", "a", ""), chat("a", "a", 5 as any), chat("a", "a", "\u0000")].forEach(message => {
            expect(P.chatEntry(message)).toBe(null);
        });

        expect(P.player({id: "a", username: "alice", role: "owner", colour: "#E6194B", online: true}))
            .toEqual({id: "a", username: "alice", role: "owner", colour: "#e6194b", online: true});
        expect(P.player({id: "a", username: "alice", role: "admin", colour: "x", online: 1}))
            .toEqual({id: "a", username: "alice", role: "viewer", colour: "#f8f8ff", online: false});
        expect(P.player({id: "", username: "alice"})).toBe(null);
        expect(P.player({id: "a", username: "\u200b"})).toBe(null);
        expect(P.cleanName("x".repeat(100)).length).toBe(40);
    });

    it("cuts a translated sentence around its values, so that each goes in an element of its own", () => {
        expect(P.parts("{name}: {message}", {name: "<b>bob</b>", message: "{name}"}))
            .toEqual([{key: "name", value: "<b>bob</b>"}, {text: ": "}, {key: "message", value: "{name}"}]);
        expect(P.parts("{name} a rejoint la ville.", {name: "bob"})).toEqual([{key: "name", value: "bob"},
                                                                              {text: " a rejoint la ville."}]);
        expect(P.parts("Hello {who} and {name}", {name: "x"})).toEqual([{text: "Hello "}, {text: "{who}"},
                                                                        {text: " and "}, {key: "name", value: "x"}]);
        expect(P.parts("{toString}", {name: "x"})).toEqual([{text: "{toString}"}]);
    });

    it("shows messages and names as text, names in <bdi>", () => {
        const {panel} = makePanel();
        panel.setPlayers([], "me");
        panel.addChat(chat("bob", "<img src=x onerror=alert(1)>", "<script>alert(\"x\")</script> & co", 0,
                           "#3cb44b\" onclick=\"x"));
        const log = html("chatLog");
        expect(log).not.toContain("<script");
        expect(log).not.toContain("<img");
        expect(log).toContain("&lt;script&gt;alert(\"x\")&lt;/script&gt; &amp; co");
        expect(log).toContain("<bdi class=\"chatName\" style=\"color: #f8f8ff\">&lt;img src=x onerror=alert(1)&gt;</bdi>");
        expect(log).toMatch(/<span class="chatTime">\d\d:\d\d<\/span>/);

        // The same in French: the sentence's own spaces and punctuation, the values untouched
        I18n.setLanguage("fr", false);
        panel.addChat(chat("bob", "bob", "salut : ça va ?"));
        expect(node("chatLog").children[1].textContent()).toMatch(/^\d\d:\d\dbob\u00a0: salut : ça va \?$/);
    });

    it("lists the players with their role, colour and whether they are online", () => {
        const {panel} = makePanel();
        panel.setPlayers([{id: "me", username: "alice", role: "owner", colour: "#e6194b", online: true},
                          {id: "b", username: "</li><li>bob", role: "player", colour: "url(x)", online: false},
                          {id: "c", username: "carol", role: "viewer", colour: "#4363d8", online: true},
                          {id: 5, username: "nobody"}], "me");
        const list = html("playersList");
        expect(node("playersList").children.length).toBe(3);
        expect(list).toContain("<bdi>alice</bdi><span class=\"playerYou\"> (you)</span>");
        expect(list).toContain("<bdi>&lt;/li&gt;&lt;li&gt;bob</bdi>");
        expect(list).toContain("style=\"background-color: #f8f8ff\"");
        expect(list).toContain("class=\"playerItem offline\"");
        expect(node("playersList").children.map((item: any) => item.textContent()))
            .toEqual(["alice (you)Owneronline", "</li><li>bobPlayeroffline", "carolViewer online".replace(" ", "")]);
    });

    it("counts the others' messages that arrive while it is closed", () => {
        const {panel} = makePanel();
        panel.setStatus("online");
        panel.setPlayers([], "me");
        panel.addChat(chat("me", "alice", "mine"));
        expect(panel.unread()).toBe(0);
        expect(node("playersUnread").classes).toContain("hidden");
        expect(node("playersRequest").attrs["aria-label"]).toBe("Players \u2014 Connected");

        panel.addChat(chat("bob", "bob", "one"));
        expect(node("playersUnread").text).toBe("1");
        expect(node("playersUnread").classes).not.toContain("hidden");
        expect(node("playersRequest").attrs["aria-label"]).toBe("Players (1 new message) \u2014 Connected");
        panel.addChat(chat("bob", "bob", "two"));
        expect(node("playersRequest").attrs.title).toBe("Players (2 new messages) \u2014 Connected");
        for (let i = 0; i < 120; i++)
            panel.addChat(chat("bob", "bob", "more"));
        expect(node("playersUnread").text).toBe("99+");

        panel.open();
        expect(panel.isOpen()).toBe(true);
        expect(panel.unread()).toBe(0);
        expect(node("chatInput").focused).toBe(true);
        expect(node("playersRequest").attrs["aria-expanded"]).toBe("true");
        panel.addChat(chat("bob", "bob", "seen"));
        expect(panel.unread()).toBe(0);
    });

    it("keeps the latest lines only", () => {
        const {panel} = makePanel();
        for (let i = 0; i < 250; i++)
            panel.addChat(chat("bob", "bob", "line " + i));
        const lines = node("chatLog").children;
        expect(lines.length).toBe(P.LOG_LIMIT);
        expect(lines[0].textContent()).toContain("line 50");
        expect(lines[lines.length - 1].textContent()).toContain("line 249");
        expect(node("chatLog").scrollTop).toBe(node("chatLog").scrollHeight);
    });

    it("starts again with each welcome's chat, counting only what is new", () => {
        const {panel} = makePanel();
        panel.setChat([chat("bob", "bob", "old", 100), chat("me", "alice", "mine", 200)], "me");
        expect(node("chatLog").children.length).toBe(2);
        expect(panel.unread()).toBe(0);

        // After reconnecting: the same messages, and what was said meanwhile
        panel.setChat([chat("bob", "bob", "old", 100), chat("me", "alice", "mine", 200), chat("bob", "bob", "new", 300),
                       chat("me", "alice", "mine too", 400), {broken: true}], "me");
        expect(node("chatLog").children.length).toBe(4);
        expect(panel.unread()).toBe(1);
    });

    it("tells who came and who left, the name in <bdi>", () => {
        const {panel} = makePanel();
        panel.addNotice(I18n.t("{name} joined the city."), "<i>bob</i>");
        expect(html("chatLog")).toBe("<div id=\"chatLog\"><p class=\"chatLine chatNotice\"><bdi>&lt;i&gt;bob&lt;/i&gt;</bdi>" +
                                     "<span> joined the city.</span></p></div>");
    });

    it("sends what is typed, and empties the field once it went", () => {
        const sent: string[] = [];
        let accept = true;
        makePanel(text => { sent.push(text); return accept; });
        const input = $("#chatInput");

        input.val("  hello\u0000 ");
        $("#chatForm").trigger("submit");
        expect(sent).toEqual(["hello"]);
        expect(input.val()).toBe("");

        input.val(" \u200b ");
        $("#chatForm").trigger("submit");
        expect(sent.length).toBe(1);

        accept = false;
        input.val("not sent");
        $("#chatForm").trigger("submit");
        expect(sent).toEqual(["hello", "not sent"]);
        expect(input.val()).toBe("not sent");
    });

    it("closes with Escape, and keeps the game's keys from the map while it has the focus", () => {
        const {panel, backs} = makePanel();
        panel.show();
        expect(node("playersRequest").classes).not.toContain("hidden");
        panel.open();
        node("chatInput").focused = true;

        const letter = keydown("4");
        expect([letter.stopped, letter.prevented, panel.isOpen()]).toEqual([true, false, true]);
        const space = keydown(" ");
        expect(space.stopped).toBe(true);

        node("playersRequest").focused = false;
        const escape = keydown("Escape");
        expect([escape.stopped, escape.prevented, panel.isOpen()]).toEqual([true, true, false]);
        expect(node("playersRequest").focused).toBe(true);
        expect(node("playersRequest").attrs["aria-expanded"]).toBe("false");

        $("#playersRequest").trigger("click");
        expect(panel.isOpen()).toBe(true);
        $("#playersClose").trigger("click");
        expect(panel.isOpen()).toBe(false);
        $("#backToLobby").trigger("click");
        expect(backs).toEqual([1]);
    });

    it("says how the connection is, and what the role allows, in each language", () => {
        const {panel} = makePanel();
        panel.setStatus("reconnecting");
        panel.setRole("viewer");
        expect(node("playersStatus").text).toBe("Reconnecting\u2026");
        expect(node("playersConnection").attrs["data-status"]).toBe("reconnecting");
        expect(node("playersRequest").attrs["data-status"]).toBe("reconnecting");
        expect(node("playersRole").text).toContain("You are watching this city");

        I18n.setLanguage("fr", false);
        panel.setRole("player");
        panel.setStatus("nonsense");
        panel.translate();
        expect(node("playersStatus").text).toBe("Connexion\u2026");
        expect(node("playersRole").text).toBe("Votre r\u00f4le\u00a0: Joueur");
        expect(["owner", "player", "viewer", "admin"].map(role => P.roleText(role)))
            .toEqual(["Propri\u00e9taire", "Joueur", "Spectateur", "Spectateur"]);
        expect(["online", "reconnecting", "offline", "connecting"].map(status => P.statusText(status)))
            .toEqual(["Connect\u00e9", "Reconnexion\u2026", "D\u00e9connect\u00e9", "Connexion\u2026"]);
    });
});
