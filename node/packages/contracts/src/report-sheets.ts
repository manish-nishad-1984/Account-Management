import { z } from "zod";
import { formatExportDate, formatMoney } from "./format";
import { PAYMENT_DIRECTIONS, type PaymentDirection } from "./payments";
import {
  balancesQuerySchema,
  reportFilterSchema,
  type BalanceRow,
  type BalancesResponse,
  type LedgerResponse,
  type LedgerRow,
} from "./reports";

/**
 * The report exports — the shape of every downloaded file, defined ONCE.
 *
 * `14-reports-and-payments.md` point 3 counts "six exports across three
 * panels". Counting the buttons in the source instead gives ELEVEN, across five
 * screens, and the plan is corrected accordingly:
 *
 *   Payout Summary   Export To Excel, Export To Pdf
 *   Payment Report   Supplier Excel, Export To Excel, Export To Pdf
 *   Sales Report     Export To Excel, Export To Pdf
 *   ---- on screens already shipped, and NOT covered here ----
 *   Purchase Invoice list   Export To Excel, Export To Pdf
 *   Item price history      Export To Excel, Export To Pdf
 *
 * The seven above are what this file describes.
 *
 * THE COLUMNS COME FROM THE SCREEN, NOT FROM THE LEGACY SHEET, in one place:
 * the legacy ledger sheet writes `Invoice No | Date | Site | Group | Supplier`
 * while the ported grid shows the party before the site. The export renders
 * what the grid shows, so someone checking a file against the screen reads the
 * columns in the same order. Every other column, and every label, matches.
 */

/** A column, as both the spreadsheet and the PDF need it. */
export interface ReportSheetColumn {
  header: string;
  /** Spreadsheet width in characters; the PDF scales these to the page. */
  width: number;
  align: "left" | "right";
}

/**
 * The words the two directions use for the same three numbers.
 *
 * Identical to `LedgerPage.tsx` and `SalesReportPage.tsx`, because an export
 * headed `Credit` for a sales report that says `Invoiced` on screen is a
 * support call.
 */
export function reportLabels(direction: PaymentDirection): {
  party: string;
  credit: string;
  debit: string;
  net: string;
} {
  return direction === "in"
    ? { party: "Customer", credit: "Invoiced", debit: "Received", net: "Outstanding" }
    : { party: "Supplier", credit: "Credit", debit: "Debit", net: "Net" };
}

export function ledgerSheetColumns(direction: PaymentDirection): ReportSheetColumn[] {
  const labels = reportLabels(direction);
  return [
    { header: "Document", width: 26, align: "left" },
    { header: "Date", width: 12, align: "left" },
    { header: labels.party, width: 28, align: "left" },
    { header: "Site", width: 22, align: "left" },
    { header: "Group", width: 18, align: "left" },
    { header: labels.credit, width: 16, align: "right" },
    { header: labels.debit, width: 16, align: "right" },
    { header: "Balance", width: 16, align: "right" },
  ];
}

export function balancesSheetColumns(direction: PaymentDirection): ReportSheetColumn[] {
  const labels = reportLabels(direction);
  return [
    { header: "Site", width: 26, align: "left" },
    { header: labels.party, width: 32, align: "left" },
    { header: labels.credit, width: 18, align: "right" },
    { header: labels.debit, width: 18, align: "right" },
    { header: labels.net, width: 18, align: "right" },
  ];
}

/**
 * The Document cell — `<number> (<type>)`, matching the legacy sheet exactly.
 *
 * The source builds this twice, in two exporters, with the same rule: prefer
 * the supplier's own invoice number, fall back to the internal one, and append
 * either the invoice type or, for the two sentinel numbers, the description.
 * Here `displayNo` has already resolved which number to show — that decision
 * lives in the repository beside the query — so only the suffix is left.
 *
 * An empty label yields no brackets rather than " ()", which the legacy version
 * also gets right and which is easy to lose when rewriting.
 */
