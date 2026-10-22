import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BalanceSheetPage } from "./BalanceSheetPage";
import { renderWithAuth, routeFetch } from "../../test/render";

const SITE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const sheet = {
  rows: [
    {
      siteId: SITE,
      siteName: "Akwada Lake Front",
      income: "900000.00",
      billed: "500000.00",
      paid: "300000.00",
      stillToPay: "200000.00",
      cashBalance: "600000.00",
      projectResult: "400000.00",
    },
    {
      siteId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      siteName: "Surat Diamond Park",
      income: "0.00",
      billed: "250000.00",
      paid: "0.00",
      stillToPay: "250000.00",
      cashBalance: "0.00",
      projectResult: "-250000.00",
    },
  ],
  totals: {
    income: "900000.00",
    billed: "750000.00",
    paid: "300000.00",
    stillToPay: "450000.00",
    cashBalance: "600000.00",
    projectResult: "150000.00",
  },
};

describe("the Balance Sheet", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    routeFetch([
      [
        /\/balance-sheet\/site\//,
        {
          incomes: [{ id: "i1", incomeDate: "2026-10-05", clientName: "Shah Developers", companyName: "DH Patel", total: "900000.00" }],
          suppliers: [{ partyId: "p1", partyName: "AL BURHAN PIPES", billed: "500000.00", paid: "300000.00", stillToPay: "200000.00" }],
        },
      ],
      [/\/balance-sheet$/, sheet],
      [/\/companies/, { rows: [], nextCursor: null, total: 0 }],
      [/\/clients/, { rows: [], nextCursor: null, total: 0 }],
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows each project's income, billed, paid and the two balances, with a total", async () => {
    renderWithAuth(<BalanceSheetPage />, { permissions: ["reports-payments.view", "income.view"] });

    expect(await screen.findByText("Akwada Lake Front")).toBeInTheDocument();
    expect(screen.getByText("Surat Diamond Park")).toBeInTheDocument();
    expect(screen.getByText("4,00,000.00")).toBeInTheDocument();
    // A project that has cost more than it has brought in reads as negative.
    expect(screen.getByText("-2,50,000.00")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("1,50,000.00")).toBeInTheDocument();
  });

  it("opens a project to its income entries and suppliers", async () => {
    const user = userEvent.setup();
    renderWithAuth(<BalanceSheetPage />, { permissions: ["reports-payments.view", "income.view"] });

    await user.click(await screen.findByLabelText("Show Akwada Lake Front"));

    expect(await screen.findByText("Shah Developers")).toBeInTheDocument();
    expect(screen.getByText("AL BURHAN PIPES")).toBeInTheDocument();
  });

  /** Record income from the sheet (client, 22 Oct 2026), the open project kept. */
  it("records income for an opened project without leaving the sheet", async () => {
    const user = userEvent.setup();
    renderWithAuth(<BalanceSheetPage />, {
      permissions: ["reports-payments.view", "income.view", "income.add"],
      scope: { siteId: null, sites: [{ id: SITE, name: "Akwada Lake Front" }], canSelectAll: true },
    });

    await user.click(await screen.findByLabelText("Show Akwada Lake Front"));
    const income = (await screen.findByText("Shah Developers")).closest("div.grid")! as HTMLElement;
    await user.click(within(income).getByRole("button", { name: /add income/i }));

    const dialog = await screen.findByRole("dialog", { name: "Record income" });
    // The project is the row's and is fixed; the sheet behind stays open on it.
    expect(within(dialog).getByText("Akwada Lake Front")).toBeInTheDocument();
    expect(screen.getByText("AL BURHAN PIPES")).toBeInTheDocument();
  });

  it("has Add income beside the filters, and only with the right to add it", async () => {
    const first = renderWithAuth(<BalanceSheetPage />, { permissions: ["reports-payments.view", "income.view", "income.add"] });
    await screen.findByText("Akwada Lake Front");
    expect(screen.getByRole("button", { name: /add income/i })).toBeInTheDocument();
    first.unmount();

    renderWithAuth(<BalanceSheetPage />, { permissions: ["reports-payments.view", "income.view"] });
    await screen.findByText("Akwada Lake Front");
    expect(screen.queryByRole("button", { name: /add income/i })).not.toBeInTheDocument();
  });
});
