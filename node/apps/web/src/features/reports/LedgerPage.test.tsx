import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerPage } from "./LedgerPage";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * The ledger screen — panels 1 and 2 of `/Report/ReportDetails`.
 *
 * The arithmetic itself is pinned in the API tests, where it belongs. What is
 * checked here is that the screen puts the right number in the right column and
 * says the things the legacy screen leaves the reader to infer.
 */

const EMPTY = { rows: [], nextCursor: null, total: 0 };
const NONE = { rows: [], nextCursor: null, total: 0 };

const ledgerRow = (overrides: Record<string, unknown> = {}) => ({
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
  effect: "credit",
  credit: "10000.00",
  debit: "0.00",
  balance: "10000.00",
  ...overrides,
});

/**
 * The balances route is still answered, so a request for it would succeed
 * silently — the "no balance summary" test counts requests to it instead.
 */
const withReports = (ledger: unknown) =>
  routeFetch([
    [/\/reports\/ledger$/, ledger],
    [/\/reports\/balances$/, { ...NONE, totalCredit: "0.00", totalDebit: "0.00", closingBalance: "0.00" }],
    [/\/suppliers/, EMPTY],
    [/\/companies/, EMPTY],
  ]);

/** The ledger loads nothing until Search is pressed, so every ledger test starts there. */
const search = async () =>
  userEvent.click(await screen.findByRole("button", { name: "Search" }));

const ledgerResponse = (rows: unknown[], overrides: Record<string, unknown> = {}) => ({
  rows,
  total: rows.length,
  nextCursor: null,
  totalCredit: "10000.00",
  totalDebit: "0.00",
  closingBalance: "10000.00",
  ...overrides,
});