export function ledgerDocumentCell(row: LedgerRow): string {
  return row.label ? `${row.displayNo} (${row.label})` : row.displayNo;
}

export function ledgerSheetRow(row: LedgerRow): string[] {
  return [
    ledgerDocumentCell(row),
    formatExportDate(row.documentDate),
    row.partyName,
    row.siteName ?? "",
    row.siteGroupName ?? "",
    row.effect === "credit" ? formatMoney(row.credit) : "",
    row.effect === "debit" ? formatMoney(row.debit) : "",
    formatMoney(row.balance),
  ];
}

export function balanceSheetRow(row: BalanceRow): string[] {
  return [
    row.siteName ?? "",
    row.partyName,
    formatMoney(row.credit),
    formatMoney(row.debit),
    formatMoney(row.netAmount),
  ];
}

/**
 * The Total row.
 *
 * It is the sum of the rows in the file, and this is the one place where the
 * port refuses to reproduce what the legacy sheet does. There, the three
 * footer cells are `TotalCreadit`, `TotalPurchase` and `TotalPending` — figures
 * the API computed with the D7 arithmetic, which adds purchase returns to the
 * balance while the rows beside them subtract. So the legacy file's own Total
 * does not equal its own column. Both come from one query here.
 */
export function ledgerFooterRow(response: LedgerResponse): string[] {
  return [
    "Total",
    "",
    "",
    "",
    "",
    formatMoney(response.totalCredit),
    formatMoney(response.totalDebit),
    formatMoney(response.closingBalance),
  ];
}

export function balancesFooterRow(response: BalancesResponse): string[] {
  return [
    "Total",
    "",
    formatMoney(response.totalCredit),
    formatMoney(response.totalDebit),
    formatMoney(response.closingBalance),
  ];
}

/**
 * How many rows an export may contain.
 *
 * The legacy exports have no limit because their grids have no paging — the
 * whole filtered set is already in the browser. Here the grid pages and the
 * export does not, so this is the only place that asks the database for an
 * unbounded set, and it needs a stop.
 *
 * 20,000 is above any real filtered ledger (the live database holds fewer than
 * 2,000 purchase invoices in total) and far below the point where holding the
 * rows and the rendered file in memory together matters. Over it, the request
 * is REFUSED with a message naming the filters, rather than silently truncated
 * — a report that quietly stops at row 20,000 is worse than no report, because
 * its Total looks authoritative.
 */
export const REPORT_EXPORT_MAX_ROWS = 20_000;

export const REPORT_EXPORT_FORMATS = ["xlsx", "pdf"] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

/**
 * The export request: every filter the panel carries, and no paging.
 *
 * `limit` and `offset` are deliberately absent. An export of page 3 is not a
 * thing anyone wants, and accepting them would make the Total mean something
 * different from the file it sits in.
 */
export const ledgerExportQuerySchema = reportFilterSchema;
export const balancesExportQuerySchema = balancesQuerySchema;
export const salesExportQuerySchema = balancesQuerySchema.omit({ direction: true });

/**
 * `Ledger-2026-09-09.xlsx`.
 *
 * A stable, sortable, human name. The legacy files are named
 * `<guid>_ReportDetails.xlsx`, so a user's Downloads folder fills with
 * identical-looking rows they cannot tell apart — and two exports of different
 * filters on the same day are indistinguishable there. The date is the day the
 * file was made, which is the one thing that is always true about it.
 */
export function reportFileName(
  kind: "Ledger" | "Balances" | "Sales-Report" | "Ledger-by-supplier",
  on: Date,
  format: ReportExportFormat,
): string {
  const stamp = on.toISOString().slice(0, 10);
  return `${kind}-${stamp}.${format}`;
}

/** The direction is a route concern for sales, so it is re-stated here. */
export const reportDirectionSchema = z.enum(PAYMENT_DIRECTIONS);
