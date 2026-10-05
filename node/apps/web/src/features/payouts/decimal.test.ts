import { describe, expect, it } from "vitest";
import { fromPaise, sumAmounts, toPaise } from "./decimal";

describe("payout decimal arithmetic", () => {
  /** 0.1 + 0.2 is 0.30000000000000004 as a double. */
  it("adds 0.10 and 0.20 to exactly 0.30", () => {
    expect(sumAmounts(["0.10", "0.20"])).toBe("0.30");
    expect(sumAmounts(["0.1", "0.2"])).toBe("0.30");
  });

  it("totals forty lakh with paise exactly", () => {
    expect(sumAmounts(["4000000.00", "0.01"])).toBe("4000000.01");
    expect(sumAmounts(["2500000", "1500000.50", "0.50"])).toBe("4000001.00");
  });

  it("holds a 15-digit amount a double would round", () => {
    expect(sumAmounts(["999999999999999.99", "0.01"])).toBe("1000000000000000.00");
  });

  it("reads only what the contract accepts", () => {
    expect(toPaise("125000")).toBe(12500000n);
    expect(toPaise("1.5")).toBe(150n);
    expect(toPaise("")).toBeNull();
    expect(toPaise("1.234")).toBeNull();
    expect(toPaise("abc")).toBeNull();
    expect(toPaise("-5")).toBeNull();
  });

  it("writes paise back with two decimals", () => {
    expect(fromPaise(5n)).toBe("0.05");
    expect(fromPaise(12500000n)).toBe("125000.00");
    expect(fromPaise(-250n)).toBe("-2.50");
  });

  it("counts a blank or bad value as nothing", () => {
    expect(sumAmounts(["", "x", "10.00"])).toBe("10.00");
    expect(sumAmounts([])).toBe("0.00");
  });
});
