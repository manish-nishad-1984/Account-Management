import { describe, expect, it } from "vitest";
import { asProduced, corrected, drift } from "./invoice-total.js";
import { decimal, format, round, roundToWholeRupeeAsProduced } from "./money.js";

/**
 * Two kinds of test here, and they must not be confused.
 *
 *  - CHARACTERISATION tests pin what the legacy system does. If one fails, the
 *    reproduction has drifted from the source and the reconciliation is wrong.
 *    They are not assertions that the behaviour is correct.
 *
 *  - CORRECTNESS tests pin the arithmetic the business believes it is getting.
 *
 * The gap between them is question 1 of 19-Business-Decisions-Required.md.
 */

describe("money", () => {
  it("holds a decimal exactly, where a float cannot", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in every JavaScript engine.
    expect(format(decimal("0.10") + decimal("0.20"))).toBe("0.30");
  });

  it("rounds half AWAY FROM ZERO, not the way toFixed does", () => {
    // (1.005).toFixed(2) === "1.00" — the binary representation is below the tie.
    expect(format(round(decimal("1.005")))).toBe("1.01");
    expect(format(round(decimal("2.675")))).toBe("2.68");
    expect(format(round(decimal("-1.005")))).toBe("-1.01");
  });

  it("refuses a grouped string rather than silently misreading it", () => {
    expect(() => decimal("1,234.56")).toThrow(TypeError);
  });

  it("treats null, undefined and empty as zero", () => {
    for (const value of [null, undefined, ""]) {
      expect(format(decimal(value))).toBe("0.00");
    }
  });

  /**
   * CHARACTERISATION. `decimal <= 0.5 ? floor : ceil`, from
   * InvoiceMasterScript.js:1005 and SalesInvoiceMasterScript.js:381.
   */
  describe("the whole-rupee round-off", () => {
    const cases: [string, string][] = [
      ["100.49", "100"],
      // Exactly .50 goes DOWN. Commercial rounding takes it up.
      ["100.50", "100"],
      ["100.51", "101"],
      ["0.50", "0"],
      ["0.51", "1"],
      ["1234.99", "1235"],
    ];

    for (const [input, expected] of cases) {
      it(`${input} is charged as ${expected}`, () => {
        expect(format(roundToWholeRupeeAsProduced(decimal(input)), 0)).toBe(expected);
      });
    }

    it("always favours the counterparty on the tie, never the company", () => {
      const exact = decimal("1234.50");
      const charged = roundToWholeRupeeAsProduced(exact);
      expect(charged).toBeLessThan(exact);
    });
  });
});

describe("corrected invoice totals", () => {
  const LINES = [
    { unitPrice: "100.00", quantity: "10", gstPercent: "18" },
    { unitPrice: "125.00", quantity: "4", gstPercent: "18" },
  ];

  it("counts every line", () => {
    const total = corrected(LINES);
    expect(total.subtotal).toBe("1500.00");
    expect(total.totalGst).toBe("270.00");
    expect(total.grandTotal).toBe("1770.00");
  });

  it("charges GST on the price after discount", () => {
    const total = corrected([
      { unitPrice: "100.00", quantity: "10", discountPerUnit: "10.00", gstPercent: "18" },
    ]);
    expect(total.subtotal).toBe("900.00");
    expect(total.totalDiscount).toBe("100.00");
    expect(total.totalGst).toBe("162.00");
    expect(total.grandTotal).toBe("1062.00");
  });

  it("subtracts TDS and adds the round-off", () => {
    const total = corrected(LINES, { tds: "500.00", roundOff: "7.00" });
    expect(total.grandTotal).toBe("1277.00");
  });

  it("takes a negative round-off as a reduction", () => {
    expect(corrected(LINES, { roundOff: "-70.00" }).grandTotal).toBe("1700.00");
  });

  /**
   * Rounding per line and then summing is the source's ordering, and it is kept:
   * a total that does not equal the printed lines added up is a support call.
   */
  it("rounds each line and then sums, not the other way round", () => {
    const thirds = Array.from({ length: 3 }, () => ({
      unitPrice: "33.335",
      quantity: "1",
      gstPercent: "0",
    }));
    // 33.335 rounds to 33.34 per line; 3 x 33.34 = 100.02, not 100.005 -> 100.01.
    expect(corrected(thirds, {}, { roundGrandTotalToRupee: false }).subtotal).toBe("100.02");
  });

  it("can be asked not to round the grand total to a rupee", () => {
    const lines = [{ unitPrice: "100.40", quantity: "1", gstPercent: "0" }];
    expect(corrected(lines).grandTotal).toBe("100.00");
    expect(corrected(lines, {}, { roundGrandTotalToRupee: false }).grandTotal).toBe("100.40");
  });
});

/**
 * CHARACTERISATION of the three legacy calculators. Verified against the real
 * scripts by Migration-Assessment/tools/calculator-harness/run.mjs.
 */
