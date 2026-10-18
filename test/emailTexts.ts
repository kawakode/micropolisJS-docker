import { EMAIL_TEXTS } from "../src/emailTexts.js";
import { I18n } from "../src/i18n.js";

// The placeholders of each email (see emailTexts.js)
const PLACEHOLDERS: {[email: string]: string[]} = {
    signup: ["hours", "link", "site"],
    alreadyRegistered: ["hours", "link", "site", "username"],
    reset: ["hours", "link", "site", "username"],
    passwordChanged: ["site", "username"],
    emailChangeConfirm: ["hours", "link", "site", "username"],
    emailChangeNotice: ["site", "username"],
    emailChanged: ["site", "username"],
    accountLocked: ["hours", "site", "username"]
};

const placeholders = (text: string): string[] =>
    Array.from(new Set((text.match(/\{\w+\}/g) || []).map(p => p.slice(1, -1)))).sort();

const params = {username: "Mayor_Bob", site: "https://kawacity.example.org",
                link: "https://kawacity.example.org/#/reset/T0k3n", hours: 24};

describe("The emails", () => {

    it("are the ones the server sends", () => {
        expect(Object.keys(EMAIL_TEXTS).sort()).toEqual(Object.keys(PLACEHOLDERS).sort());
    });

    it("have subjects that hold nothing about the account", () => {
        Object.keys(EMAIL_TEXTS).forEach(email => {
            ["en", "fr"].forEach(lang => {
                const subject = I18n.translate(lang, (EMAIL_TEXTS as any)[email].subject);
                expect(placeholders(subject)).toEqual([]);
                expect(subject).toMatch(/KawaCity/);
                expect(subject).not.toMatch(/\n/);
            });
        });
    });

    it("use the placeholders they are documented with, in every language", () => {
        Object.keys(EMAIL_TEXTS).forEach(email => {
            const text = (EMAIL_TEXTS as any)[email].text;
            expect([email, placeholders(text)]).toEqual([email, PLACEHOLDERS[email]]);
            expect([email, placeholders(I18n.translate("fr", text))]).toEqual([email, PLACEHOLDERS[email]]);
        });
    });

    it("put each link alone in its own paragraph", () => {
        Object.keys(EMAIL_TEXTS).forEach(email => {
            ["en", "fr"].forEach(lang => {
                const text: string = I18n.translate(lang, (EMAIL_TEXTS as any)[email].text, params);
                const paragraphs = text.split("\n\n");
                expect(paragraphs.every(paragraph => paragraph.length > 0 && paragraph.trim() === paragraph &&
                                                     paragraph.indexOf("\n") === -1)).toBe(true);
                expect(paragraphs.filter(paragraph => paragraph.indexOf(params.link) !== -1))
                    .toEqual(PLACEHOLDERS[email].indexOf("link") === -1 ? [] : [params.link]);
                expect(placeholders(text)).toEqual([]);
            });
        });
    });

    it("are written in French with French typography", () => {
        const text = I18n.translate("fr", EMAIL_TEXTS.reset.text, params);

        expect(text).toContain("Bonjour Mayor_Bob,\n\n");
        expect(text).toContain("dans les 24 h\u00a0:\n\nhttps://kawacity.example.org/#/reset/T0k3n\n\n");
        expect(text).toContain("sur https://kawacity.example.org.");
        expect(I18n.translate("fr", EMAIL_TEXTS.accountLocked.text, params))
            .toContain("\u00ab\u00a0Mot de passe oubli\u00e9\u00a0?\u00a0\u00bb");
    });
});
