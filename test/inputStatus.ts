// The map's input, without the page: a canvas and a document of their own, jQuery doing nothing
// (a module: what it declares stays its own)
export {};

jest.mock("jquery", () => {
    const chain: any = new Proxy(function() {}, {
        get: (_target, key) => key === "length" ? 0 : () => chain,
        apply: () => chain
    });
    return {__esModule: true, default: chain};
});

const handlers: Record<string, (e: any) => void> = {};
const canvas = {
    style: {} as Record<string, string>,
    addEventListener: (event: string, handler: (e: any) => void) => { handlers[event] = handler; },
    setPointerCapture: () => undefined,
    getBoundingClientRect: () => ({left: 0, top: 0, width: 800, height: 600})
};
const page: any = {body: {tagName: "BODY"}, activeElement: null, querySelector: () => canvas};
(global as any).document = page;
(global as any).window = {addEventListener: (event: string, handler: (e: any) => void) => { handlers[event] = handler; }};

const { InputStatus } = require("../src/inputStatus.js");

describe("A press on the map", () => {
    it("takes the keys back from a text field (a shared city's chat): the game's shortcuts work again", () => {
        const input = new InputStatus({width: 120, height: 100}, {});
        const chat = {tagName: "INPUT", blur: jest.fn()};
        page.activeElement = chat;
        handlers.pointerdown({isPrimary: true, pointerId: 1, pointerType: "mouse", button: 0, clientX: 200,
                              clientY: 300, preventDefault: () => undefined});
        expect(chat.blur).toHaveBeenCalledTimes(1);

        // A button keeps the focus it had (only text fields and lists take the keys)
        const button = {tagName: "BUTTON", blur: jest.fn()};
        page.activeElement = button;
        handlers.pointerdown({isPrimary: true, pointerId: 2, pointerType: "mouse", button: 0, clientX: 200,
                              clientY: 300, preventDefault: () => undefined});
        expect(button.blur).not.toHaveBeenCalled();
        expect(input.isBlocked()).toBe(false);
    });
});


describe("The keyboard", () => {
    const press = (code: string, key: string) => {
        const e = {code: code, key: key, target: page.body, preventDefault: jest.fn()};
        handlers.keydown(e);
        return e;
    };

    const make = () => {
        const zoomOut = jest.fn();
        const input = new InputStatus({width: 120, height: 100}, {zoomOut: zoomOut, zoomIn: jest.fn()});
        input.selectTool = jest.fn();
        return {input, zoomOut};
    };

    it("selects the tools by the place of the digit keys: on an AZERTY keyboard, 6 and 8 don't zoom out", () => {
        const {input, zoomOut} = make();
        press("Digit6", "-");
        press("Digit8", "_");
        press("Digit1", "&");
        press("Numpad9", "9");
        expect(input.selectTool.mock.calls.map((call: any[]) => call[0])).toEqual(["wire", "police", "residential", "fire"]);
        expect(zoomOut).not.toHaveBeenCalled();

        press("Minus", "-");
        expect(zoomOut).toHaveBeenCalledTimes(1);
    });

    it("pans with the keys at the place of WASD (ZQSD on an AZERTY keyboard), and opens the query tool with Q or I", () => {
        const {input} = make();
        press("KeyA", "q");
        expect(input._keysHeld.left).toBe(true);
        expect(input.selectTool).not.toHaveBeenCalled();

        press("KeyQ", "q");
        press("KeyI", "i");
        expect(input.selectTool.mock.calls.map((call: any[]) => call[0])).toEqual(["query", "query"]);
    });
});
