import { screen, waitFor, within } from "@testing-library/react";
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
      salary: "0.00",
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
      salary: "0.00",
      cashBalance: "0.00",
      projectResult: "-250000.00",
    },
  ],
  totals: {
    income: "900000.00",
    billed: "750000.00",
    paid: "300000.00",
    stillToPay: "450000.00",
    salary: "0.00",
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
          salaries: [],
          suppliers: [
            { id: "pay1", partyId: "p1", partyName: "AL BURHAN PIPES", paymentDate: "2026-10-01T00:00:00.000Z", amount: "300000.00" },
            { id: "pay2", partyId: "p2", partyName: "SHAH ENTERPRISE", paymentDate: "2026-10-05T00:00:00.000Z", amount: "50000.00" },
          ],
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
    const payment = screen.getByText("AL BURHAN PIPES", { selector: "td" }).closest("tr")!;
    expect(payment).toHaveTextContent("01 Oct 2026");
    expect(payment).toHaveTextContent("3,00,000.00");
    expect(screen.queryByText("To pay")).not.toBeInTheDocument();
  });

  /** Date first, then supplier, and a supplier filter in the header (client, 22 Oct 2026). */
  it("lists the payments date first and filters them by supplier from the header", async () => {
    const user = userEvent.setup();
    renderWithAuth(<BalanceSheetPage />, { permissions: ["reports-payments.view", "income.view"] });
    await user.click(await screen.findByLabelText("Show Akwada Lake Front"));

    const row = (await screen.findByText("AL BURHAN PIPES", { selector: "td" })).closest("tr")!;
    expect([...row.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual(["01 Oct 2026", "AL BURHAN PIPES", "3,00,000.00"]);
    expect(screen.getByLabelText("Paid total")).toHaveTextContent("3,50,000.00");
    await user.selectOptions(screen.getByLabelText("Filter by supplier"), "SHAH ENTERPRISE");
    // The total follows the filter.
    expect(screen.getByLabelText("Paid total")).toHaveTextContent("50,000.00");
    expect(screen.getByText(/Total \(1 payment\)/)).toBeInTheDocument();
    expect(screen.queryByText("AL BURHAN PIPES", { selector: "td" })).not.toBeInTheDocument();
    expect(screen.getByText("SHAH ENTERPRISE", { selector: "td" })).toBeInTheDocument();
  });

  /** Salaries in the same list as the supplier payments, by date (client, 26 Oct 2026). */
  it("lists the salaries paid among the supplier payments, in the filter and the total", async () => {
    routeFetch([
      [
        /\/balance-sheet\/site\//,
        {
          incomes: [],
          salaries: [{ id: "s1", employeeName: "RAMESH PATEL", month: "2026-09", paymentDate: "2026-10-03", amount: "25000.00" }],
          suppliers: [
            { id: "pay1", partyId: "p1", partyName: "AL BURHAN PIPES", paymentDate: "2026-10-01T00:00:00.000Z", amount: "300000.00" },
            { id: "pay2", partyId: "p2", partyName: "SHAH ENTERPRISE", paymentDate: "2026-10-05T00:00:00.000Z", amount: "50000.00" },
          ],
        },
      ],
      [/\/balance-sheet$/, sheet],
      [/\/companies/, { rows: [], nextCursor: null, total: 0 }],
      [/\/clients/, { rows: [], nextCursor: null, total: 0 }],
    ]);
    const user = userEvent.setup();
    renderWithAuth(<BalanceSheetPage />, { permissions: ["reports-payments.view", "income.view"] });
    await user.click(await screen.findByLabelText("Show Akwada Lake Front"));

    await screen.findByText("AL BURHAN PIPES", { selector: "td" });
    const rows = [...screen.getByLabelText("Paid total").closest("table")!.querySelectorAll(":scope > tbody > tr")];
    expect(rows.map((row) => row.querySelector("td")!.textContent)).toEqual(["01 Oct 2026", "03 Oct 2026", "05 Oct 2026"]);
    expect(rows[1]).toHaveTextContent("RAMESH PATEL");
    expect(rows[1]).toHaveTextContent("Salary · Sep 2026");
    expect(screen.getByLabelText("Paid total")).toHaveTextContent("3,75,000.00");

    await user.selectOptions(screen.getByLabelText("Filter by supplier"), "RAMESH PATEL (salary)");
    expect(screen.getByLabelText("Paid total")).toHaveTextContent("25,000.00");
    expect(screen.queryByText("AL BURHAN PIPES", { selector: "td" })).not.toBeInTheDocument();
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
    expect(screen.getByText("AL BURHAN PIPES", { selector: "td" })).toBeInTheDocument();
  });

  /**
   * The whole round (client, 22 Oct 2026): from the sheet, in the full-page
   * record layout, the income form is a popup over the sheet; saving it closes
   * the popup, the sheet asks again for its figures, and the project stays open.
   */
  it("records income in a popup over the sheet, then refreshes the sheet with the project still open", async () => {
    const user = userEvent.setup();
    const COMPANY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const caps = { canEdit: true, canDelete: true, canApprove: false };
    const saved = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", incomeDate: "2026-10-22", siteId: SITE, companyId: COMPANY, clientId: CLIENT,
      amount: "500000.00", additionalTotal: "0.00", deductionTotal: "0.00", total: "500000.00", method: null, referenceNo: null,
      createdAt: "2026-10-22T10:00:00.000Z", note: null, additions: [], deductions: [],
    };
    const usual = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const reply = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
      if (path.endsWith("/client-incomes") && (init as RequestInit | undefined)?.method === "POST") return reply(saved, 201);
      if (path.endsWith("/companies"))
        return reply({ rows: [{ id: COMPANY, name: "DH Patel", invoicePrefix: null, gstNo: null, panNo: null, area: null, pincode: null, bankName: null, userCount: 0, capabilities: caps }], nextCursor: null, total: 1 });
      if (path.endsWith("/clients"))
        return reply({ rows: [{ id: CLIENT, name: "Shah Developers", mobile: null, email: null, gstNo: null, panNo: null, siteNames: ["Akwada Lake Front"], capabilities: caps }], nextCursor: null, total: 1 });
      return usual(input, init);
    });
    const sheetCalls = () =>
      vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => /\/balance-sheet(\?|$)/.test(new URL(String(input), "http://localhost").pathname + "?")).length;

    renderWithAuth(<BalanceSheetPage />, {
      permissions: ["reports-payments.view", "income.view", "income.add"],
      scope: { siteId: null, sites: [{ id: SITE, name: "Akwada Lake Front" }], canSelectAll: true },
      layout: "page",
    });
    await user.click(await screen.findByLabelText("Show Akwada Lake Front"));
    const income = (await screen.findByText("Shah Developers")).closest("div.grid")! as HTMLElement;
    const before = sheetCalls();
    await user.click(within(income).getByRole("button", { name: /add income/i }));

    const dialog = await screen.findByRole("dialog", { name: "Record income" });
    await user.selectOptions(within(dialog).getByLabelText(/^Company/), COMPANY);
    await waitFor(() => expect(within(dialog).getByLabelText(/^Client/)).toHaveValue(CLIENT));
    await user.type(within(dialog).getByLabelText(/^Amount$/), "500000");
    await user.click(within(dialog).getByRole("button", { name: /save income/i }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Record income" })).not.toBeInTheDocument());
    const post = vi.mocked(globalThis.fetch).mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({ siteId: SITE, companyId: COMPANY, clientId: CLIENT, amount: "500000" });
    await waitFor(() => expect(sheetCalls()).toBeGreaterThan(before));
    // The project the income was added to is still open.
    expect(screen.getByLabelText("Hide Akwada Lake Front")).toBeInTheDocument();
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
