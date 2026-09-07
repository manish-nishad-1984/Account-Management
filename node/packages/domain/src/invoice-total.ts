import {
  decimal,
  format,
  multiply,
  percentOf,
  round,
  roundToWholeRupeeAsProduced,
  subtract,
  sum,
  type Decimal,
} from "./money.js";

/**
 * Invoice arithmetic — the calculation the legacy system does in the browser.
 *
 * TWO FUNCTIONS, DELIBERATELY.
 *
 *   `asProduced()` reproduces what the shipped JavaScript computes, defects and
 *   all, so a historical invoice can be reconciled against what was actually
 *   issued.
 *
 *   `corrected()` is the arithmetic the business believes it is getting.
 *
 * They differ, and the difference is the whole of question 1 in
 * 19-Business-Decisions-Required.md. Keeping both means the difference can be
 * measured per invoice instead of argued about.
 *
 * WHAT THE SOURCE ACTUALLY DOES — verified by running it, not by reading it.
 * `Migration-Assessment/tools/calculator-harness/run.mjs` loads the real script
 * files against the real markup and prints the results.
 *
 *  1. There is NO server-side calculation. `Math.Round` appears zero times in
 *     the C# codebase, and the repository layer only assigns whatever the
 *     browser posted. The server never checks that the total matches the lines.
 *
 *  2. On Create Invoice, THREE scripts define `updateTotals` and the last one
 *     loaded wins. `PurchaseRequestScript.js` — the PURCHASE ORDER calculator —
 *     wins, and it has no discount, no TDS and no round-off.
 *
 *  3. Worse than the load order: the two calculators read DIFFERENT ROWS.
 *     The invoice version iterates `$(".productRow")` and reads fields by class;
 *     the purchase-order version iterates `$(".product")` and reads them by id.
 *     Rows rendered with the page carry `productRow` and a class; rows added by
 *     AJAX carry `product` and only an id. Each calculator can see exactly half
 *     the table, and no load order sees all of it.
 *
 *  4. The grand total is rounded to a WHOLE RUPEE, with exactly .50 rounding
 *     DOWN. Nothing in the assessment recorded this; see
 *     `roundToWholeRupeeAsProduced`.
 *
 *  5. Sales computes per-line GST on (price − discount) but rolls up the VISIBLE
 *     price, and its total has no discount term at all:
 *     `total = subtotal + gst − tds + roundOff`. The discount is displayed and
 *     only actually applied if a different event already overwrote the price
 *     field.
 */

/** One line of a document, with money as decimal STRINGS. */
export interface InvoiceLine {
  /** Price of one unit, before discount. */
  unitPrice: string;
  quantity: string;
  /** Discount in rupees PER UNIT, as the legacy screens hold it. */
  discountPerUnit?: string;
  /** GST rate as a percentage, e.g. "18" or "18.00". */
  gstPercent?: string;
}

export interface InvoiceCharges {
  /** Tax deducted at source, subtracted from the total. */
  tds?: string;
  /** A manual adjustment, ADDED to the total. Negative values are allowed. */
  roundOff?: string;
}

export interface LineTotal {
  /** `(unitPrice − discountPerUnit) x quantity`, before GST. */
  netAmount: string;
  discountAmount: string;
  gstAmount: string;
  /** `netAmount + gstAmount`. */
  total: string;
}

export interface InvoiceTotal {
  lines: LineTotal[];
  subtotal: string;
  totalDiscount: string;
  totalGst: string;
  tds: string;
  roundOff: string;
  /** What the customer is charged. */
  grandTotal: string;
}

const d = (value: string | undefined): Decimal => decimal(value ?? "0");

/**
 * The line, calculated correctly.
 *
 * Rounding is applied PER LINE and the rounded values are then summed — not
 * sum-then-round. That ordering is the source's (`.toFixed(2)` on each line) and
 * it is preserved deliberately: it is what the printed invoice shows line by
 * line, and a total that does not equal the visible lines added up is a support
 * call every time.
 */
function correctedLine(line: InvoiceLine): { totals: LineTotal; raw: Record<string, Decimal> } {
  const quantity = d(line.quantity);
  const discountPerUnit = d(line.discountPerUnit);

  const netUnitPrice = subtract(d(line.unitPrice), discountPerUnit);
  const netAmount = round(multiply(netUnitPrice, quantity));
  const discountAmount = round(multiply(discountPerUnit, quantity));
  const gstAmount = round(percentOf(d(line.gstPercent), netAmount));
  const total = netAmount + gstAmount;

  return {
    totals: {
      netAmount: format(netAmount),
      discountAmount: format(discountAmount),
      gstAmount: format(gstAmount),
      total: format(total),
    },
    raw: { netAmount, discountAmount, gstAmount },
  };
}

export interface CorrectedOptions {
  /**
   * Round the grand total to a whole rupee, as production does.
   *
   * DEFAULTS TO TRUE, because that is what every issued invoice did. Setting it
   * false is not a bug fix that can be made quietly — it changes what customers
   * are charged, and needs the answer to question 1.
   */
  roundGrandTotalToRupee?: boolean;
}

/**
 * The arithmetic the business believes it is getting: exact decimals, every
 * line counted, discount subtracted, TDS subtracted, round-off added.
 */
