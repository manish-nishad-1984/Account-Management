import { describe, expect, it } from "vitest";
import { summariseTax } from "./tax-summary.js";

describe("summariseTax", () => {
  it("groups lines by GST rate, lowest rate first", () => {
    const summary = summariseTax([
      { hsnCode: "2523", gstPercent: "28.00", netAmount: "1000.00", gstAmount: "280.00" },
      { hsnCode: "7214", gstPercent: "18.00", netAmount: "500.00", gstAmount: "90.00" },
      { hsnCode: "2523", gstPercent: "28.00", netAmount: "250.00", gstAmount: "70.00" },
    ]);

    expect(summary.rows.map((row) => row.gstPercent)).toEqual(["18.00", "28.00"]);
    expect(summary.rows[1]).toMatchObject({
      halfPercent: "14.00",
      hsnCodes: ["2523"],
      taxableValue: "1250.00",
      gstAmount: "350.00",
      centralTax: "175.00",
      stateTax: "175.00",
    });
    expect(summary).toMatchObject({ taxableValue: "1750.00", gstAmount: "440.00" });
  });

  /**
   * The source rounds each half on its own, so 0.05 of GST prints as 0.03 + 0.03.
   * Here the halves always add up to the tax that was charged.
   */
  it("splits an odd paisa so the halves add up to the GST", () => {
    const summary = summariseTax([
      { gstPercent: "5.00", netAmount: "1.00", gstAmount: "0.05" },
    ]);

    expect(summary.rows[0]).toMatchObject({
      halfPercent: "2.50",
      centralTax: "0.02",
      stateTax: "0.03",
    });
    expect(summary).toMatchObject({ centralTax: "0.02", stateTax: "0.03", gstAmount: "0.05" });
  });

  it("puts lines without GST under a zero rate", () => {
    const summary = summariseTax([
      { gstPercent: null, netAmount: "400.00", gstAmount: "0.00" },
    ]);

    expect(summary.rows[0]).toMatchObject({ gstPercent: "0.00", taxableValue: "400.00" });
  });

  it("lists each HSN code once, in the order the lines have them", () => {
    const summary = summariseTax([
      { hsnCode: "7214", gstPercent: "18", netAmount: "1", gstAmount: "0.18" },
      { hsnCode: " 7308 ", gstPercent: "18", netAmount: "1", gstAmount: "0.18" },
      { hsnCode: "7214", gstPercent: "18", netAmount: "1", gstAmount: "0.18" },
      { hsnCode: null, gstPercent: "18", netAmount: "1", gstAmount: "0.18" },
    ]);

    expect(summary.rows[0]!.hsnCodes).toEqual(["7214", "7308"]);
  });

  it("is empty for no lines", () => {
    expect(summariseTax([])).toEqual({
      rows: [],
      taxableValue: "0.00",
      gstAmount: "0.00",
      centralTax: "0.00",
      stateTax: "0.00",
    });
  });
});
