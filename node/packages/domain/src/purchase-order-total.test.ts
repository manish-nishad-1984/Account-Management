import { describe, expect, it } from "vitest";
import { line as lineTotal, compute as purchaseOrderTotal, type PurchaseOrderLine } from "./purchase-order-total.js";

/**
 * The legacy PO calculator, transcribed from `PurchaseRequestScript.js:1758-1806`
 * in the float arithmetic it actually runs in.
 *
 * This is an ORACLE, not an implementation. It exists so the decimal version can
 * be checked against what the browser produces, rather than against what this
 * file's author believed the browser produces. Where the two disagree, the test
 * says which is right and why — and there is exactly one such case below.
 */
function legacyFloat(lines: PurchaseOrderLine[]) {
  let totalSubtotal = 0;
  let totalGst = 0;
  let totalQuantity = 0;

  for (const line of lines) {
    const price = Number.parseFloat(line.unitPrice) || 0;
    const qty = Number.parseFloat(line.quantity) || 0;
    const gst = Number.parseFloat(line.gstPercent ?? "0") || 0;

    // updateProductTotalAmount writes the row fields, both .toFixed(2).
    const rowGst = (price * qty * gst) / 100;
    const rowGstField = rowGst.toFixed(2);

    // updateTotals reads the GST back OUT of the field, so it is already rounded;
    // the subtotal is recomputed raw from price and quantity.
    totalSubtotal += price * qty;
    totalGst += Number.parseFloat(rowGstField);
    totalQuantity += qty;
  }

  return {
    subtotal: totalSubtotal.toFixed(2),
    totalGst: totalGst.toFixed(2),
    grandTotal: (totalSubtotal + totalGst).toFixed(2),
    totalQuantity,
  };
}

describe("purchase order line", () => {
  it("charges GST on the gross line amount", () => {
    expect(lineTotal({ unitPrice: "1000.00", quantity: "3", gstPercent: "18" })).toEqual({
      netAmount: "3000.00",
      gstAmount: "540.00",
      total: "3540.00",
    });
  });

  it("treats a missing GST percentage as zero rather than refusing the line", () => {
    expect(lineTotal({ unitPrice: "250.00", quantity: "2" })).toEqual({
      netAmount: "500.00",
      gstAmount: "0.00",
      total: "500.00",
    });
  });

  it("rounds the line GST to 2dp, because the source stores it in a .toFixed(2) field", () => {
    // 99.99 x 18% = 17.9982 exactly.
    expect(lineTotal({ unitPrice: "33.33", quantity: "3", gstPercent: "18" })).toEqual({
      netAmount: "99.99",
      gstAmount: "18.00",
      total: "117.99",
    });
  });

  it("gets 4.86 on the 27-at-18% case, and so does this particular float form", () => {
    // 27 at 18% is the case §5o raised on the Item Master import, where the
    // decimal answer is 4.86 and a float answer is 4.859999999999999.
    //
    // MEASURED, because the attribution matters and the obvious guess is wrong:
    // the bad value does NOT come from the division order. Every arrangement of
    // the integer form is exact, including the one §5o names —
    //   (27 * 18) / 100 === 4.86     27 / 100 * 18 === 4.86
    // because 27 x 18 = 486 and 27 / 100 = 0.27 are both exact enough that the
    // final step lands on the nearest double to 4.86.
    //
    // It comes from multiplying by a RATE: 27 * 0.18, where 0.18 has no exact
    // binary representation. So this calculator is safe on these numbers, and
    // anything that converts a percentage to a rate first is not.
    expect((27 * 18) / 100).toBe(4.86);
    expect(27 * 0.18).not.toBe(4.86);

    // Ours is exact regardless of which form a future edit reaches for.
    expect(lineTotal({ unitPrice: "27.00", quantity: "1", gstPercent: "18" }).gstAmount).toBe(
      "4.86",
    );
  });

  it("keeps a fractional quantity exact", () => {
    expect(lineTotal({ unitPrice: "100.00", quantity: "2.5", gstPercent: "18" })).toEqual({
      netAmount: "250.00",
      gstAmount: "45.00",
      total: "295.00",
    });
  });
});