export function corrected(
  lines: InvoiceLine[],
  charges: InvoiceCharges = {},
  { roundGrandTotalToRupee = true }: CorrectedOptions = {},
): InvoiceTotal {
  const computed = lines.map(correctedLine);

  const subtotal = sum(computed.map((l) => l.raw.netAmount!));
  const totalDiscount = sum(computed.map((l) => l.raw.discountAmount!));
  const totalGst = sum(computed.map((l) => l.raw.gstAmount!));

  const tds = d(charges.tds);
  const roundOff = d(charges.roundOff);

  const beforeRounding = subtotal + totalGst - tds + roundOff;
  const grandTotal = roundGrandTotalToRupee
    ? roundToWholeRupeeAsProduced(beforeRounding)
    : round(beforeRounding);

  return {
    lines: computed.map((l) => l.totals),
    subtotal: format(subtotal),
    totalDiscount: format(totalDiscount),
    totalGst: format(totalGst),
    tds: format(tds),
    roundOff: format(roundOff),
    grandTotal: format(grandTotal),
  };
}

/** Which of the legacy calculators to reproduce. They do not agree. */
export type LegacyCalculator =
  /**
   * `PurchaseRequestScript.js:1758-1806`. The one that WINS on Create Invoice.
   * No discount, no TDS, no round-off, no whole-rupee rounding. GST is charged
   * on the GROSS price.
   */
  | "purchase-order"
  /**
   * `InvoiceMasterScript.js:941-1019`. Overwritten on Create Invoice, and the
   * only one that reads TDS and round-off. GST is charged on the price field,
   * which a separate handler has already overwritten with the discounted value —
   * so whether the discount applies depends on whether that handler ran.
   */
  | "purchase-invoice"
  /**
   * `SalesInvoiceMasterScript.js:267-394`. Per-line GST on (hidden price −
   * discount), roll-up on the visible price, and no discount term in the total.
   */
  | "sales";

/**
 * Reproduces a legacy calculator, in float arithmetic, defects included.
 *
 * FLOAT ON PURPOSE. The point is to reproduce what was issued, and what was
 * issued came out of `parseFloat` and `.toFixed(2)`. Doing this in decimals
 * would produce the RIGHT answer, which is exactly what makes it useless for
 * reconciliation.
 *
 * `discountApplied` models the source's hidden dependency: on the invoice and
 * sales screens the discount reaches the total only because a separate event
 * handler overwrote the price field first. Pass false to see what a document
 * saved without that handler firing looks like.
 */
export function asProduced(
  lines: InvoiceLine[],
  charges: InvoiceCharges = {},
  calculator: LegacyCalculator = "purchase-order",
  { discountApplied = true }: { discountApplied?: boolean } = {},
): InvoiceTotal {
  const num = (value: string | undefined) => Number.parseFloat(value ?? "0") || 0;
  const fixed = (value: number) => value.toFixed(2);

  let subtotal = 0;
  let totalGst = 0;
  let totalDiscount = 0;
  const lineTotals: LineTotal[] = [];

  for (const line of lines) {
    const quantity = num(line.quantity);
    const gross = num(line.unitPrice);
    const discountPerUnit = num(line.discountPerUnit);
    const gstPercent = num(line.gstPercent);

    // Which price the GST is charged on is the difference between the three.
    const priceForGst =
      calculator === "purchase-order" || !discountApplied ? gross : gross - discountPerUnit;
    // And which price the ROLL-UP sums, which is not always the same one.
    const priceForSubtotal =
      calculator === "purchase-order" ? gross : discountApplied ? gross - discountPerUnit : gross;

    const gstAmount = Number.parseFloat(fixed((priceForGst * quantity * gstPercent) / 100));
    const netAmount = priceForSubtotal * quantity;

    subtotal += netAmount;
    totalGst += gstAmount;
    totalDiscount += discountPerUnit * quantity;

    lineTotals.push({
      netAmount: fixed(netAmount),
      discountAmount: fixed(discountPerUnit * quantity),
      gstAmount: fixed(gstAmount),
      total: fixed(netAmount + gstAmount),
    });
  }

  // The purchase-ORDER calculator never reads these two fields. That is finding
  // D-JS-1: on Create Invoice it is the one that runs, so the TDS a user typed
  // is silently discarded.
  const readsCharges = calculator !== "purchase-order";
  const tds = readsCharges ? num(charges.tds) : 0;
  const roundOff = readsCharges ? num(charges.roundOff) : 0;

  let grandTotal = subtotal + totalGst - tds + roundOff;

  // And only the invoice and sales calculators round to a whole rupee.
  if (readsCharges) {
    const fraction = grandTotal - Math.floor(grandTotal);
    grandTotal = fraction <= 0.5 ? Math.floor(grandTotal) : Math.ceil(grandTotal);
  }

  return {
    lines: lineTotals,
    subtotal: fixed(subtotal),
    totalDiscount: fixed(totalDiscount),
    totalGst: fixed(totalGst),
    tds: fixed(tds),
    roundOff: fixed(roundOff),
    grandTotal: fixed(grandTotal),
  };
}

/**
 * What re-issuing a historical document would change, in rupees.
 *
 * This is the number question 1 asks the business to accept or refuse, and it
 * can now be produced for every invoice in the database rather than estimated.
 */
export function drift(
  lines: InvoiceLine[],
  charges: InvoiceCharges = {},
  calculator: LegacyCalculator = "purchase-order",
): { asProduced: string; corrected: string; difference: string } {
  const legacy = asProduced(lines, charges, calculator);
  const fixedUp = corrected(lines, charges);
  return {
    asProduced: legacy.grandTotal,
    corrected: fixedUp.grandTotal,
    difference: format(decimal(fixedUp.grandTotal) - decimal(legacy.grandTotal)),
  };
}
