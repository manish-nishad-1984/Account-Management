import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingLedgerPage } from "./PendingLedgerPage";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * The pending ledger, a copy of Ledger & Balances for the client to try out.
 *
 * The rule for which invoices are pending is pinned against real PostgreSQL in
 * `reports.pending-ledger.test.ts`. What is checked here is the client's list:
 * a three-column summary, a ledger with its own filters, and the pending
 * amounts in the right columns.
 */

const EMPTY = { rows: [], nextCursor: null, total: 0 };

const pendingRow = (overrides: Record<string, unknown> = {}) => ({
  id: "invoice:aaaa",
  documentId: "aaaa",
  source: "invoice",
  displayNo: "BB/154",
  label: "Purchase",
  documentDate: "2026-02-11T00:00:00.000Z",
  partyId: "p1",
  partyName: "AL BURHAN PIPES",
  siteId: "s1",
  siteName: "Akwada Lake Front",
  siteLocationId: null,
  siteLocationName: null,
  companyId: "c1",
  companyName: "DH PATEL",
  amount: "10000.00",
  pending: "10000.00",
  balance: "10000.00",
  ...overrides,
});

const pendingResponse = (rows: unknown[], overrides: Record<string, unknown> = {}) => ({
  rows,
  total: rows.length,
  nextCursor: null,
  totalAmount: "15000.00",
  totalPending: "13000.00",
  ...overrides,
});

const balancesResponse = {
  rows: [
    {
      id: "s1:p1",
      partyId: "p1",
      partyName: "AL BURHAN PIPES",
      siteId: "s1",
      siteName: "Akwada Lake Front",
      credit: "31000.00",
      debit: "18000.00",
      netAmount: "13000.00",
    },
  ],
  total: 1,
  nextCursor: null,
  totalCredit: "31000.00",
  totalDebit: "18000.00",
  closingBalance: "13000.00",
};

const withReports = (pending: unknown) =>
  routeFetch([
    [/\/reports\/pending-ledger$/, pending],
    [/\/reports\/balances$/, balancesResponse],
    [/\/suppliers/, EMPTY],
    [/\/companies/, EMPTY],
  ]);

const requested = (path: string) =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.map((call) => new URL(String(call[0]), "http://localhost"))
    .filter((url) => url.pathname.endsWith(path));

/** The two are tabs since 18 Sep 2026; the ledger shows first. */
const openTab = async (name: "Ledger — pending invoices" | "Balance summary") =>
  userEvent.click(await screen.findByRole("tab", { name }));

/** The ledger loads nothing until its own Search is pressed. */
const searchLedger = async () => {
  await openTab("Ledger — pending invoices");
  await userEvent.click(
    within(await screen.findByRole("form", { name: "Ledger filters" })).getByRole("button", { name: "Search" }),
  );
};

/** The summary also loads nothing until its own Search is pressed. */
const searchSummary = async () => {
  await openTab("Balance summary");
  await userEvent.click(
    within(await screen.findByRole("form", { name: "Balance summary filters" })).getByRole("button", { name: "Search" }),
  );
};

