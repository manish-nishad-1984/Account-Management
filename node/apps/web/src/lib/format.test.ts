import { describe, expect, it } from "vitest";

import { formatDate, formatMoney, formatPercent } from "./format";

/**
 * These formatters render every money and tax value the user ever sees, and
 * until now none of them had a test. The seed data made that easy to miss:
 * no seeded amount reaches 100,000, so the lakh-grouping branch — the entire
 * reason this function exists rather than `toLocaleString` — had never once
 * executed, in a test or in a browser.
 */
describe("formatMoney", () => {
  it("groups the integer part the Indian way", () => {
    // The case the function exists for: pairs above the last three digits.
    expect(formatMoney("1234567.89")).toBe("12,34,567.89");
    expect(formatMoney("100000.00")).toBe("1,00,000.00");
    expect(formatMoney("1234567890.12")).toBe("1,23,45,67,890.12");
  });

  it("does not group in thousands", () => {
    // The whole point. 12,34,567.89 is read at a glance by the people who use
    // this system; 1,234,567.89 is not.
    expect(formatMoney("1234567.89")).not.toBe("1,234,567.89");
  });

  it("leaves values below a thousand alone", () => {
    expect(formatMoney("520.00")).toBe("520.00");
    expect(formatMoney("99.5")).toBe("99.50");
    expect(formatMoney("0")).toBe("0.00");
  });

  it("puts the first comma after the thousand mark", () => {
    expect(formatMoney("1000.00")).toBe("1,000.00");
    expect(formatMoney("12345.00")).toBe("12,345.00");
  });

  it("keeps the sign outside the grouping", () => {
    expect(formatMoney("-1234567.89")).toBe("-12,34,567.89");
    expect(formatMoney("-520.5")).toBe("-520.50");
  });

  it("pads the fraction to two places", () => {
    expect(formatMoney("10.5")).toBe("10.50");
    expect(formatMoney("10")).toBe("10.00");
  });

  it("truncates a longer fraction rather than rounding it", () => {
    // Deliberate and asserted so a change is visible: these values are already
    // stored at 2dp, and rounding here would be a second, invisible rounding
    // step on top of whatever produced the stored figure.
    expect(formatMoney("12.999")).toBe("12.99");
    expect(formatMoney("12.991")).toBe("12.99");
  });

  it("never converts through a JavaScript number", () => {
    // 0.1 + 0.2 arithmetic is exactly what this module exists to avoid, so a
    // value beyond Number.MAX_SAFE_INTEGER must survive with every digit
    // intact. Going through a double would round the last digits away.
    const formatted = formatMoney("9007199254740993.99");
    expect(formatted).toBe("9,00,71,99,25,47,40,993.99");
    expect(formatted.replace(/,/g, "")).toBe("9007199254740993.99");
  });
});

describe("formatPercent", () => {
  it("drops a zero fraction", () => {
    expect(formatPercent("18.00")).toBe("18%");
    expect(formatPercent("5.00")).toBe("5%");
    expect(formatPercent("28.00")).toBe("28%");
  });

  it("keeps a meaningful fraction", () => {
    expect(formatPercent("12.50")).toBe("12.5%");
    expect(formatPercent("0.25")).toBe("0.25%");
  });

  it("does not eat trailing zeros off a whole number", () => {
    // Regression. The previous implementation used `/\.?0+$/`, which matched
    // the "0" in "10" when there was no decimal point to match instead, and
    // rendered a 10% GST rate as 1%. It only stayed hidden because the API
    // happens to serialise numeric as "10.00".
    expect(formatPercent("10")).toBe("10%");
    expect(formatPercent("100")).toBe("100%");
    expect(formatPercent("20")).toBe("20%");
  });

  it("renders zero as zero", () => {
    expect(formatPercent("0")).toBe("0%");
    expect(formatPercent("0.00")).toBe("0%");
    expect(formatPercent("")).toBe("0%");
  });
});

describe("formatDate", () => {
  it("is empty for a missing or unparseable value", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate("not a date")).toBe("");
  });

  it("renders an ISO timestamp as a day-month-year date", () => {
    const rendered = formatDate("2026-04-01T00:00:00.000Z");
    expect(rendered).toMatch(/^\d{2} \w{3} 2026$/);
  });
});
