import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BalanceSheetDetail } from "@accountmanagement/contracts";
import { projectBlock } from "./detailExport";
import { BalanceSheetPage } from "./BalanceSheetPage";
import { json, renderWithAuth } from "../../test/render";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../lib/download", () => ({ saveBlob: save }));

/** The balance sheet in Excel with every income, payment and salary (client, 27 Oct 2026). */
const DETAIL: BalanceSheetDetail = {
  incomes: [
    { id: "i2", incomeDate: "2026-10-12", clientName: "ULTRATECH", companyName: "DH PATEL", total: "50000.00" },
    { id: "i1", incomeDate: "2026-10-05", clientName: "ULTRATECH", companyName: "DH PATEL", total: "100000.00" },
    { id: "i3", incomeDate: "2026-10-07", clientName: "JHM", companyName: "DH PATEL INFRA", total: "25000.50" },
  ],
  suppliers: [
    { id: "p2", partyId: "s2", partyName: "SHAH ENTERPRISE", paymentDate: "2026-10-09T00:00:00.000Z", amount: "30000.00" },
    { id: "p1", partyId: "s1", partyName: "AL BURHAN", paymentDate: "2026-10-02T00:00:00.000Z", amount: "40000.00" },
  ],
  salaries: [
    { id: "x2", employeeName: "RAMESH", month: "2026-09", paymentDate: "2026-10-07", amount: "15000.00" },
    { id: "x1", employeeName: "AMIT", month: "2026-09", paymentDate: "2026-10-07", amount: "12000.00" },
    { id: "x3", employeeName: "AMIT", month: "2026-08", paymentDate: "2026-09-07", amount: "12000.00" },
  ],
} as BalanceSheetDetail;

describe("the Balance Sheet with details, in Excel", () => {
  it("puts income company by company, then supplier payments, then salary month by month, then the balance", () => {
    const rows = projectBlock("Akwada", DETAIL, ["Company: All companies", "Dates: All dates"]);
    const lines = rows.map((row) => row.filter(Boolean).join(" | "));
    const at = (text: string) => lines.indexOf(text);

    expect(lines.slice(0, 3)).toEqual(["AKWADA", "Company: All companies", "Dates: All dates"]);
    // Income: each company's entries by date, its total, then the total.
    expect(lines.slice(at("INCOME"), at("INCOME") + 7)).toEqual([
      "INCOME",
      "05-10-2026 | ULTRATECH | DH PATEL | 100000.00",
      "12-10-2026 | ULTRATECH | DH PATEL | 50000.00",
      "Total DH PATEL | 150000.00",
      "07-10-2026 | JHM | DH PATEL INFRA | 25000.50",
      "Total DH PATEL INFRA | 25000.50",
      "TOTAL INCOME | 175000.50",
    ]);
    // Then the supplier payments by date.
    expect(lines.slice(at("SUPPLIER PAYMENTS"), at("SUPPLIER PAYMENTS") + 4)).toEqual([
      "SUPPLIER PAYMENTS",
      "02-10-2026 | AL BURHAN | 40000.00",
      "09-10-2026 | SHAH ENTERPRISE | 30000.00",
      "TOTAL SUPPLIER PAYMENTS | 70000.00",
    ]);
    // Then salary month by month.
    expect(lines.slice(at("SALARY"), at("SALARY") + 7)).toEqual([
      "SALARY",
      "Aug 2026 | AMIT | Paid 07-09-2026 | 12000.00",
      "Total Aug 2026 | 12000.00",
      "Sep 2026 | AMIT | Paid 07-10-2026 | 12000.00",
      "Sep 2026 | RAMESH | Paid 07-10-2026 | 15000.00",
      "Total Sep 2026 | 27000.00",
      "TOTAL SALARY | 39000.00",
    ]);
    // Balance = income - supplier payments - salary.
    expect(lines.slice(at("BALANCE"))).toEqual([
      "BALANCE",
      "Income | 175000.50",
      "Less: supplier payments | -70000.00",
      "Less: salary | -39000.00",
      "BALANCE (income - payments - salary) | 66000.50",
    ]);
    expect(at("INCOME")).toBeLessThan(at("SUPPLIER PAYMENTS"));
    expect(at("SUPPLIER PAYMENTS")).toBeLessThan(at("SALARY"));
  });

  describe("the button", () => {
    const SITE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const FIG = { income: "175000.50", billed: "90000.00", paid: "70000.00", stillToPay: "20000.00", salary: "39000.00", cashBalance: "66000.50", projectResult: "46000.50" };
    beforeEach(() => {
      save.mockClear();
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("/grid-exports/workbook")) return Promise.resolve(new Response(new Blob(["x"])));
          if (url.includes("/balance-sheet/site/")) return Promise.resolve(json(DETAIL));
          if (url.includes("/balance-sheet")) return Promise.resolve(json({ rows: [{ siteId: SITE, siteName: "Akwada", ...FIG }], totals: FIG }));
          return Promise.resolve(json({ rows: [], nextCursor: null, total: 0 }));
        }),
      );
    });
    afterEach(() => vi.unstubAllGlobals());

    it("writes a Summary sheet and a sheet for each project", async () => {
      const user = userEvent.setup();
      renderWithAuth(<BalanceSheetPage />, { permissions: ["reports-payments.view", "income.view"] });
      await screen.findByText("Akwada");
      await user.click(screen.getByRole("button", { name: /excel with details/i }));
      await waitFor(() => expect(save).toHaveBeenCalled());

      const call = vi.mocked(globalThis.fetch).mock.calls.find(([input]) => String(input).includes("/grid-exports/workbook"))!;
      const body = JSON.parse(String((call[1] as RequestInit).body)) as { sheets: { sheetName: string; rows: string[][] }[] };
      expect(body.sheets.map((sheet) => sheet.sheetName)).toEqual(["Summary", "Akwada"]);
      expect(body.sheets[1]!.rows.at(-1)).toEqual(["", "BALANCE (income - payments - salary)", "", "66000.50"]);
      // The same balance as the sheet's own Cash balance.
      expect(body.sheets[0]!.rows[0]).toContain("66000.50");
    });

    it("stacks the projects in one Details sheet past what one file may hold", async () => {
      const many = Array.from({ length: 31 }, (_, i) => ({ siteId: `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, "0")}`, siteName: `Site ${i}`, ...FIG }));
      vi.mocked(globalThis.fetch).mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/grid-exports/workbook")) return Promise.resolve(new Response(new Blob(["x"])));
        if (url.includes("/balance-sheet/site/")) return Promise.resolve(json(DETAIL));
        if (url.includes("/balance-sheet")) return Promise.resolve(json({ rows: many, totals: FIG }));
        return Promise.resolve(json({ rows: [], nextCursor: null, total: 0 }));
      });
      const user = userEvent.setup();
      renderWithAuth(<BalanceSheetPage />, { permissions: ["reports-payments.view", "income.view"] });
      await screen.findByText("Site 30");
      await user.click(screen.getByRole("button", { name: /excel with details/i }));
      await waitFor(() => expect(save).toHaveBeenCalled());
      const call = vi.mocked(globalThis.fetch).mock.calls.find(([input]) => String(input).includes("/grid-exports/workbook"))!;
      const body = JSON.parse(String((call[1] as RequestInit).body)) as { sheets: { sheetName: string; rows: string[][] }[] };
      expect(body.sheets.map((sheet) => sheet.sheetName)).toEqual(["Summary", "Details"]);
      expect(body.sheets[1]!.rows.filter((row) => (row[0] ?? "").startsWith("SITE "))).toHaveLength(31);
    });
  });
});
