import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  REPORT_EXPORT_MAX_ROWS,
  balanceSheetRow,
  balancesFooterRow,
  balancesSheetColumns,
  formatExportDate,
  formatMoney,
  ledgerFooterRow,
  ledgerSheetColumns,
  ledgerSheetRow,
  reportLabels,
  type BalancesQuery,
  type BalancesResponse,
  type LedgerResponse,
  type LedgerRow,
  type ReportFilter,
  type ReportSheetColumn,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { companies, sites, siteGroups, suppliers } from "../../db/schema";
import { renderTablePdf } from "../../common/pdf/table-pdf";
import { writeReportWorkbook, type ReportSheetBlock } from "../../common/spreadsheet/report-workbook";
import { ReportsRepository } from "./reports.repository";

/**
 * The seven report downloads.
 *
 * `14-reports-and-payments.md` point 3 says "Six exports across three panels.
 * Phase 5 makes them async jobs." Both halves of that are revisited here.
 *
 * THE COUNT IS WRONG. Counting `onclick` handlers in the legacy views rather
 * than panels gives ELEVEN export buttons across five screens. Seven belong to
 * the three report screens and are built here; the remaining four sit on the
 * purchase invoice list and the item price history panel, both already shipped
 * without them, and are now their own row in PLAN.md rather than a line item
 * inside this one.
 *
 * THEY ARE NOT ASYNC JOBS, and should not be. A job queue is the right answer
 * when a report takes long enough that a request times out; the largest export
 * this system can produce is the whole ledger, which is bounded at
 * `REPORT_EXPORT_MAX_ROWS` and renders in well under a second against the live
 * data (fewer than 2,000 purchase invoices exist in total). Making it a job
 * would add Redis to a deployment that does not otherwise need it — the same
 * decision §5o took for the Item Master import, and for the same reason.
 * Revisit it the day an export genuinely times out.
 */
