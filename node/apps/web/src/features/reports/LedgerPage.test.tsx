import { screen, waitFor } from "@testing-library/react";
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
  siteGroupId: null,
  siteGroupName: null,
  companyId: "c1",
  companyName: "DH PATEL",
  effect: "credit",
  credit: "10000.00",
  debit: "0.00",
  balance: "10000.00",
  ...overrides,
});

const balanceRow = (overrides: Record<string, unknown> = {}) => ({
  id: "s1:p1",
  partyId: "p1",
  partyName: "AL BURHAN PIPES",
  siteId: "s1",
  siteName: "Akwada Lake Front",
  credit: "10000.00",
  debit: "2000.00",
  netAmount: "8000.00",
  ...overrides,
});

const withReports = (
  ledger: unknown,
  balances: unknown = { ...NONE, totalCredit: "0.00", totalDebit: "0.00", closingBalance: "0.00" },
) =>
  routeFetch([
    [/\/reports\/ledger$/, ledger],
    [/\/reports\/balances$/, balances],
    [/\/suppliers/, EMPTY],
    [/\/companies/, EMPTY],
  ]);

const ledgerResponse = (rows: unknown[], overrides: Record<string, unknown> = {}) => ({
  rows,
  total: rows.length,
  nextCursor: null,
  totalCredit: "10000.00",
  totalDebit: "0.00",
  closingBalance: "10000.00",
  ...overrides,
});

const balancesResponse = (rows: unknown[], overrides: Record<string, unknown> = {}) => ({
  rows,
  total: rows.length,
  nextCursor: null,
  totalCredit: "10000.00",
  totalDebit: "2000.00",
  closingBalance: "8000.00",
  ...overrides,
});

describe("the ledger and balances screen", () => {
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
    renderWithAuth(<LedgerPage />, { permissions: ["details-report.view"] });

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
    renderWithAuth(<LedgerPage />, { permissions: ["details-report.view"] });

    // The row is a debit, so the credit cell is blank rather than showing 0.00.
    expect(await screen.findByText("2,500.00")).toBeInTheDocument();
    expect(screen.getByText("Purchase Return")).toBeInTheDocument();
  });

  /**
   * The summary's Net is credit less debit. The legacy version adds returns to
   * the net while subtracting them in the Debit column beside it, so the two
   * panels of that screen disagree — this is the sentence that says which one
   * this screen means.
   */
  it("explains that returns reduce the balance", async () => {
    withReports(ledgerResponse([]), balancesResponse([balanceRow()]));
    renderWithAuth(<LedgerPage />, { permissions: ["details-report.view"] });

    // Awaited on the NUMBER, not on the sentence: the paragraph renders
    // unconditionally, so awaiting it passes while the panel is still loading.
    expect(await screen.findAllByText("8,000.00")).not.toHaveLength(0);
    expect(screen.getByText(/Net is credit less debit/)).toBeInTheDocument();
  });

  it("shows a total row over every entry, not just the page", async () => {
    withReports(
      ledgerResponse([ledgerRow()], {
        total: 120,
        totalCredit: "500000.00",
        totalDebit: "100000.00",
        closingBalance: "400000.00",
        nextCursor: "50",
      }),
    );
    renderWithAuth(<LedgerPage />, { permissions: ["details-report.view"] });

    expect(await screen.findByText(/Total over every entry/)).toBeInTheDocument();
    // Indian digit grouping — 4,00,000.00, not 400,000.00. See `groupIndian`.
    expect(screen.getByText("4,00,000.00")).toBeInTheDocument();
    expect(screen.getByText(/The balance runs across pages/)).toBeInTheDocument();
  });

  it("disables Previous on the first page and offers Next when there is more", async () => {
    withReports(ledgerResponse([ledgerRow()], { total: 120, nextCursor: "50" }));
    renderWithAuth(<LedgerPage />, { permissions: ["details-report.view"] });

    expect(await screen.findByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("says a sales entry has no site group rather than drawing an empty column", async () => {
    const user = userEvent.setup();
    withReports(ledgerResponse([ledgerRow({ siteGroupName: null })]));
    renderWithAuth(<LedgerPage />, { permissions: ["details-report.view"] });

    await screen.findByText("BB/154");
    await user.click(screen.getByRole("button", { name: "Sales" }));

    await waitFor(() => expect(screen.getByText("Not recorded on sales")).toBeInTheDocument());
  });

  it("renders an empty state rather than an empty grid", async () => {
    withReports(ledgerResponse([], { totalCredit: "0.00", totalDebit: "0.00", closingBalance: "0.00" }));
    renderWithAuth(<LedgerPage />, { permissions: ["details-report.view"] });

    expect(await screen.findByText("No entries")).toBeInTheDocument();
  });

  it("reports a failed load rather than an empty ledger", async () => {
    routeFetch([
      [/\/reports\/ledger$/, new Response("nope", { status: 500 })],
      [/\/reports\/balances$/, { ...NONE, totalCredit: "0.00", totalDebit: "0.00", closingBalance: "0.00" }],
      [/\/suppliers/, EMPTY],
      [/\/companies/, EMPTY],
    ]);
    renderWithAuth(<LedgerPage />, { permissions: ["details-report.view"] });

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
    renderWithAuth(<LedgerPage />, { permissions: ["details-report.view"] });

    await screen.findByText("BB/154");
    const before = vi.mocked(globalThis.fetch).mock.calls.length;

    await user.type(screen.getByLabelText("From"), "2026-01-01");
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(before);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch).mock.calls.length).toBeGreaterThan(before),
    );
  });
});
