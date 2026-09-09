import { describe, expect, it } from "vitest";
import { formatExportDate, formatMoney } from "./format";
import {
  balanceSheetRow,
  balancesFooterRow,
  balancesSheetColumns,
  ledgerDocumentCell,
  ledgerFooterRow,
  ledgerSheetColumns,
  ledgerSheetRow,
  reportFileName,
  reportLabels,
} from "./report-sheets";
import type { BalanceRow, BalancesResponse, LedgerResponse, LedgerRow } from "./reports";

const ledgerRow = (overrides: Partial<LedgerRow> = {}): LedgerRow => ({
  id: "invoice:1",
  documentId: "1",
  source: "invoice",
  displayNo: "DHP/24-25/049",
  label: "Purchase",
  documentDate: "2026-04-01T00:00:00.000Z",
  partyId: "p1",
  partyName: "Om Sagar Traders",
  siteId: "s1",
  siteName: "Akwada Lake Front",
  siteGroupId: "g1",
  siteGroupName: "COMMUNITY HALL",
  companyId: "c1",
  companyName: "D H Infra",
  effect: "credit",
  credit: "60745.28",
  debit: "0.00",
  balance: "60745.28",
  ...overrides,
});

describe("report sheet columns", () => {
  it("names the three amount columns differently for sales, as both screens do", () => {
    expect(reportLabels("out")).toEqual({
      party: "Supplier",
      credit: "Credit",
      debit: "Debit",
      net: "Net",
    });
    expect(reportLabels("in")).toEqual({
      party: "Customer",
      credit: "Invoiced",
      debit: "Received",
      net: "Outstanding",
    });
  });

  it("puts the party column before the site, matching the grid rather than the legacy sheet", () => {
    const headers = ledgerSheetColumns("out").map((column) => column.header);
    expect(headers).toEqual([
      "Document",
      "Date",
      "Supplier",
      "Site",
      "Group",
      "Credit",
      "Debit",
      "Balance",
    ]);
  });

  it("right-aligns every money column and nothing else", () => {
    const right = ledgerSheetColumns("out")
      .filter((column) => column.align === "right")
      .map((column) => column.header);
    expect(right).toEqual(["Credit", "Debit", "Balance"]);

    const summaryRight = balancesSheetColumns("in")
      .filter((column) => column.align === "right")
      .map((column) => column.header);
    expect(summaryRight).toEqual(["Invoiced", "Received", "Outstanding"]);
  });
});

describe("ledgerDocumentCell", () => {
  it("appends the type in brackets, as the legacy sheet does", () => {
    expect(ledgerDocumentCell(ledgerRow())).toBe("DHP/24-25/049 (Purchase)");
  });

  it("writes no empty brackets when there is no label", () => {
    expect(ledgerDocumentCell(ledgerRow({ label: "" }))).toBe("DHP/24-25/049");
  });
});

describe("ledgerSheetRow", () => {
  it("puts the amount in the column its effect names, and leaves the other blank", () => {
    const credit = ledgerSheetRow(ledgerRow());
    expect(credit[5]).toBe("60,745.28");
    expect(credit[6]).toBe("");

    const debit = ledgerSheetRow(
      ledgerRow({ effect: "debit", credit: "0.00", debit: "10000.00", balance: "50745.28" }),
    );
    expect(debit[5]).toBe("");
    expect(debit[6]).toBe("10,000.00");
    expect(debit[7]).toBe("50,745.28");
  });

  it("groups the Indian way, which is the whole reason money is not a number here", () => {
    const row = ledgerSheetRow(ledgerRow({ credit: "12345678.90", balance: "12345678.90" }));
    expect(row[5]).toBe("1,23,45,678.90");
  });

  it("renders a null site and group as empty cells rather than the word null", () => {
    const row = ledgerSheetRow(ledgerRow({ siteName: null, siteGroupName: null }));
    expect(row[3]).toBe("");
    expect(row[4]).toBe("");
  });
});

