import { decimal, format, subtract, sum, type Decimal } from "./money.js";

/**
 * The GST table printed under an invoice's lines: one row per GST rate, with
 * the taxable value and the tax, and the tax split into its central and state
 * halves.
 *
 * FROM THE STORED LINE AMOUNTS, not recalculated. A printed invoice has to agree
 * with the invoice it prints, and the stored `netAmount` and `gstAmount` are
 * what the totals were built from. Recalculating here would be a second opinion
 * that could disagree with the first by a paisa.
 *
 * TWO DELIBERATE DIFFERENCES FROM THE SOURCE (`PrintSalesInvoiceDetails.cshtml`):
 *
 *  - The source's taxable value is `quantity x price`, BEFORE the discount, while
 *    the tax next to it was charged on the price AFTER it. On a discounted line
 *    the printed rate x taxable value does not equal the printed tax. Here the
 *    taxable value is the net amount the tax was actually charged on.
 *  - The source rounds each half on its own, so the halves can add up to a paisa
 *    more or less than the GST. Here the state half is the GST minus the
 *    central half, so the two always add up to the tax on the invoice.
 */

export interface TaxSummaryLine {
  hsnCode?: string | null;
  gstPercent: string | null;
  /** After discount, before GST. */
  netAmount: string;
  gstAmount: string;
}

export interface TaxSummaryRow {
  /** "18.00" — the rate the row groups. Lines with no GST group under "0.00". */
  gstPercent: string;
  /** Half of the rate, for the CGST and SGST columns. */
  halfPercent: string;
  /** Distinct HSN codes of the lines in this row, in first-seen order. */
  hsnCodes: string[];
  taxableValue: string;
  gstAmount: string;
  centralTax: string;
  stateTax: string;
}

export interface TaxSummary {
  rows: TaxSummaryRow[];
  taxableValue: string;
  gstAmount: string;
  centralTax: string;
  stateTax: string;
}

const HALF_PAISA = 5_000n; // money.ts works in 10^-6, so half a paisa is 5000

/** Half an amount, rounded DOWN to the paisa — the other half takes the odd one. */
function halfToPaisa(value: Decimal): Decimal {
  const half = value / 2n;
  return half - (half % (HALF_PAISA * 2n));
}

export function summariseTax(lines: TaxSummaryLine[]): TaxSummary {
  const groups = new Map<string, { hsn: string[]; net: Decimal[]; gst: Decimal[] }>();

  for (const line of lines) {
    const rate = format(decimal(line.gstPercent ?? "0"));
    const group = groups.get(rate) ?? { hsn: [], net: [], gst: [] };
    const hsn = line.hsnCode?.trim();
    if (hsn && !group.hsn.includes(hsn)) group.hsn.push(hsn);
    group.net.push(decimal(line.netAmount));
    group.gst.push(decimal(line.gstAmount));
    groups.set(rate, group);
  }

  const rows = [...groups.entries()]
    .sort(([a], [b]) => (decimal(a) < decimal(b) ? -1 : decimal(a) > decimal(b) ? 1 : 0))
    .map(([rate, group]) => {
      const gst = sum(group.gst);
      const central = halfToPaisa(gst);
      return {
        gstPercent: rate,
        halfPercent: format(decimal(rate) / 2n, 3).replace(/0$/, ""),
        hsnCodes: group.hsn,
        taxable: sum(group.net),
        gst,
        central,
        state: subtract(gst, central),
      };
    });

  return {
    rows: rows.map((row) => ({
      gstPercent: row.gstPercent,
      halfPercent: row.halfPercent,
      hsnCodes: row.hsnCodes,
      taxableValue: format(row.taxable),
      gstAmount: format(row.gst),
      centralTax: format(row.central),
      stateTax: format(row.state),
    })),
    taxableValue: format(sum(rows.map((row) => row.taxable))),
    gstAmount: format(sum(rows.map((row) => row.gst))),
    centralTax: format(sum(rows.map((row) => row.central))),
    stateTax: format(sum(rows.map((row) => row.state))),
  };
}