describe("the pending ledger screen", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows only site, supplier and net in the balance summary", async () => {
    withReports(pendingResponse([]));
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });
    await searchSummary();

    const summary = await screen.findByRole("table", { name: "Balance summary" });
    const headers = within(summary)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);

    expect(headers).toEqual(["Site", "Supplier", "Net"]);
    expect(within(summary).queryByText("31,000.00")).not.toBeInTheDocument();
    expect(within(summary).getAllByText("13,000.00").length).toBeGreaterThan(0);
  });

  it("asks the summary to leave out every row whose Net is zero", async () => {
    withReports(pendingResponse([]));
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });
    await searchSummary();

    await screen.findByRole("table", { name: "Balance summary" });
    const calls = requested("/reports/balances");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((url) => url.searchParams.get("show") === "outstanding")).toBe(true);
  });

  it("shows each pending invoice with what is left of it and the running balance", async () => {
    withReports(
      pendingResponse([
        pendingRow({ amount: "5000.00", pending: "3000.00", balance: "3000.00" }),
        pendingRow({
          id: "invoice:bbbb",
          documentId: "bbbb",
          displayNo: "BB/171",
          amount: "10000.00",
          pending: "10000.00",
          balance: "13000.00",
        }),
      ]),
    );
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });
    await searchLedger();

    const ledger = await screen.findByRole("table", { name: "Pending invoices" });
    const rows = within(ledger).getAllByRole("row");

    // header, two entries, footer
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getByText("BB/154")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("5,000.00")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Part paid")).toBeInTheDocument();
    expect(within(rows[2]!).queryByText("Part paid")).not.toBeInTheDocument();
    expect(within(rows[2]!).getByText("13,000.00")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("13,000.00")).toBeInTheDocument();
  });

  it("says nothing is pending rather than showing an empty table", async () => {
    withReports(pendingResponse([], { totalAmount: "0.00", totalPending: "0.00" }));
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });
    await searchLedger();

    expect(await screen.findByText("Nothing pending")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Pending invoices" })).not.toBeInTheDocument();
  });

  it("gives the ledger its own filters, which leave the summary alone", async () => {
    withReports(pendingResponse([pendingRow()]));
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });

    await searchSummary();
    await screen.findByRole("table", { name: "Balance summary" });
    await openTab("Ledger — pending invoices");
    const ledgerFilters = await screen.findByRole("form", { name: "Ledger filters" });

    await userEvent.type(within(ledgerFilters).getByLabelText("From"), "2026-04-01");
    await userEvent.click(within(ledgerFilters).getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(
        requested("/reports/pending-ledger").some((url) => url.searchParams.get("fromDate") === "2026-04-01"),
      ).toBe(true),
    );
    expect(requested("/reports/balances").some((url) => url.searchParams.has("fromDate"))).toBe(false);
  });

  it("gives the two filter rows different field ids", async () => {
    withReports(pendingResponse([]));
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });

    const ledgerFrom = within(await screen.findByRole("form", { name: "Ledger filters" })).getByLabelText("From");
    const ledgerId = ledgerFrom.id;
    await openTab("Balance summary");
    const summaryFrom = within(await screen.findByRole("form", { name: "Balance summary filters" })).getByLabelText("From");
    expect(summaryFrom.id).not.toBe(ledgerId);
  });

  /**
   * Client request, 14 Sep 2026, repeated: nothing is shown by default — not the
   * summary and not the ledger. Each section waits for its own Search.
   */
  it("loads neither the summary nor the ledger until each one's Search is pressed", async () => {
    withReports(pendingResponse([pendingRow()]));
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });

    expect(await screen.findByRole("form", { name: "Ledger filters" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Pending invoices" })).not.toBeInTheDocument();
    await openTab("Balance summary");
    expect(await screen.findByRole("form", { name: "Balance summary filters" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Balance summary" })).not.toBeInTheDocument();
    expect(requested("/reports/balances")).toHaveLength(0);
    expect(requested("/reports/pending-ledger")).toHaveLength(0);

    // The summary's Search loads the summary, and only the summary.
    await searchSummary();
    expect(await screen.findByRole("table", { name: "Balance summary" })).toBeInTheDocument();
    expect(requested("/reports/balances")).toHaveLength(1);
    expect(requested("/reports/pending-ledger")).toHaveLength(0);

    await searchLedger();
    expect(await screen.findByRole("table", { name: "Pending invoices" })).toBeInTheDocument();
    expect(requested("/reports/pending-ledger")).toHaveLength(1);
  });

  it("goes back to an empty summary when the summary's Reset is pressed", async () => {
    withReports(pendingResponse([]));
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });
    await searchSummary();
    await screen.findByRole("table", { name: "Balance summary" });

    await userEvent.click(
      within(screen.getByRole("form", { name: "Balance summary filters" })).getByRole("button", { name: "Reset" }),
    );

    await waitFor(() => expect(screen.queryByRole("table", { name: "Balance summary" })).not.toBeInTheDocument());
  });

  it("goes back to an empty ledger when the ledger's Reset is pressed", async () => {
    withReports(pendingResponse([pendingRow()]));
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });
    await searchLedger();
    await screen.findByRole("table", { name: "Pending invoices" });

    await userEvent.click(
      within(screen.getByRole("form", { name: "Ledger filters" })).getByRole("button", { name: "Reset" }),
    );

    await waitFor(() => expect(screen.queryByRole("table", { name: "Pending invoices" })).not.toBeInTheDocument());
  });

  /** Client request, 18 Sep 2026: no prompt before Search and no footnote under the grid. */
  it("shows no prompt or footnote on the ledger tab", async () => {
    withReports(pendingResponse([pendingRow()]));
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });
    await screen.findByRole("form", { name: "Ledger filters" });
    expect(screen.queryByText(/Search to see pending invoices/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing is loaded until then/)).not.toBeInTheDocument();

    await searchLedger();
    await screen.findByRole("table", { name: "Pending invoices" });
    expect(screen.queryByText(/pay off the oldest invoices first/)).not.toBeInTheDocument();
  });

  /** Switching tab to glance at the other must not throw away a search. */
  it("keeps each tab's search when the other is opened and closed", async () => {
    withReports(pendingResponse([pendingRow()]));
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });
    await searchLedger();
    await screen.findByRole("table", { name: "Pending invoices" });

    await openTab("Balance summary");
    await openTab("Ledger — pending invoices");

    expect(await screen.findByRole("table", { name: "Pending invoices" })).toBeInTheDocument();
    expect(requested("/reports/pending-ledger")).toHaveLength(1);
  });

  /** Part paid beside the type, so the Pending figure keeps a row to itself. */
  it("keeps every amount on one line, with nothing stacked under it", async () => {
    withReports(pendingResponse([pendingRow({ amount: "5000.00", pending: "3000.00", balance: "3000.00" })]));
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });
    await searchLedger();

    const table = await screen.findByRole("table", { name: "Pending invoices" });
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    const row = within(table).getAllByRole("row")[1]!;
    const pendingCell = row.children[headers.indexOf("Pending")]!;

    expect(pendingCell.textContent).toBe("3,000.00");
    expect(pendingCell).toHaveClass("text-right", "tabular", "whitespace-nowrap");
    expect(row.children[headers.indexOf("Type")]).toHaveTextContent("Part paid");
  });
});
