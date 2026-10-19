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

    it("spends nothing on services, and never less, when the deals cost more than the city has", () => {
        const budget = new (Budget as any)();
        budget.setFunds(100);
        budget.taxFund = 50;
        budget.dealsFund = -500;
        budget.roadMaintenanceBudget = 200;
        budget.fireMaintenanceBudget = 100;
        budget.policeMaintenanceBudget = 100;

        const costs = budget._calculateBestPercentages();

        expect(costs).toEqual({road: 0, fire: 0, police: 0});
        expect([budget.roadPercent, budget.firePercent, budget.policePercent]).toEqual([0, 0, 0]);
        budget.doBudgetSpend(costs.road, costs.fire, costs.police);
        expect([budget.roadEffect, budget.fireEffect, budget.policeEffect]).toEqual([0, 0, 0]);
    });

    it("shows each rate as it is: 29% stays 29% (0.29 * 100 is 28.999...)", () => {
        for (let percent = 0; percent <= 100; percent++)
            expect([percent, (BudgetWindow as any).rateOf(percent / 100)]).toEqual([percent, percent]);
    });
});
