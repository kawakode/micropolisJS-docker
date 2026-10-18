import * as crypto from "crypto";

import { Sha256 } from "../src/sha256.js";

const reference = (text: string): string => crypto.createHash("sha256").update(text, "utf8").digest("hex");

// A salt as the server writes it: 32 hexadecimal digits, the expiry in ms, the action
const serverSalt = (action: string): string =>
    crypto.randomBytes(16).toString("hex") + "." + (Date.now() + 600000) + "." + action;


describe("SHA-256", () => {

    it("gives the digests of the standard's examples", () => {
        expect(Sha256.hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        expect(Sha256.hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        expect(Sha256.hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))
            .toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
        expect(Sha256.hex("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"))
            .toBe("cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
        expect(Sha256.hex("a".repeat(1000000))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    });

    it("hashes messages of every length around the blocks' ends", () => {
        for (let length = 0; length <= 200; length++) {
            const text = "x".repeat(length);
            expect(Sha256.hex(text)).toBe(reference(text));
        }
    });

    it("hashes the UTF-8 bytes of a text", () => {
        ["é", "€uro", "😀 smile", "KawaCity – Ville", "\ud800 lone surrogate"].forEach(text => {
            expect(Sha256.hex(text)).toBe(reference(text));
        });
        expect(Sha256.utf8("é€😀")).toEqual([0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]);
    });

    it("finds the number hidden in a challenge", () => {
        const salt = serverSalt("register");
        [0, 7, 1234, 99999, 150000].forEach(n => {
            expect(Sha256.search(salt, reference(salt + n), 0, 150001)).toBe(n);
        });
    });

    it("finds numbers whose digits fall on either side of a block's end", () => {
        for (let length = 40; length <= 140; length++) {
            const salt = "s".repeat(length);
            [0, 9, 10, 4321, 100000].forEach(n => {
                expect(Sha256.search(salt, reference(salt + n), Math.max(0, n - 3), n + 3)).toBe(n);
            });
        }
    });

    it("tells when the number is not in the range tried", () => {
        const salt = serverSalt("login");
        const challenge = reference(salt + 500);

        expect(Sha256.search(salt, challenge, 0, 500)).toBe(-1);
        expect(Sha256.search(salt, challenge, 501, 1000)).toBe(-1);
        expect(Sha256.search(salt, challenge, 500, 501)).toBe(500);
    });

    it("searches the same challenge again, in any order", () => {
        const salt = serverSalt("forgot");
        const searcher = new Sha256.Searcher(salt, reference(salt + 42));

        expect(searcher.search(100, 200)).toBe(-1);
        expect(searcher.search(0, 100)).toBe(42);
        expect(searcher.search(40, 50)).toBe(42);
        expect(searcher.search(43, 100000)).toBe(-1);
    });

    it("finds nothing for a digest that is not one", () => {
        expect(Sha256.search("salt", "not a digest", 0, 100)).toBe(-1);
        expect(Sha256.search("salt", reference("salt1").slice(1), 0, 100)).toBe(-1);
        expect(Sha256.search("salt", reference("salt1").toUpperCase(), 0, 100)).toBe(1);
    });
});
