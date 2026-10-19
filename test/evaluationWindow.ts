// The evaluation window, without the page: its elements only keep what they were last given
const mockShown: {[selector: string]: unknown} = {};

jest.mock("jquery", () => {
    const element = (selector: string) => {
        const self: any = {
            length: 1,
            text: (text: string) => { mockShown[selector] = text; return self; },
            show: () => { mockShown[selector + ":visible"] = true; return self; },
            hide: () => { mockShown[selector + ":visible"] = false; return self; },
            toggle: () => self,
            focus: () => self,
            on: () => self
        };
        return self;
    };
    return {__esModule: true, default: element};
});

import { Evaluation } from "../src/evaluation.js";
import { EvaluationWindow } from "../src/evaluationWindow.js";

const problemsShown = () => [1, 2, 3, 4].map(i => mockShown["#evalProb" + i + ":visible"]);


describe("The evaluation window", () => {

    beforeEach(() => {
        Object.keys(mockShown).forEach(key => delete mockShown[key]);
    });

    it("opens on a city without inhabitants, which has no problems", () => {
        const evaluation = new (Evaluation as any)(0);
        evaluation.cityEvaluation({census: {totalPop: 0}});
        expect([0, 1, 2, 3].map(i => evaluation.getProblemNumber(i))).toEqual([null, null, null, null]);

        const evaluationWindow = new (EvaluationWindow as any)("#opaque", "#evalWindow");
        expect(() => evaluationWindow.open(evaluation)).not.toThrow();
        expect(mockShown["#evalYes"]).toBe("50%");
        expect(problemsShown()).toEqual([false, false, false, false]);
    });

    it("shows only the problems it knows (a city's stats come from the server in multiplayer)", () => {
        const evaluation = new (Evaluation as any)(0);
        evaluation.problemOrder = [2, 7, "x", -1];
        evaluation.problemVotes = [{index: 2, voteCount: 30}];
        expect([0, 1, 2, 3].map(i => evaluation.getProblemNumber(i))).toEqual([2, null, null, null]);

        new (EvaluationWindow as any)("#opaque", "#evalWindow").open(evaluation);
        expect(mockShown["#evalProb1"]).toBe("Housing (30%)");
        expect(problemsShown()).toEqual([true, false, false, false]);
    });
});
