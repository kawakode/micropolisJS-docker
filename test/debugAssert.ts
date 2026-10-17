import { assert } from "../src/debugAssert";

describe("the debug asserter", () => {

    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        errorSpy.mockRestore();
    });

    it("should report when the assertion fails", () => {
        const message = "foo";

        assert(false, message);

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(message));
    });

    it("should not report when the assertion succeeds", () => {
        const message = "foo";

        assert(true, message);

        expect(errorSpy).not.toHaveBeenCalled();
    });
});