describe("balanceSheetRow", () => {
  const balance = (overrides: Partial<BalanceRow> = {}): BalanceRow => ({
    id: "s1:p1",
    partyId: "p1",
    partyName: "Om Sagar Traders",
    siteId: "s1",
    siteName: "Akwada Lake Front",
    credit: "400000.00",
    debit: "150000.00",
    netAmount: "250000.00",
    ...overrides,
  });

  it("writes site, party and the three amounts", () => {
    expect(balanceSheetRow(balance())).toEqual([
      "Akwada Lake Front",
      "Om Sagar Traders",
      "4,00,000.00",
      "1,50,000.00",
      "2,50,000.00",
    ]);
  });
});

describe("footer rows", () => {
  /**
   * The point of these two tests is that the footer comes from the RESPONSE's
   * own totals, which are computed by the same SQL as the rows. The legacy
   * sheet's footer comes from a different query, and that is finding D7 — its
   * Total does not equal its own Credit column whenever a purchase return is in
   * range.
   */
  it("takes the ledger total from the response, not from a re-sum of the page", () => {
    const response = {
      rows: [],
      total: 3,
      nextCursor: null,
      totalCredit: "60745.28",
      totalDebit: "10000.00",
      closingBalance: "50745.28",
    } as LedgerResponse;

    expect(ledgerFooterRow(response)).toEqual([
      "Total",
      "",
      "",
      "",
      "",
      "60,745.28",
      "10,000.00",
      "50,745.28",
    ]);
  });

  it("takes the summary total from the response too", () => {
    const response = {
      rows: [],
      total: 2,
      nextCursor: null,
      totalCredit: "400000.00",
      totalDebit: "150000.00",
      closingBalance: "250000.00",
    } as BalancesResponse;

    expect(balancesFooterRow(response)).toEqual([
      "Total",
      "",
      "4,00,000.00",
      "1,50,000.00",
      "2,50,000.00",
    ]);
  });

  it("has exactly one cell per column, so the totals land under their columns", () => {
    expect(ledgerFooterRow({ totalCredit: "0", totalDebit: "0", closingBalance: "0" } as
      LedgerResponse)).toHaveLength(ledgerSheetColumns("out").length);
    expect(balancesFooterRow({ totalCredit: "0", totalDebit: "0", closingBalance: "0" } as
      BalancesResponse)).toHaveLength(balancesSheetColumns("out").length);
  });
});

describe("formatExportDate", () => {
  /**
   * The reason this does not build a `Date`: `new Date("2026-04-01")` is
   * midnight UTC, so in any timezone west of Greenwich `getDate()` returns 31
   * March. That is the off-by-one-day bug that appears in exports and never in
   * the grid beside them, because the grid formats in the browser's own zone.
   */
  it("takes the date as written, whatever the timezone", () => {
    expect(formatExportDate("2026-04-01T00:00:00.000Z")).toBe("01-04-2026");
    expect(formatExportDate("2026-04-01")).toBe("01-04-2026");
  });

  it("is empty for null, not the word null or the epoch", () => {
    expect(formatExportDate(null)).toBe("");
    expect(formatExportDate(undefined)).toBe("");
    expect(formatExportDate("not a date")).toBe("");
  });
});

describe("reportFileName", () => {
  it("names the file after the report and the day, not a guid", () => {
    const on = new Date("2026-09-09T12:00:00.000Z");
    expect(reportFileName("Ledger", on, "xlsx")).toBe("Ledger-2026-09-09.xlsx");
    expect(reportFileName("Sales-Report", on, "pdf")).toBe("Sales-Report-2026-09-09.pdf");
  });
});

describe("formatMoney, shared with the screens", () => {
  it("is the same function the grid uses, so a file cannot disagree with it", () => {
    expect(formatMoney("6074528.00")).toBe("60,74,528.00");
    expect(formatMoney("-1500.5")).toBe("-1,500.50");
  });
});
