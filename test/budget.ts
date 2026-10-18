// The city's money, and the budget window's rates
jest.mock("jquery", () => ({__esModule: true, default: () => { throw new Error("No page here"); }}));

import { Budget } from "../src/budget.js";
import { BudgetWindow } from "../src/budgetWindow.js";
import * as Messages from "../src/messages";

describe("The budget", () => {
    it("never holds more money than a save may (a 32-bit integer), nor less than nothing", () => {
        const budget = new (Budget as any)();
        const told: number[] = [];
        budget.addEventListener(Messages.FUNDS_CHANGED, (funds: number) => told.push(funds));

        budget.setFunds(2147483000);
        budget.spend(-10000);
        expect(budget.totalFunds).toBe(2147483647);
        budget.spend(-1);
        budget.spend(2147483647 + 5);
        expect(budget.totalFunds).toBe(0);
        expect(told).toEqual([2147483000, 2147483647, 0]);
    });

    it("shows each rate as it is: 29% stays 29% (0.29 * 100 is 28.999...)", () => {
        for (let percent = 0; percent <= 100; percent++)
            expect([percent, (BudgetWindow as any).rateOf(percent / 100)]).toEqual([percent, percent]);
    });
});
