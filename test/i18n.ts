import * as fs from "fs";
import * as path from "path";

import { I18n } from "../src/i18n.js";
import { Scenarios } from "../src/scenarios.js";
import { Text } from "../src/text.js";
import { Toolbar } from "../src/toolbar.js";

const French = (I18n as any).dictionaries.fr;

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

        expect(texts.filter(text => French[text] === undefined)).toEqual([]);
    });

    it("keep the parameters of each text", () => {
        const parameters = (text: string) => (text.match(/\{\w+\}/g) || []).sort().join(",");
        const html = ["credits", "nag", "saveFile"];
        const wrong = Object.keys(French).filter(key => html.indexOf(key) === -1 &&
                                                        parameters(key) !== parameters(French[key]));
        expect(wrong).toEqual([]);
    });
});
