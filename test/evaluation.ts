// The yearly evaluation of a city, and what it tells the heads-up display
import { Evaluation } from "../src/evaluation.js";
import * as Messages from "../src/messages";

describe("The evaluation", () => {
    it("tells the display when the score goes back to its start, the city left without inhabitants", () => {
        const evaluation = new (Evaluation as any)(0);
        evaluation.cityScore = 730;
        const scores: number[] = [];
        evaluation.addEventListener(Messages.SCORE_UPDATED, (score: number) => scores.push(score));

        evaluation.cityEvaluation({census: {totalPop: 0}});
        expect(evaluation.cityScore).toBe(500);
        expect(scores).toEqual([500]);
    });
});
