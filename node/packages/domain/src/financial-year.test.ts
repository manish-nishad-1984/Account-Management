import { describe, it, expect } from "vitest";
import { currentAsProduced, currentAsIntended, format } from "./financial-year.js";

/**
 * These are the SAME assertions as AccountManagement.Tests/FinancialYearTests.cs.
 * The .NET tests and these must agree, case for case — that is what makes the port
 * verifiable rather than hopeful.
 */
describe("financial year", () => {
  it.each([
    [2025, 5, 1, "25-26"],
    [2025, 12, 31, "25-26"],
    [2026, 1, 1, "25-26"],
    [2026, 3, 31, "25-26"],
  ])("produces the expected FY outside April (%i-%i-%i)", (y, m, d, expected) => {
    expect(format(currentAsProduced(new Date(y, m - 1, d)))).toBe(expected);
  });

  // DEFECT: April belongs to the FY that STARTS on 1 April, so these should be
  // "26-27". Production stamps them "25-26". Asserted on purpose, to fail loudly
  // if anyone changes the rule without sign-off.
  it.each([
    [2026, 4, 1, "25-26"],
    [2026, 4, 15, "25-26"],
    [2026, 4, 30, "25-26"],
  ])("DEFECT: April is stamped with the previous FY (%i-%i-%i)", (y, m, d, producedButWrong) => {
    expect(format(currentAsProduced(new Date(y, m - 1, d)))).toBe(producedButWrong);
  });

  it.each([
    [2026, 4, 1, "26-27"],
    [2026, 4, 30, "26-27"],
    [2026, 5, 1, "26-27"],
    [2026, 3, 31, "25-26"],
  ])("corrected rule puts April in the FY starting that month (%i-%i-%i)", (y, m, d, expected) => {
    expect(format(currentAsIntended(new Date(y, m - 1, d)))).toBe(expected);
  });

  it("differs from the corrected rule only during April", () => {
    const divergentDays: Date[] = [];
    for (let d = new Date(2024, 0, 1); d < new Date(2027, 0, 1); d.setDate(d.getDate() + 1)) {
      const produced = currentAsProduced(d);
      const intended = currentAsIntended(d);
      if (produced.endYear !== intended.endYear) {
        divergentDays.push(new Date(d));
      }
    }

    expect(divergentDays.every((d) => d.getMonth() + 1 === 4)).toBe(true);
    // 3 Aprils in the range, 30 days each — must match the .NET assertion exactly.
    expect(divergentDays.length).toBe(90);
  });
});
