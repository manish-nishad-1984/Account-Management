import type { GridExportRequest, PayoutListDetail } from "@accountmanagement/contracts";
import { countLabel, formatListDate, listAmounts, rupees, salaryLabel } from "./message";
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
  detail: Pick<PayoutListDetail, "listDate" | "lines"> & { companyName?: string | null; salaries?: PayoutListDetail["salaries"] },
): ImageRow[] {
  const rows: ImageRow[] = [];
  // A list across every company has none to name.
  const company = detail.companyName?.trim();
  if (company) rows.push({ kind: "company", left: company });
  rows.push({ kind: "title", left: "Payout list", right: formatListDate(detail.listDate) });

  detail.lines.forEach((line, index) => {
    rows.push({ kind: "party", index: index + 1, left: line.partyName, right: rupees(line.amount) });
  });

  // Salaries after the parties, numbered on (client, 23 Oct 2026).
  const salaries = detail.salaries ?? [];
  salaries.forEach((one, index) => {
    rows.push({ kind: "party", index: detail.lines.length + index + 1, left: salaryLabel(one), right: rupees(one.amount) });
  });

  rows.push({
    kind: "total",
    left: `Total (${countLabel(detail.lines.length, salaries.length)})`,
    right: rupees(sumAmounts(listAmounts(detail))),
  });
  return rows;
}

/**
 * THE SAME LIST AS AN EXCEL SHEET, row for row with the picture (client,
 * 22 Oct 2026): the company and "Payout list" with its date across the top, each
 * party and its amount, the total last. No serial number. The amounts go in as
 * figures, so the sheet adds up in Excel.
 */
export function buildPayoutSheet(
  detail: Pick<PayoutListDetail, "listDate" | "lines"> & { companyName?: string | null; salaries?: PayoutListDetail["salaries"] },
): GridExportRequest {
  const company = detail.companyName?.trim();
  const date = formatListDate(detail.listDate);
  const parties = detail.lines.length;
  return {
    sheetName: "Payout list",
    fileName: ["Payout list", company, date].filter(Boolean).join(" "),
    columns: [
      { header: company ? `${company} - Payout list` : "Payout list", width: 40, align: "left" },
      { header: date, width: 18, align: "right" },
    ],
    rows: [
      ...detail.lines.map((line) => [line.partyName, line.amount]),
      ...(detail.salaries ?? []).map((one) => [salaryLabel(one), one.amount]),
      [`Total (${countLabel(parties, (detail.salaries ?? []).length)})`, sumAmounts(listAmounts(detail))],
    ],
  };
}
