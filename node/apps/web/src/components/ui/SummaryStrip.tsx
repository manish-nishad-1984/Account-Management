import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * A document's figures on one line — Sub total, Discount, Total GST, TDS,
 * Adjustment, and the total itself picked out at the end.
 *
 * WHY A STRIP AND NOT SIX BOXES (client request, 21 Sep 2026, from a mockup):
 * the totals were six bordered tiles in a two-column grid, which is three rows
 * of furniture for six numbers and reads as six unrelated facts. One ruled strip
 * reads as one calculation, ends with the number people are actually looking
 * for, and costs about a third of the height — which is what lets it sit inside
 * the products card, under the lines it is the sum of, rather than in a section
 * of its own further down the page.
 *
 * The last entry is `strong`: a larger, boxed total, because a document has ONE
 * figure that matters and the rest are how it was reached.
 *
 * Every figure is `tabular`, so the digits line up down the strip rather than
 * wandering with the width of each glyph.
 */
export interface SummaryItem {
  label: string;
  value: ReactNode;
  /** The figure the document is about; drawn larger, in its own box. */
  strong?: boolean;
}

export function SummaryStrip({ items, className }: { items: SummaryItem[]; className?: string }) {
  return (
    <div
      className={clsx(
        "flex flex-wrap items-stretch gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2",
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className={clsx(
            "min-w-0",
            item.strong &&
              // Pushed to the end of the line and boxed, at every width.
              "ml-auto rounded-md border border-brand-200 bg-brand-50/70 px-3 py-1.5",
          )}
        >
          <div
            className={clsx(
              "text-xs leading-4",
              item.strong ? "font-medium text-brand-800" : "text-slate-500",
            )}
          >
            {item.label}
          </div>
          <div
            className={clsx(
              "tabular mt-0.5 leading-6",
              item.strong ? "text-lg font-semibold text-brand-900" : "text-sm text-slate-800",
            )}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
