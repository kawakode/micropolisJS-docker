import { CLIENT_ERROR_CODES, ERROR_CODES, ERROR_TEXTS, FIELD_REASONS, FIELD_TEXTS, KICK_REASONS, KICK_TEXTS,
         TOOL_REASONS, TOOL_TEXTS } from "../src/apiErrors.js";
import { Text } from "../src/text.js";

describe("The errors of the server", () => {

    it("have a text for every code the server sends", () => {
        expect(ERROR_CODES.slice().sort()).toEqual([
            "bad_origin", "captcha_expired", "captcha_failed", "conflict", "forbidden", "internal",
            "invalid_credentials", "invalid_input", "invalid_token", "limit_reached", "method_not_allowed", "not_found",
            "payload_too_large", "rate_limited", "registration_closed", "server_busy", "too_many_attempts",
            "unauthenticated", "unsupported_media_type", "username_taken", "weak_password"
        ]);
        expect(CLIENT_ERROR_CODES).toEqual(["network", "timeout"]);
        expect(Object.keys(ERROR_TEXTS).sort()).toEqual(ERROR_CODES.concat(CLIENT_ERROR_CODES).sort());
        expect(ERROR_TEXTS.invalid_credentials).toBe("Wrong username, email or password.");
    });

    it("have a text for every reason a field, a connection or a tool fails", () => {
        expect(FIELD_REASONS).toEqual(["required", "invalid", "too_short", "too_long", "common", "contains_username",
                                       "contains_email", "too_simple", "reserved"]);
        expect(KICK_REASONS).toEqual(["deleted", "removed", "session", "error", "shutdown", "idle"]);
        expect(TOOL_REASONS).toEqual(["no_money", "needs_bulldoze", "failed", "locked"]);
        expect(Object.keys(FIELD_TEXTS)).toEqual(FIELD_REASONS);
        expect(Object.keys(KICK_TEXTS)).toEqual(KICK_REASONS);
        expect(Object.keys(TOOL_TEXTS)).toEqual(TOOL_REASONS);
    });

    it("say each failure in its own words", () => {
        const texts = ([ERROR_TEXTS, FIELD_TEXTS, KICK_TEXTS, TOOL_TEXTS] as any[])
            .reduce((all: string[], table: any) => all.concat(Object.keys(table).map(code => table[code])), []);

        expect(texts.every((text: string) => typeof text === "string" && text.length > 0)).toBe(true);
        expect(new Set(texts).size).toBe(texts.length);
        expect(texts.filter((text: string) => /[{|]/.test(text))).toEqual([]);
    });

    it("tell of a tool that fails as a city played alone does", () => {
        expect(TOOL_TEXTS.no_money).toBe(Text.toolMessages.noMoney);
        expect(TOOL_TEXTS.needs_bulldoze).toBe(Text.toolMessages.needsDoze);
    });
});
