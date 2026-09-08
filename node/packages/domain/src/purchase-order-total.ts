/**
 * Purchase order arithmetic — server-authoritative, and NOT blocked by B-2.
 *
 * WHY THIS IS A SEPARATE FILE FROM `invoice-total.ts`
 *
 * `08-create-purchase-order.md` point 5 says PO totals become server-authoritative
 * in the port and that this is "the reason the GST question (B-2) has to be
 * answered first". That reasoning holds for invoices and does NOT hold here, and
 * the difference was established by reading the screen rather than assuming it:
 *
 *  1. `Views/PurchaseMaster/CreatePurchaseOrder.cshtml` loads exactly ONE script
 *     from `moduls/` — `purchaserequestscript.js`. The three-way `updateTotals`
 *     collision that D-JS-1 describes happens on `CreateInvoice.cshtml`, which
 *     loads three. There is nothing here to collide.
 *
 *  2. That view contains ZERO occurrences of `discount`, `tds`, `roundoff` and
 *     `round-off` — counted, not sampled. Discount, TDS and the whole-rupee
 *     round-off are precisely what the three calculators disagree about, so the
 *     disagreement has no surface on this screen.
 *
 *  3. The "each calculator sees half the table" defect needs two row classes.
 *     `_GetItemDetailsPartial.cshtml` renders PO rows as `class="product"` and
 *     `updateTotals` iterates `$(".product")`. They match, so the one calculator
 *     that runs sees every row.
 *
 * So a purchase order has exactly one defensible total, and computing it on the
 * server answers no business question by implication. Invoices remain blocked;
 * see `invoice-total.ts` and doc 19 question 2.
 *
 * WHAT THE SOURCE DOES, verbatim from `PurchaseRequestScript.js:1758-1806`:
 *
 *   updateProductTotalAmount:
 *     totalGst    = (price * qty * gst) / 100      -> field, .toFixed(2)
 *     totalAmount = price * qty + totalGst          -> field, .toFixed(2)
 *
 *   updateTotals, over $(".product"):
 *     totalSubtotal += price * qty                  // raw, never rounded per line
 *     totalGst      += <the per-line GST FIELD>     // so: rounded per line
 *     totalAmount    = totalSubtotal + totalGst
 *
 * The asymmetry in that roll-up is real and is reproduced: the subtotal
 * accumulates unrounded products, while the GST accumulates values that were
 * already rounded to 2dp on their way into the row. Rounding the GST per line is
 * also what the printed order shows line by line, and a total that does not equal
 * the visible lines added up is a support call every time.
 *
 * Done in exact decimals rather than float. Unlike `asProduced()` in
 * `invoice-total.ts` there is no reconciliation argument for float here: float is
 * only needed to reproduce a defect, and the defects are all on the other screen.
 */

import { type Decimal, decimal, add, multiply, percentOf, round, sum, format } from "./money.js";

export interface PurchaseOrderLine {
  /** Price of one unit. The PO grid has no discount column. */
  unitPrice: string;
  quantity: string;
  /** GST rate as a percentage, e.g. "18" or "18.00". */
  gstPercent?: string;
}

export interface PurchaseOrderLineTotal {
  /** `unitPrice x quantity`, exact. */
  netAmount: string;
  /** `netAmount x gstPercent / 100`, rounded to 2dp as the row field is. */
  gstAmount: string;
  /** `netAmount + gstAmount`. */
  total: string;
}

export interface PurchaseOrderTotal {
  lines: PurchaseOrderLineTotal[];
  /** Sum of the line net amounts. The screen's "Sub Total". */
  subtotal: string;
  /** Sum of the PER-LINE ROUNDED GST amounts. The screen's "Total GST". */
  totalGst: string;
  /** `subtotal + totalGst`. The screen's "Total Amount". */
  grandTotal: string;
  /** Sum of the line quantities — the grid's quantity footer aggregate. */
  totalQuantity: string;
}

const d = (value: string | undefined): Decimal => decimal(value ?? "0");

/** One line, as `updateProductTotalAmount` computes it. */
export function line(input: PurchaseOrderLine): PurchaseOrderLineTotal {
  const netAmount = multiply(d(input.unitPrice), d(input.quantity));
  // Rounded here because the source writes it into a field with .toFixed(2) and
  // the roll-up then reads that field back. See the note above.
  const gstAmount = round(percentOf(d(input.gstPercent), netAmount), 2);

  return {
    netAmount: format(netAmount),
    gstAmount: format(gstAmount),
    total: format(add(netAmount, gstAmount)),
  };
}

/**
 * The whole order, as `updateTotals` computes it.
 *
 * Every figure is returned as a decimal STRING, like every other money value
 * that crosses a boundary in this system.
 */
export function compute(lines: PurchaseOrderLine[]): PurchaseOrderTotal {
  const computed = lines.map((input) => line(input));

  const subtotal = sum(computed.map((row) => d(row.netAmount)));
  const totalGst = sum(computed.map((row) => d(row.gstAmount)));
  const totalQuantity = sum(lines.map((row) => d(row.quantity)));

  return {
    lines: computed,
    subtotal: format(subtotal),
    totalGst: format(totalGst),
    grandTotal: format(add(subtotal, totalGst)),
    // Quantity is a decimal like every other quantity in this system; the legacy
    // grid renders it with `.text(TotalItemQuantity)` and no rounding at all.
    totalQuantity: format(totalQuantity),
  };
}