@Injectable()
export class ReportExportService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly reports: ReportsRepository,
  ) {}

  /**
   * Every row the filter selects, in one response.
   *
   * The export deliberately does not page — see `report-sheets.ts` — so this is
   * the only caller in the system that asks for an unbounded set, and the guard
   * is here rather than in the schema. Over the cap the request is REFUSED,
   * naming the count and what to do, rather than truncated: a file that stops
   * silently at row twenty thousand still carries a Total that looks
   * authoritative, and nobody checks the row count of a spreadsheet they asked
   * for.
   */
  private async ledgerAll(filter: ReportFilter): Promise<LedgerResponse> {
    const first = await this.reports.ledger(filter, { limit: 1, offset: 0 });
    this.assertExportable(first.total);
    return this.reports.ledger(filter, { limit: REPORT_EXPORT_MAX_ROWS, offset: 0 });
  }

  private async balancesAll(filter: BalancesQuery): Promise<BalancesResponse> {
    const first = await this.reports.balances(filter, { limit: 1, offset: 0 });
    this.assertExportable(first.total);
    return this.reports.balances(filter, { limit: REPORT_EXPORT_MAX_ROWS, offset: 0 });
  }

  private assertExportable(total: number): void {
    if (total > REPORT_EXPORT_MAX_ROWS) {
      throw new BadRequestException(
        `This report has ${total.toLocaleString("en-IN")} rows, and an export holds ` +
          `${REPORT_EXPORT_MAX_ROWS.toLocaleString("en-IN")}. Narrow it with a date range, ` +
          `a site or a party and try again.`,
      );
    }
  }

  /**
   * The caption block: which filters produced this file.
   *
   * Resolved from the ids SERVER-SIDE rather than taken from the request. The
   * legacy exporters read `invoiceReport.SupplierName` and
   * `invoiceReport.CompanyName` straight off the posted body and write them
   * into the sheet, so the heading of a legacy export is whatever the browser
   * said it was — it can disagree with the rows underneath it, and nothing
   * checks. Here the name is looked up from the same id the query filtered on,
   * so the caption cannot describe a different report from the one below it.
   */
  private async captions(
    filter: ReportFilter & { show?: string },
  ): Promise<{ label: string; value: string }[]> {
    const labels = reportLabels(filter.direction);

    const [company, site, party, group] = await Promise.all([
      this.nameOf(companies, filter.companyId),
      this.nameOf(sites, filter.siteId),
      this.nameOf(suppliers, filter.partyId),
      this.nameOf(siteGroups, filter.siteGroupId),
    ]);

    const period =
      filter.fromDate || filter.toDate
        ? `${formatExportDate(filter.fromDate) || "start"} to ${
            formatExportDate(filter.toDate) || "today"
          }`
        : "All dates";

    return [
      { label: "Company", value: company ?? "All companies" },
      { label: "Site", value: site ?? "All sites" },
      { label: labels.party, value: party ?? `All ${labels.party.toLowerCase()}s` },
      { label: "Group", value: group ?? "All groups" },
      { label: "Period", value: period },
      { label: "Showing", value: filter.show === "outstanding" ? "Outstanding only" : "" },
    ];
  }

  /** One name, or null when the filter was not set. */
  private async nameOf(
    table: typeof companies | typeof sites | typeof suppliers | typeof siteGroups,
    id: string | undefined,
  ): Promise<string | null> {
    if (!id) return null;
    const [row] = await this.db
      .select({ name: table.name })
      .from(table)
      .where(eq(table.id, id))
      .limit(1);
    return row?.name ?? null;
  }

  private captionBlock(captions: { label: string; value: string }[]): ReportSheetBlock {
    const shown = captions.filter((caption) => caption.value !== "");
    return {
      kind: "caption",
      headers: shown.map((caption) => caption.label),
      values: shown.map((caption) => caption.value),
    };
  }

  // ---------------------------------------------------------------- ledger

  async ledgerWorkbook(filter: ReportFilter): Promise<Buffer> {
    const response = await this.ledgerAll(filter);
    const columns = ledgerSheetColumns(filter.direction);
    const captions = await this.captions(filter);

    return writeReportWorkbook("Ledger", [
      this.captionBlock(captions),
      {
        kind: "table",
        columns,
        rows: response.rows.map(ledgerSheetRow),
        footer: ledgerFooterRow(response),
      },
    ]);
  }

  async ledgerPdf(filter: ReportFilter): Promise<Buffer> {
    const response = await this.ledgerAll(filter);
    return renderTablePdf({
      title: filter.direction === "in" ? "Sales ledger" : "Supplier ledger",
      captions: await this.captions(filter),
      columns: ledgerSheetColumns(filter.direction),
      rows: response.rows.map(ledgerSheetRow),
      footer: ledgerFooterRow(response),
      generatedOn: new Date(),
    });
  }

  /**
   * "Supplier Excel" — the same ledger, one BLOCK PER PARTY.
   *
   * The legacy button sits beside Export To Excel and its name suggests it
   * exports one supplier. It does not: `GetInvoiceDetailsBySupplierExcelReport`
   * runs the same query with the same filters, then groups the rows by supplier
   * and writes a repeated header and a per-supplier Total for each group. The
   * only difference from the plain export is the ordering and the sectioning.
   *
   * ONE DEPARTURE. The legacy version groups on `SupplierName`
   * (`GroupBy(i => i.SupplierName)`), so two parties with the same name merge
   * into one section and share a running balance. Grouped on the party id here,
   * and labelled with the name.
   */
  async ledgerBySupplierWorkbook(filter: ReportFilter): Promise<Buffer> {
    const response = await this.ledgerAll(filter);
    const columns = ledgerSheetColumns(filter.direction);
    const captions = await this.captions(filter);

    const blocks: ReportSheetBlock[] = [this.captionBlock(captions)];

    for (const [, rows] of this.groupByParty(response.rows)) {
      blocks.push({
        kind: "table",
        columns,
        rows: rows.map(ledgerSheetRow),
        footer: this.partyFooter(rows, columns),
      });
    }

    return writeReportWorkbook("Ledger by party", blocks);
  }

  /**
   * Rows grouped by party, parties in name order, rows within a party left in
   * the order the ledger produced them — which is already date order, and is
   * the order the running balance was computed in.
   */
  private groupByParty(rows: LedgerRow[]): Map<string, LedgerRow[]> {
    const groups = new Map<string, LedgerRow[]>();
    for (const row of rows) {
      const existing = groups.get(row.partyId);
      if (existing) existing.push(row);
      else groups.set(row.partyId, [row]);
    }

    return new Map(
      [...groups.entries()].sort(([, a], [, b]) =>
        (a[0]?.partyName ?? "").localeCompare(b[0]?.partyName ?? ""),
      ),
    );
  }

  /**
   * A section's Total.
   *
   * The balance cell is the LAST ROW's running balance, not a re-summed figure.
   * The ledger's balance column is computed by a window function partitioned by
   * party, so the final row of a party's section already carries that party's
   * closing balance — recomputing it here would be a second implementation of
   * the arithmetic this whole module exists to have only one of.
   */
  private partyFooter(rows: LedgerRow[], columns: ReportSheetColumn[]): string[] {
    const credit = sumMoney(rows.map((row) => (row.effect === "credit" ? row.credit : "0")));
    const debit = sumMoney(rows.map((row) => (row.effect === "debit" ? row.debit : "0")));
    const closing = rows[rows.length - 1]?.balance ?? "0.00";

    const footer = new Array<string>(columns.length).fill("");
    footer[0] = "Total";
    footer[columns.length - 3] = formatMoney(credit);
    footer[columns.length - 2] = formatMoney(debit);
    footer[columns.length - 1] = formatMoney(closing);
    return footer;
  }

  // -------------------------------------------------------------- balances

  async balancesWorkbook(filter: BalancesQuery, sheetName: string): Promise<Buffer> {
    const response = await this.balancesAll(filter);
    return writeReportWorkbook(sheetName, [
      this.captionBlock(await this.captions(filter)),
      {
        kind: "table",
        columns: balancesSheetColumns(filter.direction),
        rows: response.rows.map(balanceSheetRow),
        footer: balancesFooterRow(response),
      },
    ]);
  }

  async balancesPdf(filter: BalancesQuery, title: string): Promise<Buffer> {
    const response = await this.balancesAll(filter);
    return renderTablePdf({
      title,
      captions: await this.captions(filter),
      columns: balancesSheetColumns(filter.direction),
      rows: response.rows.map(balanceSheetRow),
      footer: balancesFooterRow(response),
      generatedOn: new Date(),
    });
  }
}

/**
 * Sums decimal strings in PAISE, as integers.
 *
 * The same rule as everywhere else in this system: an amount that goes through
 * a JavaScript number stops being the amount. This mirrors the paise arithmetic
 * in `reports.repository.ts`, which sums the same way for the response totals.
 *
 * Note what this is NOT used for: the section's closing balance. That comes
 * from the last row's own balance column, computed by the window function, so
 * the file cannot disagree with the grid about a balance.
 */
function sumMoney(values: string[]): string {
  let paise = 0n;
  for (const value of values) {
    const negative = value.startsWith("-");
    const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
    const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
    paise += negative ? -amount : amount;
  }

  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;
  return `${negative ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