describe("the legacy calculators, reproduced", () => {
  const LINES = [
    { unitPrice: "100.00", quantity: "10", gstPercent: "18" },
    { unitPrice: "125.00", quantity: "4", gstPercent: "18" },
  ];

  describe("purchase-order — the one that WINS on Create Invoice", () => {
    it("ignores TDS entirely, which is finding D-JS-1", () => {
      const without = asProduced(LINES, {}, "purchase-order");
      const with500 = asProduced(LINES, { tds: "500.00" }, "purchase-order");
      expect(with500.grandTotal).toBe(without.grandTotal);
    });

    it("ignores the round-off too", () => {
      expect(asProduced(LINES, { roundOff: "7.00" }, "purchase-order").grandTotal).toBe(
        asProduced(LINES, {}, "purchase-order").grandTotal,
      );
    });

    it("does not round to a whole rupee, so its totals keep their paise", () => {
      const lines = [{ unitPrice: "100.40", quantity: "1", gstPercent: "0" }];
      expect(asProduced(lines, {}, "purchase-order").grandTotal).toBe("100.40");
    });

    it("charges GST on the GROSS price, ignoring the discount", () => {
      const line = [
        { unitPrice: "100.00", quantity: "10", discountPerUnit: "10.00", gstPercent: "18" },
      ];
      // 100 x 10 x 18% = 180, not 162 — the discount never reaches the tax.
      expect(asProduced(line, {}, "purchase-order").totalGst).toBe("180.00");
    });
  });

  describe("purchase-invoice — the one that is overwritten", () => {
    it("does read TDS and the round-off", () => {
      const total = asProduced(LINES, { tds: "500.00", roundOff: "7.00" }, "purchase-invoice");
      expect(total.grandTotal).toBe("1277.00");
    });

    it("rounds the grand total to a whole rupee", () => {
      const lines = [{ unitPrice: "100.51", quantity: "1", gstPercent: "0" }];
      expect(asProduced(lines, {}, "purchase-invoice").grandTotal).toBe("101.00");
    });

    /**
     * The hidden dependency: the discount reaches the total only because a
     * separate handler overwrote the price field first. If it did not run, the
     * discount is displayed and charged for anyway.
     */
    it("loses the discount entirely when the price field was not overwritten", () => {
      const line = [
        { unitPrice: "100.00", quantity: "10", discountPerUnit: "10.00", gstPercent: "18" },
      ];
      const applied = asProduced(line, {}, "purchase-invoice", { discountApplied: true });
      const not = asProduced(line, {}, "purchase-invoice", { discountApplied: false });

      expect(applied.grandTotal).toBe("1062.00");
      expect(not.grandTotal).toBe("1180.00");
      // The discount is REPORTED as 100.00 in both, which is the trap.
      expect(applied.totalDiscount).toBe("100.00");
      expect(not.totalDiscount).toBe("100.00");
    });
  });

  describe("sales", () => {
    it("rounds to a whole rupee like the invoice screen", () => {
      const lines = [{ unitPrice: "100.51", quantity: "1", gstPercent: "0" }];
      expect(asProduced(lines, {}, "sales").grandTotal).toBe("101.00");
    });

    it("never subtracts the discount as a separate term", () => {
      const line = [
        { unitPrice: "100.00", quantity: "10", discountPerUnit: "10.00", gstPercent: "0" },
      ];
      // 900, not 900 - 100: the reduction is already inside the subtotal, and
      // subtracting the reported discount again would double-count it.
      expect(asProduced(line, {}, "sales").grandTotal).toBe("900.00");
    });
  });
});

/**
 * The number question 1 actually asks the business about. It can now be produced
 * for every historical invoice rather than estimated.
 */
describe("drift between what was issued and what is correct", () => {
  it("reports the difference the purchase-order calculator caused", () => {
    const lines = [{ unitPrice: "100.00", quantity: "10", gstPercent: "18" }];
    const result = drift(lines, { tds: "500.00" }, "purchase-order");

    expect(result.asProduced).toBe("1180.00");
    expect(result.corrected).toBe("680.00");
    // Half a lakh a year of unclaimed TDS looks exactly like this, one invoice
    // at a time.
    expect(result.difference).toBe("-500.00");
  });

  it("is zero when the two agree", () => {
    const lines = [{ unitPrice: "100.00", quantity: "10", gstPercent: "18" }];
    expect(drift(lines, {}, "purchase-invoice").difference).toBe("0.00");
  });

  it("shows the paise the whole-rupee round-off discards", () => {
    const lines = [{ unitPrice: "1249.99", quantity: "7", gstPercent: "18" }];
    const result = drift(lines, {}, "purchase-order");

    // as produced keeps the paise; corrected rounds to the rupee.
    expect(result.asProduced).toBe("10324.92");
    expect(result.corrected).toBe("10325.00");
    expect(result.difference).toBe("0.08");
  });
});
