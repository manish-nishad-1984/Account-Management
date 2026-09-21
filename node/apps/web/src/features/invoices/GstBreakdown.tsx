import clsx from "clsx";
import { useMemo } from "react";
import { summariseTax } from "@accountmanagement/domain";
import { formatMoney } from "../../lib/format";

/**
 * THE GST SPLIT, RATE BY RATE, under the totals of an order or an invoice
 * (client request, 17 Sep 2026).
 *
 * The forms used to show one lump — "Total GST ₹1,02,589.23" — and the number
 * that anyone actually has to reconcile against is the CGST and SGST halves, the
 * way the printed document and the GST return show them. This puts what the
 * printed document already computed onto the screen the figures are typed into,
 * so the two cannot first disagree at print time.
 *
 * `summariseTax` IS THE ONE IMPLEMENTATION, imported from `packages/domain` and
 * shared with `print-documents.repository.ts`. A second copy here is exactly how
 * the invoice on screen and the invoice on paper start differing by a paisa.
 *
 * ALWAYS HALF AND HALF, never IGST — the business chose this on 17 Sep 2026. A
 * rate of 18% shows as CGST 9% + SGST 9%. Inter-state supply, where the whole
 * rate is IGST instead, would need the supplier's and the site's states compared,
 * which nothing in this system does yet; it is a separate piece of work, not a
 * detail of this one.
 *
 * The odd paisa goes to the state half: `summariseTax` rounds the central half
 * down and takes the state half as the remainder, so CGST + SGST always equals
 * the GST on the document. Halving each independently is what lets a printed
 * invoice be off by a paisa against itself.
 */
export interface GstBreakdownLine {
  gstPercent: string | null;
  /** After discount, before GST. */
  netAmount: string;
  gstAmount: string;
}

/**
 * A rate as a person writes it: "9.00" -> "9", "2.50" -> "2.5".
 *
 * The domain formats rates to two decimals because it is money-adjacent, but a
 * GST rate is quoted the short way on every invoice and in the attachment the
 * business supplied. Only trailing zeros go; 2.5% keeps its half.
 */
const ratePercent = (value: string): string =>
  value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;

export function GstBreakdown({
  lines,
  className,
}: {
  lines: GstBreakdownLine[];
  /** Placing, from the section that holds it — a column span, typically. */
  className?: string;
}) {
  const summary = useMemo(
    () =>
      summariseTax(
        lines.map((line) => ({
          gstPercent: line.gstPercent,
          netAmount: line.netAmount,
          gstAmount: line.gstAmount,
        })),
      ),
    [lines],
  );

  // Lines that carry no GST produce a 0.00 row that says nothing. A document
  // with no GST at all shows nothing here rather than an empty-looking table.
  const rows = summary.rows.filter((row) => Number(row.gstAmount) !== 0);
  if (rows.length === 0) return null;

  /*
    ONE LINE WHEN THERE IS ONE RATE (client request, 21 Sep 2026, from a mockup).
    Nearly every document this business raises is taxed at a single rate, and for
    one row a column header is a second line of furniture above five numbers. So
    at one rate the headings move INTO the cells as quiet inline labels — "Taxable
    value 2,525.00" — and the real `<thead>` goes `sr-only`, which keeps the
    column association a screen reader announces and keeps the table structure
    the tests read rows from. At two rates or more the headings come back, where
    a shared header is what makes the rates comparable.
  */
  const compact = rows.length === 1;
  const label = (text: string) =>
    compact ? (
      <span aria-hidden className="mr-1.5 font-normal text-slate-500">
        {text}
      </span>
    ) : null;

  return (
    // The rule and the tint go on the wrapper, never on the `<table>`: preflight
    // sets `border-collapse: collapse`, under which a table ignores padding and
    // will not round its own corners.
    <div
      className={clsx(
        className,
        compact && "rounded-lg border border-slate-200 bg-slate-50/70 px-3",
      )}
    >
      <table className="w-full text-xs">
        <caption className="sr-only">GST split into its central and state halves</caption>
        <thead className={compact ? "sr-only" : undefined}>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-slate-500">
            <th scope="col" className="py-1.5 pr-2 font-medium">
              Rate
            </th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium">
              Taxable value
            </th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium">
              CGST
            </th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium">
              SGST
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Total GST
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.gstPercent}
              className={compact ? undefined : "border-b border-line-subtle"}
            >
              <td className={clsx("text-slate-600", compact ? "py-2 pr-3" : "py-1.5 pr-2")}>
                {label("Rate:")}
                {/*
                  "CGST 9% + SGST 9%" is the reconcilable label, not "18%", and
                  it is ONE string rather than interpolated fragments — split
                  across text nodes it cannot be found by label, by a test or by
                  a person using find-in-page.
                */}
                <span className="text-slate-700">
                  {`CGST ${ratePercent(row.halfPercent)}% + SGST ${ratePercent(row.halfPercent)}%`}
                </span>
              </td>
              <td className={clsx("text-right", compact ? "py-2 pr-3" : "py-1.5 pr-2")}>
                {label("Taxable value")}
                <span className="tabular text-slate-700">{formatMoney(row.taxableValue)}</span>
              </td>
              <td className={clsx("text-right", compact ? "py-2 pr-3" : "py-1.5 pr-2")}>
                {label("CGST")}
                <span className="tabular text-slate-700">{formatMoney(row.centralTax)}</span>
              </td>
              <td className={clsx("text-right", compact ? "py-2 pr-3" : "py-1.5 pr-2")}>
                {label("SGST")}
                <span className="tabular text-slate-700">{formatMoney(row.stateTax)}</span>
              </td>
              <td className={clsx("text-right", compact ? "py-2" : "py-1.5")}>
                {label("Total GST")}
                <span className="tabular font-medium text-slate-800">
                  {formatMoney(row.gstAmount)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr className="font-medium text-slate-900">
              <td className="py-1.5 pr-2">All rates</td>
              <td className="py-1.5 pr-2 text-right">
                <span className="tabular">{formatMoney(summary.taxableValue)}</span>
              </td>
              <td className="py-1.5 pr-2 text-right">
                <span className="tabular">{formatMoney(summary.centralTax)}</span>
              </td>
              <td className="py-1.5 pr-2 text-right">
                <span className="tabular">{formatMoney(summary.stateTax)}</span>
              </td>
              <td className="py-1.5 text-right">
                <span className="tabular">{formatMoney(summary.gstAmount)}</span>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
