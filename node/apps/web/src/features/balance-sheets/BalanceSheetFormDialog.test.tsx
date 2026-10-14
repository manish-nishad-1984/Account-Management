import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BalanceSheetFormDialog } from "./BalanceSheetFormDialog";
import { json, renderWithAuth } from "../../test/render";

const COMPANY = "99999999-9999-4999-8999-999999999999";
const FIGURES = { income: "1000000.00", billed: "400000.00", paid: "300000.00", stillToPay: "100000.00", cashBalance: "700000.00", projectResult: "600000.00" };
const PREVIEW = { rows: [{ siteId: "s1", siteName: "Akwada Lake Front", ...FIGURES }], totals: FIGURES };
const COMPANIES = {
  rows: [{ id: COMPANY, name: "DH PATEL", invoicePrefix: "DHP", gstNo: null, panNo: null, area: null, pincode: null, bankName: null, userCount: 0, capabilities: { canEdit: false, canDelete: false, canApprove: false } }],
  nextCursor: null,
  total: 1,
};

const calls = () =>
  vi.mocked(globalThis.fetch).mock.calls.map(([input, init]) => ({
    url: new URL(String(input), "http://localhost").pathname,
    method: (init as RequestInit | undefined)?.method ?? "GET",
    body: (init as RequestInit | undefined)?.body ? JSON.parse(String((init as RequestInit).body)) : null,
  }));

describe("BalanceSheetFormDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = new URL(String(input), "http://localhost").pathname;
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (url.endsWith("/companies")) return Promise.resolve(json(COMPANIES));
      if (url.endsWith("/balance-sheets/preview")) return Promise.resolve(json(PREVIEW));
      if (method === "POST" && url.endsWith("/balance-sheets")) {
        return Promise.resolve(json({ id: "new", title: null, companyId: COMPANY, companyName: "DH PATEL", incomeFrom: null, incomeTo: null, invoiceFrom: null, invoiceTo: null, projectCount: 1, figures: FIGURES, createdByName: null, createdAt: "2026-10-14T00:00:00.000Z", updatedAt: null, updatedByName: null, note: null, rows: PREVIEW.rows }, 201));
      }
      return Promise.resolve(json({}));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const open = () =>
    renderWithAuth(<BalanceSheetFormDialog open sheetId={null} onClose={vi.fn()} />, {
      permissions: ["balance-sheets.view", "balance-sheets.add"],
    });

  it("generates the sheet for the chosen company and dates, and saves only what was generated", async () => {
    const user = userEvent.setup();
    open();

    await screen.findByRole("option", { name: "DH PATEL" });
    await user.selectOptions(screen.getByLabelText("Company"), "DH PATEL");
    await user.type(screen.getByLabelText("Income from"), "2026-10-01");
    await user.type(screen.getByLabelText("Income to"), "2026-10-31");
    await user.type(screen.getByLabelText("Invoice from"), "2026-09-01");
    await user.type(screen.getByLabelText("Invoice to"), "2026-09-30");

    // Saving before generating is refused, and nothing is sent.
    await user.click(screen.getByRole("button", { name: /save balance sheet/i }));
    expect(await screen.findByText(/generate the sheet first/i)).toBeInTheDocument();
    expect(calls().some((c) => c.method === "POST" && c.url.endsWith("/balance-sheets"))).toBe(false);

    await user.click(screen.getByRole("button", { name: /^generate$/i }));
    const table = await screen.findByLabelText("Balance sheet");
    expect(within(table).getByText("Akwada Lake Front")).toBeInTheDocument();
    expect(within(table).getAllByText("10,00,000.00").length).toBeGreaterThan(0);
    expect(calls().find((c) => c.url.endsWith("/preview"))!.body).toMatchObject({
      companyId: COMPANY, incomeFrom: "2026-10-01", incomeTo: "2026-10-31", invoiceFrom: "2026-09-01", invoiceTo: "2026-09-30",
    });

    await user.click(screen.getByRole("button", { name: /save balance sheet/i }));
    await waitFor(() => expect(calls().some((c) => c.method === "POST" && c.url.endsWith("/balance-sheets"))).toBe(true));
  });

  it("asks for another Generate once a date has changed", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /^generate$/i }));
    await screen.findByLabelText("Balance sheet");

    await user.type(screen.getByLabelText("Income from"), "2026-10-01");
    expect(await screen.findByText(/filters changed/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save balance sheet/i }));
    expect(await screen.findByText(/generate the sheet first/i)).toBeInTheDocument();
  });

  it("refuses a to-date before its from-date", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText("Income from"), "2026-10-10");
    await user.type(screen.getByLabelText("Income to"), "2026-10-01");
    await user.click(screen.getByRole("button", { name: /^generate$/i }));
    expect(await screen.findByText(/before its "from" date/i)).toBeInTheDocument();
    expect(calls().some((c) => c.url.endsWith("/preview"))).toBe(false);
  });
});
