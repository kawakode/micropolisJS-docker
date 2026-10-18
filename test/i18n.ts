import * as fs from "fs";
import * as path from "path";

import { ERROR_TEXTS, FIELD_TEXTS, KICK_TEXTS, TOOL_TEXTS } from "../src/apiErrors.js";
import { EMAIL_TEXTS } from "../src/emailTexts.js";
import { I18n } from "../src/i18n.js";
import { Scenarios } from "../src/scenarios.js";
import { Text } from "../src/text.js";
import { Toolbar } from "../src/toolbar.js";

const French = (I18n as any).dictionaries.fr;

// The texts whose translation is HTML (data-i18n-html): their keys are names, not English texts
const HTML_KEYS = ["credits", "saveFile"];

// The literal texts the code passes to I18n.t: the first argument's literals, except those given to another function
// ($('.selector'), attr('data-label')...), compared (tab === 'cities') or only a prefix ('legend|' + ...)
const literalsPassedToT = (source: string): string[] => {
    const found: string[] = [];
    const call = /I18n\.t\(/g;
    let match;

    while ((match = call.exec(source)) !== null) {
        let depth = 1;
        let i = match.index + match[0].length;
        const callParens: boolean[] = [false];

        while (depth > 0 && i < source.length) {
            const c = source[i];
            if (c === "'") {
                let j = i + 1;
                while (source[j] !== "'")
                    j += source[j] === "\\" ? 2 : 1;
                const literal = source.slice(i + 1, j).replace(/\\'/g, "'");
                const before = source.slice(match.index, i).replace(/\s+$/, "");
                const after = source.slice(j + 1).replace(/^\s+/, "");
                const argumentOfCall = before.endsWith("(") && callParens[callParens.length - 1] && before.length > "I18n.t(".length;
                const compared = /(===|!==)$/.test(before) || /^(===|!==)/.test(after);
                if (!argumentOfCall && !compared && !literal.endsWith("|"))
                    found.push(literal);
                i = j + 1;
                continue;
            }

            if (c === "(") {
                depth++;
                callParens.push(/[\w$]$/.test(source.slice(0, i)));
            } else if (c === ")") {
                depth--;
                callParens.pop();
            } else if (c === "," && depth === 1) {
                // The parameters follow
                break;
            }
            i++;
        }
    }

    return found;
};


// The page, read the way I18n.translateDocument reads it, without a browser
const ENTITIES: {[name: string]: string} = {amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0",
                                            hellip: "\u2026", middot: "\u00b7", minus: "\u2212", mdash: "\u2014",
                                            ndash: "\u2013", times: "\u00d7", copy: "\u00a9"};

const decode = (text: string): string => text.replace(/&(#x[0-9a-f]+|#[0-9]+|\w+);/gi, (entity, name) => {
    if (name[0] === "#")
        return String.fromCharCode(/^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
    if (ENTITIES[name] === undefined)
        throw new Error("Unknown entity in index.html: " + entity);
    return ENTITIES[name];
});

const START_TAG = /<([a-zA-Z][\w-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

interface PageElement {
    name: string;
    attributes: {[name: string]: string};
    // Where its content starts
    contentStart: number;
}

const readElements = (html: string): PageElement[] => {
    const elements: PageElement[] = [];
    let tag;
    START_TAG.lastIndex = 0;
    while ((tag = START_TAG.exec(html)) !== null) {
        const attributes: {[name: string]: string} = {};
        let attribute;
        ATTRIBUTE.lastIndex = 0;
        while ((attribute = ATTRIBUTE.exec(tag[2])) !== null) {
            const value = attribute[2] !== undefined ? attribute[2] : attribute[3] !== undefined ? attribute[3] :
                          attribute[4] || "";
            attributes[attribute[1].toLowerCase()] = decode(value);
        }
        elements.push({name: tag[1].toLowerCase(), attributes: attributes, contentStart: tag.index + tag[0].length});
    }
    return elements;
};

// The text of an element, as its textContent: everything up to its end tag, without the tags
const textContent = (html: string, element: PageElement): string => {
    const tags = new RegExp("<(/?)" + element.name + "(?=[\\s/>])[^>]*>", "gi");
    tags.lastIndex = element.contentStart;
    let depth = 1;
    let tag;
    while ((tag = tags.exec(html)) !== null) {
        depth += tag[1] ? -1 : 1;
        if (depth === 0)
            return decode(html.slice(element.contentStart, tag.index).replace(START_TAG, "").replace(/<\/[^>]*>/g, ""));
    }
    throw new Error("No end tag in index.html for <" + element.name + "> " + JSON.stringify(element.attributes));
};

const normalise = (text: string): string => text.replace(/\s+/g, " ").trim();

// The keys of the texts of the page: [{marker, key}], marker being the attribute that asks for the translation
const pageTexts = (): {marker: string, key: string}[] => {
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<%[\s\S]*?%>/g, "");
    const texts: {marker: string, key: string}[] = [];

    readElements(html).forEach(element => {
        Object.keys(element.attributes).filter(name => /^data-i18n(-|$)/.test(name)).forEach(marker => {
            const value = element.attributes[marker];
            if (marker === "data-i18n")
                texts.push({marker: marker, key: value || normalise(textContent(html, element))});
            else if (marker === "data-i18n-html")
                texts.push({marker: marker, key: value});
            else
                texts.push({marker: marker, key: value || element.attributes[marker.slice("data-i18n-".length)] || ""});
        });
    });

    return texts;
};


describe("Translations", () => {

    afterEach(() => {
        I18n.setLanguage("en", false);
    });

    it("start in the language of the browser, if the game speaks it", () => {
        expect(I18n.detect(null, ["fr-FR", "en"])).toBe("fr");
        expect(I18n.detect(null, ["de-DE", "fr-CA"])).toBe("fr");
        expect(I18n.detect(null, ["en-GB", "fr"])).toBe("en");
        expect(I18n.detect(null, ["de", "es"])).toBe("en");
        expect(I18n.detect(null, [])).toBe("en");
    });

    it("start in the language chosen in the settings", () => {
        expect(I18n.detect("en", ["fr-FR"])).toBe("en");
        expect(I18n.detect("fr", ["en-US"])).toBe("fr");
        expect(I18n.detect("klingon", ["fr-FR"])).toBe("fr");
    });

    it("tell the listeners when the language changes", () => {
        const changes: string[] = [];
        I18n.onChange((language: string) => changes.push(language));
        I18n.setLanguage("fr", false);
        I18n.setLanguage("fr", false);
        I18n.setLanguage("xx", false);
        I18n.setLanguage("en", false);
        expect(changes).toEqual(["fr", "en"]);
    });

    it("translate texts, with their parameters and their context", () => {
        expect(I18n.t("Budget")).toBe("Budget");
        expect(I18n.t("budget|Fire")).toBe("Fire");
        expect(I18n.t("Goal reached: {goal}.", {goal: "be big"})).toBe("Goal reached: be big.");

        I18n.setLanguage("fr", false);
        expect(I18n.t("budget|Fire")).toBe("Pompiers");
        expect(I18n.t("disaster|Fire")).toBe("Incendie");
        expect(I18n.t("Tax rate: {tax}%", {tax: 7})).toBe("Taux d'imposition : 7 %");
    });

    it("translate into a given language, whatever the current one", () => {
        expect(I18n.translate("fr", "budget|Fire")).toBe("Pompiers");
        expect(I18n.translate("en", "budget|Fire")).toBe("Fire");
        expect(I18n.translate("fr", "Tax rate: {tax}%", {tax: 7})).toBe("Taux d'imposition\u00a0: 7\u00a0%");
        expect(I18n.translate("en", "Tax rate: {tax}%", {tax: 7})).toBe("Tax rate: 7%");
        expect(I18n.getLanguage()).toBe("en");

        I18n.setLanguage("fr", false);
        expect(I18n.translate("en", "budget|Fire")).toBe("Fire");
        expect(I18n.translate("en", "Goal reached: {goal}.", {goal: "be big"})).toBe("Goal reached: be big.");
        expect(I18n.translate("fr", "disaster|Fire")).toBe("Incendie");
        expect(I18n.t("disaster|Fire")).toBe(I18n.translate("fr", "disaster|Fire"));
    });

    it("translate into English what a language lacks, without noting it", () => {
        expect(I18n.translate("fr", "context|Not a text of the game")).toBe("Not a text of the game");
        expect(I18n.translate("de", "budget|Fire")).toBe("Fire");
        expect((I18n.missing as any)["context|Not a text of the game"]).toBeUndefined();

        // Nothing is taken from the objects' prototypes
        expect(I18n.translate("constructor", "budget|Fire")).toBe("Fire");
        expect(I18n.translate("fr", "constructor")).toBe("constructor");
        expect(I18n.translate("en", "{toString} {n}", {n: 1})).toBe("{toString} 1");
    });

    it("fall back on English, and note what is missing", () => {
        I18n.setLanguage("fr", false);
        expect(I18n.t("Not a text of the game")).toBe("Not a text of the game");
        expect((I18n.missing as any)["Not a text of the game"]).toBe(true);
        delete (I18n.missing as any)["Not a text of the game"];
    });

    it("write numbers and money the way each language does", () => {
        expect(I18n.formatNumber(1234567.4)).toBe("1,234,567");
        expect(I18n.money(20000)).toBe("$20,000");
        expect(I18n.money(-500)).toBe("-$500");

        I18n.setLanguage("fr", false);
        expect(I18n.formatNumber(1234567.4)).toBe("1 234 567");
        expect(I18n.money(20000)).toBe("20 000 $");
        expect(I18n.money(-500)).toBe("-500 $");
    });

    it("have a French translation for every text of the code", () => {
        const directory = path.join(__dirname, "..", "src");
        const found: string[] = [];
        const missing: string[] = [];

        fs.readdirSync(directory).filter(name => name.endsWith(".js") && name !== "i18n.js").forEach(name => {
            literalsPassedToT(fs.readFileSync(path.join(directory, name), "utf8")).forEach(text => {
                found.push(text);
                if (French[text] === undefined)
                    missing.push(name + ": " + text);
            });
        });

        expect(found).toEqual(expect.arrayContaining(["Tools", "Play this scenario", "Goal missed: {goal}.", "Keep playing",
                                                      "{percent}% of {total} = {cash}", "{months}m left"]));
        expect(found).not.toContain("cities");
        expect(found).not.toContain("data-label");
        expect(missing).toEqual([]);
    });

    it("have a French translation for every text of the game's tables", () => {
        const texts: string[] = [];
        const add = (value: any) => {
            if (typeof value === "string")
                texts.push(value);
            else if (value && typeof value === "object")
                Object.keys(value).forEach(key => add(value[key]));
        };

        ["densityStrings", "landValueStrings", "crimeStrings", "pollutionStrings", "rateStrings", "zoneTypes", "gameLevel",
         "cityClass", "problems", "months", "toolMessages", "messageText", "sides", "edges", "deals"].forEach(table => add((Text as any)[table]));
        Object.keys(Toolbar.TOOLS).forEach(tool => {
            add((Toolbar.TOOLS as any)[tool].name);
            add((Toolbar.TOOLS as any)[tool].description);
        });
        Toolbar.CATEGORIES.forEach((category: any) => add(category.name));
        Scenarios.list.forEach((scenario: any) => {
            add(scenario.place);
            add(scenario.text);
        });
        add(Scenarios.GOAL_TEXT);
        [ERROR_TEXTS, FIELD_TEXTS, KICK_TEXTS, TOOL_TEXTS, EMAIL_TEXTS].forEach(add);

        expect(texts).toEqual(expect.arrayContaining([ERROR_TEXTS.invalid_credentials, EMAIL_TEXTS.signup.subject,
                                                      EMAIL_TEXTS.accountLocked.text]));
        expect(texts.filter(text => French[text] === undefined)).toEqual([]);
    });

    it("have a French translation for every text of the page", () => {
        const texts = pageTexts();
        const keys = texts.map(text => text.key);

        expect(keys).toEqual(expect.arrayContaining(["Loading\u2026", "budget|Fire", "Found the city",
                                                     "Max. 15 letters", "City news", "credits"]));
        expect(keys).not.toContain("");
        expect(texts.filter(text => text.marker === "data-i18n-html").map(text => text.key).sort())
            .toEqual(HTML_KEYS.slice().sort());
        const attribute = (marker: string) => marker.slice("data-i18n-".length);
        expect(texts.filter(text => text.marker !== "data-i18n" && text.marker !== "data-i18n-html" &&
                                    I18n.ATTRIBUTES.indexOf(attribute(text.marker)) === -1)).toEqual([]);
        expect(texts.filter(text => French[text.key] === undefined)).toEqual([]);
    });

    it("keep the parameters of each text", () => {
        const parameters = (text: string) => (text.match(/\{\w+\}/g) || []).sort().join(",");
        const wrong = Object.keys(French).filter(key => HTML_KEYS.indexOf(key) === -1 &&
                                                        parameters(key) !== parameters(French[key]));
        expect(wrong).toEqual([]);
    });
});