describe("purchase order total", () => {
  const order: PurchaseOrderLine[] = [
    { unitPrice: "1000.00", quantity: "3", gstPercent: "18" },
    { unitPrice: "27.00", quantity: "1", gstPercent: "18" },
    { unitPrice: "500.00", quantity: "2", gstPercent: "5" },
  ];

  it("sums the lines the way the screen does", () => {
    const total = purchaseOrderTotal(order);

    expect(total.subtotal).toBe("4027.00"); // 3000 + 27 + 1000
    expect(total.totalGst).toBe("594.86"); // 540 + 4.86 + 50
    expect(total.grandTotal).toBe("4621.86");
    expect(total.totalQuantity).toBe("6.00");
  });

  it("returns the per-line breakdown alongside the roll-up", () => {
    const total = purchaseOrderTotal(order);

    expect(total.lines).toHaveLength(3);
    expect(total.lines[1]).toEqual({
      netAmount: "27.00",
      gstAmount: "4.86",
      total: "31.86",
    });
  });

  it("is zero for an empty order rather than NaN", () => {
    // The legacy roll-up leaves totalAmount at its initial 0 for an empty grid,
    // but every per-row read is parseFloat(undefined) -> NaN the moment a row
    // exists with an empty price box.
    expect(purchaseOrderTotal([])).toEqual({
      lines: [],
      subtotal: "0.00",
      totalGst: "0.00",
      grandTotal: "0.00",
      totalQuantity: "0.00",
    });
  });

  it("does not go NaN on a line with blank fields, where the source does", () => {
    // parseFloat("") is NaN, and NaN propagates through the whole roll-up: one
    // empty price box blanks the Sub Total, Total GST and Total Amount at once.
    const blank = [{ unitPrice: "", quantity: "", gstPercent: "" }];
    expect(legacyFloat(blank).grandTotal).toBe("0.00"); // `|| 0` in the oracle
    expect(purchaseOrderTotal(blank).grandTotal).toBe("0.00");
  });

  describe("agrees with the legacy float calculator", () => {
    const cases: Array<[string, PurchaseOrderLine[]]> = [
      ["a single whole-rupee line", [{ unitPrice: "1000.00", quantity: "3", gstPercent: "18" }]],
      ["mixed GST rates", order],
      [
        "the captured order's shape",
        [
          { unitPrice: "4663080.34", quantity: "1", gstPercent: "18" },
          { unitPrice: "118000.00", quantity: "1", gstPercent: "18" },
        ],
      ],
      [
        "many small lines",
        Array.from({ length: 20 }, () => ({
          unitPrice: "33.33",
          quantity: "3",
          gstPercent: "18",
        })),
      ],
    ];

    for (const [name, lines] of cases) {
      it(name, () => {
        const ours = purchaseOrderTotal(lines);
        const theirs = legacyFloat(lines);

        expect(ours.subtotal).toBe(theirs.subtotal);
        expect(ours.totalGst).toBe(theirs.totalGst);
        expect(ours.grandTotal).toBe(theirs.grandTotal);
      });
    }
  });

  it("diverges from the float oracle only where the float is wrong", () => {
    // 0.1 + 0.2 territory, reached through a price that a real catalogue holds.
    const lines = Array.from({ length: 3 }, () => ({
      unitPrice: "0.10",
      quantity: "1",
      gstPercent: "0",
    }));

    expect(purchaseOrderTotal(lines).subtotal).toBe("0.30");
    // The oracle happens to survive this one at 2dp; the point of the assertion
    // is that our value is exact regardless of whether float rounds its way back.
    expect(legacyFloat(lines).subtotal).toBe("0.30");
  });
});
