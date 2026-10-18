import { AccountScreens } from "../src/accountScreens.js";
import { ERROR_TEXTS } from "../src/apiErrors.js";
import { I18n } from "../src/i18n.js";

const LIMITS = {passwordMin: 12, passwordMax: 128, usernameMin: 3, usernameMax: 20, cityNameMax: 15};


describe("The account forms", () => {

    afterEach(() => {
        I18n.setLanguage("en", false);
    });

    it("check email addresses roughly, as a browser does", () => {
        expect(AccountScreens.checkEmail("alice@example.org")).toBeNull();
        expect(AccountScreens.checkEmail("  alice@sub.example.org ")).toBeNull();
        expect(AccountScreens.checkEmail("")).toBe("required");
        expect(AccountScreens.checkEmail("   ")).toBe("required");
        ["alice", "alice@", "@example.org", "alice@example", "a b@example.org", "alice@@example.org",
         "alice@example..org", "a".repeat(250) + "@example.org"]
            .forEach(email => expect(AccountScreens.checkEmail(email)).toBe("invalid"));
    });

    it("check usernames as the server does", () => {
        ["bob", "Zoé", "jean-luc.picard", "player_42", "Ærøskøbing", "a".repeat(20)]
            .forEach(name => expect(AccountScreens.checkUsername(name, LIMITS)).toBeNull());
        expect(AccountScreens.checkUsername("", LIMITS)).toBe("required");
        expect(AccountScreens.checkUsername("ab", LIMITS)).toBe("too_short");
        expect(AccountScreens.checkUsername("a".repeat(21), LIMITS)).toBe("too_long");
        ["_bob", "bob.", "bo b", "бob", "bob!", "東京都"].forEach(name => expect(AccountScreens.checkUsername(name, LIMITS)).toBe("invalid"));
        // Digits are 0 to 9: other scripts' digits look like letters, or are written right to left
        ["\u3007perator", "r\u0D66\u0D66t", "r\u07C0\u07C0t", "bob\u0661"]
            .forEach(name => expect(AccountScreens.checkUsername(name, LIMITS)).toBe("invalid"));
        expect(AccountScreens.checkUsername("bob\uFF11\u00B2", LIMITS)).toBeNull();
        // The letters of languages only: other Latin letters (phonetic ones, small capitals...) look like ASCII ones
        ["\u0251dmin", "ka\u026Facity", "s\u028Bpport", "r\u1D0F\u1D0Ft", "b\uAB3Db", "a\u01C0ice"]
            .forEach(name => expect(AccountScreens.checkUsername(name, LIMITS)).toBe("invalid"));
        ["Stra\u00DFe", "S\u00F8ren", "\u00DE\u00F3ra", "I\u011Fd\u0131r", "\u0110or\u0111e", "\u01FElaf", "Z\u00F6e"]
            .forEach(name => expect(AccountScreens.checkUsername(name, LIMITS)).toBeNull());
        ["admin", "Root", "KawaCity", "undefined"].forEach(name => expect(AccountScreens.checkUsername(name, LIMITS)).toBe("reserved"));
        expect(AccountScreens.checkUsername("bob", {...LIMITS, usernameMin: 4})).toBe("too_short");
    });

    it("check passwords as the server does, but for the common ones", () => {
        expect(AccountScreens.checkPassword("correct horse battery", LIMITS)).toBeNull();
        expect(AccountScreens.checkPassword("", LIMITS)).toBe("required");
        expect(AccountScreens.checkPassword("short pass", LIMITS)).toBe("too_short");
        expect(AccountScreens.checkPassword("x".repeat(129), LIMITS)).toBe("too_long");
        expect(AccountScreens.checkPassword("abababababab", LIMITS)).toBe("too_simple");
        // Characters, not UTF-16 units
        expect(AccountScreens.checkPassword("😀😁😂😃😀😁", LIMITS))
            .toBe("too_short");
        expect(AccountScreens.checkPassword("my name is Alice!", LIMITS, {username: "alice"})).toBe("contains_username");
        expect(AccountScreens.checkPassword("bob bob bob bob 1", LIMITS, {username: "bob"})).toBeNull();
        expect(AccountScreens.checkPassword("write to jdoe1 please", LIMITS, {email: "jdoe1@example.org"}))
            .toBe("contains_email");
    });

    it("say what went wrong, and how long to wait", () => {
        expect(AccountScreens.errorText({code: "invalid_credentials"})).toBe(ERROR_TEXTS.invalid_credentials);
        expect(AccountScreens.errorText({code: "no_such_code"})).toBe(ERROR_TEXTS.internal);
        expect(AccountScreens.errorText(null)).toBe(ERROR_TEXTS.internal);
        expect(AccountScreens.errorText({code: "rate_limited", retryAfter: 30}))
            .toBe(ERROR_TEXTS.rate_limited + " You can try again in 30 s.");
        expect(AccountScreens.errorText({code: "too_many_attempts", retryAfter: 61}))
            .toBe(ERROR_TEXTS.too_many_attempts + " You can try again in 2 min.");
        expect(AccountScreens.errorText({code: "too_many_attempts", retryAfter: 86400}))
            .toBe(ERROR_TEXTS.too_many_attempts + " You can try again in 24 h.");
        expect(AccountScreens.errorText({code: "server_busy", retryAfter: 30})).toBe(ERROR_TEXTS.server_busy);

        I18n.setLanguage("fr", false);
        expect(AccountScreens.errorText({code: "rate_limited", retryAfter: 120}))
            .toBe(I18n.t(ERROR_TEXTS.rate_limited) + " Vous pourrez réessayer dans 2 min.");
    });
});
