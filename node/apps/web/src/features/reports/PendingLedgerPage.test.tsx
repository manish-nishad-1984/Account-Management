import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingLedgerPage } from "./PendingLedgerPage";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * Pending Outstanding — once the "Pending Ledger", now only its outstanding
 * summary (client request, 1 Oct 2026). What is checked here is the client's
 * list: one tab named Pending Outstanding, a three-column summary that leaves out
 * settled rows, and no pending-invoices ledger anywhere on the page.
 */

const EMPTY = { rows: [], nextCursor: null, total: 0 };

const balancesResponse = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const withReports = (balances: unknown = balancesResponse()) =>
  routeFetch([
    [/\/reports\/balances$/, balances],
    [/\/suppliers/, EMPTY],
    [/\/companies/, EMPTY],
  ]);

const requested = (path: string) =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.map((call) => new URL(String(call[0]), "http://localhost"))
    .filter((url) => url.pathname.endsWith(path));

/** The summary loads nothing until Search is pressed. */
const search = async () =>
  userEvent.click(
    within(await screen.findByRole("form", { name: "Pending outstanding filters" })).getByRole("button", {
      name: "Search",
    }),
  );

describe("the pending outstanding screen", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Client request, 1 Oct 2026: the pending-invoices tab is gone, and the summary renamed. */
  it("has one tab, Pending Outstanding, and no pending-invoices ledger", async () => {
    withReports();
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Pending Outstanding"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText(/pending invoices/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Balance summary/)).not.toBeInTheDocument();

    await search();
    await screen.findByRole("table", { name: "Pending outstanding" });
    expect(requested("/reports/pending-ledger")).toHaveLength(0);
  });

  it("shows only site, supplier and net", async () => {
    withReports();
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });
    await search();

    const summary = await screen.findByRole("table", { name: "Pending outstanding" });
    const headers = within(summary)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);

    expect(headers).toEqual(["Site", "Supplier", "Net"]);
    expect(within(summary).queryByText("31,000.00")).not.toBeInTheDocument();
    expect(within(summary).getAllByText("13,000.00").length).toBeGreaterThan(0);
  });

  it("asks for only the rows whose Net is not zero", async () => {
    withReports();
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });
    await search();

    await screen.findByRole("table", { name: "Pending outstanding" });
    const calls = requested("/reports/balances");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((url) => url.searchParams.get("show") === "outstanding")).toBe(true);
  });

  /** Client request, 14 Sep 2026, repeated: nothing is shown by default. */
  it("loads nothing until Search is pressed", async () => {
    withReports();
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });

    expect(await screen.findByRole("form", { name: "Pending outstanding filters" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/Search to see/)).not.toBeInTheDocument();
    expect(requested("/reports/balances")).toHaveLength(0);

    await search();
    expect(await screen.findByRole("table", { name: "Pending outstanding" })).toBeInTheDocument();
    expect(requested("/reports/balances")).toHaveLength(1);
  });

  it("goes back to empty when Reset is pressed", async () => {
    withReports();
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });
    await search();
    await screen.findByRole("table", { name: "Pending outstanding" });

    await userEvent.click(
      within(screen.getByRole("form", { name: "Pending outstanding filters" })).getByRole("button", { name: "Reset" }),
    );

    await waitFor(() => expect(screen.queryByRole("table", { name: "Pending outstanding" })).not.toBeInTheDocument());
  });

  it("says nothing is owed rather than showing an empty table", async () => {
    withReports(balancesResponse({ rows: [], total: 0, closingBalance: "0.00" }));
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });
    await search();

    expect(await screen.findByText("Nothing is owed for these filters.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Pending outstanding" })).not.toBeInTheDocument();
  });

  it("pages the summary", async () => {
    withReports(balancesResponse({ total: 120, nextCursor: "50" }));
    renderWithAuth(<PendingLedgerPage />, { permissions: ["reports-payments.view"] });
    await search();

    await userEvent.click(await screen.findByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(requested("/reports/balances").some((url) => url.searchParams.get("offset") === "50")).toBe(true),
    );
  });
});
