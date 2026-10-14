import type { PayoutListDetail } from "@accountmanagement/contracts";
import { formatListDate, rupees } from "./message";
import { sumAmounts } from "./decimal";

/**
 * What the picture of a payout list says, row by row, before any of it is drawn.
 *
 * Kept apart from the canvas so it can be tested: jsdom has no canvas, and the
 * things worth pinning are in the words and the order - each party and its
 * amount, and the TOTAL LAST, added up from the rows shown.
 *
 * Nothing else goes on it (client request, 8 Oct 2026): the picture is copied and
 * forwarded to the owner's boss, who wants the party names and the figures - no
 * bills under them, no title.
 */
/** The company the list was built for, across the top (client request, 14 Oct 2026). */
export type ImageRow =
  | { kind: "company"; left: string }
  | { kind: "title"; left: string; right: string }
  | { kind: "party"; index: number; left: string; right: string }
  | { kind: "total"; left: string; right: string };

export function buildImageRows(
  detail: Pick<PayoutListDetail, "listDate" | "lines"> & { companyName?: string | null },
): ImageRow[] {
  const rows: ImageRow[] = [];
  // A list across every company has none to name.
  const company = detail.companyName?.trim();
  if (company) rows.push({ kind: "company", left: company });
  rows.push({ kind: "title", left: "Payout list", right: formatListDate(detail.listDate) });

  detail.lines.forEach((line, index) => {
    rows.push({ kind: "party", index: index + 1, left: line.partyName, right: rupees(line.amount) });
  });

  rows.push({
    kind: "total",
    left: `Total (${detail.lines.length} ${detail.lines.length === 1 ? "party" : "parties"})`,
    right: rupees(sumAmounts(detail.lines.map((line) => line.amount))),
  });
  return rows;
}