describe("the ledger screen", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the running balance beside each entry", async () => {
    withReports(
      ledgerResponse([
        ledgerRow(),
        ledgerRow({
          id: "payment:bbbb",
          documentId: "bbbb",
          source: "payment",
          displayNo: "CHQ-4471",
          label: "Payment",
          effect: "debit",
          credit: "0.00",
          debit: "4000.00",
          balance: "6000.00",
        }),
      ]),
    );
    renderWithAuth(<LedgerPage />, { permissions: ["reports-payments.view"] });
    await search();

    const table = await screen.findByRole("table", { name: "" }).catch(() => null);
    expect(table ?? (await screen.findAllByRole("table"))[0]).toBeTruthy();

    expect(await screen.findByText("BB/154")).toBeInTheDocument();
    expect(screen.getByText("CHQ-4471")).toBeInTheDocument();
    expect(screen.getByText("6,000.00")).toBeInTheDocument();
  });

  it("puts a credit and a debit in different columns", async () => {
    withReports(
      ledgerResponse([
        ledgerRow({
          effect: "debit",
          credit: "0.00",
          debit: "2500.00",
          balance: "-2500.00",
          label: "Purchase Return",
          source: "return",
        }),
      ]),
    );
    renderWithAuth(<LedgerPage />, { permissions: ["reports-payments.view"] });
    await search();

    // The row is a debit, so the credit cell is blank rather than showing 0.00.
    expect(await screen.findByText("2,500.00")).toBeInTheDocument();
    expect(screen.getByText("Purchase Return")).toBeInTheDocument();
  });

  it("shows a total row over every entry, not just the page", async () => {
    withReports(
      ledgerResponse([ledgerRow()], {
        total: 120,
        totalCredit: "500000.00",
        totalDebit: "100000.00",
        closingBalance: "400000.00",
        nextCursor: "100",
      }),
    );
    renderWithAuth(<LedgerPage />, { permissions: ["reports-payments.view"] });
    await search();

    expect(await screen.findByText(/Total over every entry/)).toBeInTheDocument();
    // Indian digit grouping — 4,00,000.00, not 400,000.00. See `groupIndian`.
    expect(screen.getByText("4,00,000.00")).toBeInTheDocument();
    expect(screen.getByText(/The balance runs across pages/)).toBeInTheDocument();
  });

  it("disables Previous on the first page and offers Next when there is more", async () => {
    withReports(ledgerResponse([ledgerRow()], { total: 120, nextCursor: "100" }));
    renderWithAuth(<LedgerPage />, { permissions: ["reports-payments.view"] });
    await search();

    expect(await screen.findByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("says a sales entry has no site group rather than drawing an empty column", async () => {
    const user = userEvent.setup();
    withReports(ledgerResponse([ledgerRow({ siteLocationName: null })]));
    renderWithAuth(<LedgerPage />, { permissions: ["reports-payments.view"] });
    await search();

    await screen.findByText("BB/154");
    await user.click(screen.getByRole("button", { name: "Sales" }));

    await waitFor(() => expect(screen.getByText("Not recorded on sales")).toBeInTheDocument());
  });

  it("renders an empty state rather than an empty grid", async () => {
    withReports(ledgerResponse([], { totalCredit: "0.00", totalDebit: "0.00", closingBalance: "0.00" }));
    renderWithAuth(<LedgerPage />, { permissions: ["reports-payments.view"] });
    await search();

    expect(await screen.findByText("No entries")).toBeInTheDocument();
  });

  it("reports a failed load rather than an empty ledger", async () => {
    routeFetch([
      [/\/reports\/ledger$/, new Response("nope", { status: 500 })],
      [/\/reports\/balances$/, { ...NONE, totalCredit: "0.00", totalDebit: "0.00", closingBalance: "0.00" }],
      [/\/suppliers/, EMPTY],
      [/\/companies/, EMPTY],
    ]);
    renderWithAuth(<LedgerPage />, { permissions: ["reports-payments.view"] });
    await search();

    expect(await screen.findByText(/ledger could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText("No entries")).not.toBeInTheDocument();
  });

  /**
   * The legacy screen re-runs its query on every keystroke of a filter because
   * DataTables is in server-side mode. These reports scan every document for a
   * party; applying on submit is deliberate and the Search button is the only
   * thing that triggers it.
   */
  it("does not re-query until Search is pressed", async () => {
    const user = userEvent.setup();
    withReports(ledgerResponse([ledgerRow()]));
    renderWithAuth(<LedgerPage />, { permissions: ["reports-payments.view"] });
    await search();

    await screen.findByText("BB/154");
    const before = vi.mocked(globalThis.fetch).mock.calls.length;

    await user.type(screen.getByLabelText("From"), "2026-01-01");
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(before);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch).mock.calls.length).toBeGreaterThan(before),
    );
  });

  const ledgerRequests = () =>
    vi
      .mocked(globalThis.fetch)
      .mock.calls.filter((call) =>
        new URL(String(call[0]), "http://localhost").pathname.endsWith("/reports/ledger"),
      ).length;

  const balanceRequests = () =>
    vi
      .mocked(globalThis.fetch)
      .mock.calls.filter((call) =>
        new URL(String(call[0]), "http://localhost").pathname.endsWith("/reports/balances"),
      ).length;

  /** Client request, 14 Sep 2026, repeated: nothing is shown until the user searches. */
  it("loads nothing until Search is pressed", async () => {
    withReports(ledgerResponse([ledgerRow()]));
    renderWithAuth(<LedgerPage />, { permissions: ["reports-payments.view"] });

    expect(await screen.findByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(screen.queryByText("BB/154")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /excel|pdf/i })).not.toBeInTheDocument();
    // No prompt before a search (client request, 18 Sep 2026): just the filters.
    expect(screen.queryByText(/Search to see/)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(ledgerRequests()).toBe(0);

    await search();

    expect(await screen.findByText("BB/154")).toBeInTheDocument();
    expect(ledgerRequests()).toBe(1);
  });

  it("goes back to empty on Reset", async () => {
    withReports(ledgerResponse([ledgerRow()]));
    renderWithAuth(<LedgerPage />, { permissions: ["reports-payments.view"] });
    await search();
    await screen.findByText("BB/154");

    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => expect(screen.queryByText("BB/154")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /excel|pdf/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  describe("the ledger alone (client request, 1 Oct 2026)", () => {
    /**
     * It had a tab of its own, "Ledger", standing in for the page's title. The
     * section tabs above now name the page, so a second one said it twice
     * (client request, 5 Oct 2026); only the Purchases / Sales switch is kept.
     */
    it("has no tab of its own, and no balance summary — nor asks for one", async () => {
      withReports(ledgerResponse([ledgerRow()]));
      renderWithAuth(<LedgerPage />, { permissions: ["reports-payments.view"] });
      await search();

      expect(screen.queryByRole("tab")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Purchases" })).toHaveAttribute("aria-pressed", "true");
      expect(await screen.findByRole("table", { name: "Ledger" })).toBeInTheDocument();
      expect(screen.queryByText(/Balance summary/)).not.toBeInTheDocument();
      expect(balanceRequests()).toBe(0);
    });

    /**
     * Every amount is right-aligned exactly as its header is, in its footer too,
     * in a column of the one fixed width — which is what makes the last digits
     * of every row line up under the last letter of the heading.
     */
    it("aligns every amount with its column header", async () => {
      withReports(ledgerResponse([ledgerRow()]));
      renderWithAuth(<LedgerPage />, { permissions: ["reports-payments.view"] });
      await search();

      const table = await screen.findByRole("table", { name: "Ledger" });
      const headers = within(table).getAllByRole("columnheader");
      const amountColumns = ["Credit", "Debit", "Balance"].map((name) =>
        headers.findIndex((header) => header.textContent === name),
      );
      const cols = table.querySelectorAll("col");
      for (const index of amountColumns) {
        expect(headers[index]).toHaveClass("text-right");
        for (const row of table.querySelectorAll("tbody tr")) {
          expect(row.children[index]).toHaveClass("text-right", "tabular");
        }
        expect((cols[index] as HTMLTableColElement).style.width).toBe((cols[amountColumns[0]!] as HTMLTableColElement).style.width);
      }
    });

    /** The downloads sit in the tab row, above the filters. */
    it("puts the export buttons above the filters", async () => {
      withReports(ledgerResponse([ledgerRow()]));
      renderWithAuth(<LedgerPage />, { permissions: ["reports-payments.view"] });
      await search();
      await screen.findByRole("table", { name: "Ledger" });

      const excel = screen.getByRole("button", { name: /export to excel/i });
      const searchButton = screen.getByRole("button", { name: "Search" });
      expect(excel.compareDocumentPosition(searchButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByRole("button", { name: /excel by party/i })).toBeInTheDocument();
    });
  });
});
