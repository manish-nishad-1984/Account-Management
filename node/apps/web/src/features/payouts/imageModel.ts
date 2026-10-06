import type { PayoutListDetail } from "@accountmanagement/contracts";
import { formatListDate, rupees } from "./message";
import { sumAmounts } from "./decimal";

/**
 * What the picture of a payout list says, row by row, before any of it is drawn
 * (client request, 6 Oct 2026: the list goes out on WhatsApp as an image).
 *
 * Kept apart from the canvas so it can be tested: jsdom has no canvas, and the
 * things worth pinning are in the words and the order - the party and its amount,
 * its bills under it, and the TOTAL LAST, added up from the rows shown.
 */
export type ImageRow =
  | { kind: "title"; left: string; right: string }
  | { kind: "subtitle"; left: string }
  | { kind: "party"; index: number; left: string; right: string }
  | { kind: "bill"; left: string; right: string }
  | { kind: "total"; left: string; right: string };

export function buildImageRows(
  detail: Pick<PayoutListDetail, "listDate" | "title" | "lines">,
): ImageRow[] {
  const rows: ImageRow[] = [{ kind: "title", left: "Payout list", right: formatListDate(detail.listDate) }];
  const title = detail.title?.trim();
  if (title) rows.push({ kind: "subtitle", left: title });

  detail.lines.forEach((line, index) => {
    rows.push({ kind: "party", index: index + 1, left: line.partyName, right: rupees(line.amount) });
    for (const bill of line.invoices ?? []) {
      const where = [bill.documentDate ? formatListDate(bill.documentDate) : null, bill.siteName]
        .filter(Boolean)
        .join(" · ");
      rows.push({
        kind: "bill",
        left: where ? `${bill.displayNo}  ·  ${where}` : bill.displayNo,
        right: rupees(bill.amount),
      });
    }
  });

  rows.push({
    kind: "total",
    left: `Total (${detail.lines.length} ${detail.lines.length === 1 ? "party" : "parties"})`,
    right: rupees(sumAmounts(detail.lines.map((line) => line.amount))),
  });
  return rows;
}
