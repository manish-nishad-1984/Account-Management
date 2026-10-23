import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayoutListFormDialog } from "./PayoutListFormDialog";
import { buildImageRows, buildPayoutSheet } from "./imageModel";
import { buildPayoutMessage } from "./message";
import { json, renderWithAuth } from "../../test/render";

/** Salaries on the payout list (client request, 23 Oct 2026). */
const RAMESH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const SURESH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const due = (employeeId: string, employeeName: string, month: string, netSalary: string) => ({
  employeeId, employeeName, month, netSalary, companyId: "c1", companyName: "DH PATEL", siteName: "Akwada",
  basicSalary: netSalary, additions: "0.00", deductions: "0.00",
});
const DUE = { rows: [due(RAMESH, "Ramesh Patel", "2026-09", "19700.00"), due(SURESH, "Suresh Shah", "2026-09", "15000.00")] };

describe("salaries on the payout list", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.endsWith("/payout-lists/salaries-due")) return Promise.resolve(json(DUE));
        if (url.pathname.endsWith("/payout-lists/outstanding")) return Promise.resolve(json({ rows: [], total: "0.00" }));
        if (url.pathname.endsWith("/companies")) return Promise.resolve(json({ rows: [], nextCursor: null, total: 0 }));
        return Promise.resolve(json({ id: "new" }, 201));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("offers each salary due, pays the master's net salary when ticked, and lets this month's amount and a note change", async () => {
    const user = userEvent.setup();
    renderWithAuth(<PayoutListFormDialog open listId={null} onClose={() => {}} />, { permissions: ["payout.view", "payout.add"] });

    await user.click(await screen.findByLabelText("Pay salary of Ramesh Patel for Sep 2026"));
    const amount = screen.getByLabelText("Salary amount for Ramesh Patel for Sep 2026");
    expect(amount).toHaveValue("19,700.00");
    await user.clear(amount);
    await user.type(amount, "19000");
    await user.type(screen.getByLabelText("Note for Ramesh Patel for Sep 2026"), "2 days leave");
    expect(screen.getByText(/0 parties ticked, 1 salary/)).toBeInTheDocument();
    expect(screen.getByText("Total").parentElement).toHaveTextContent("19,000.00");

    await user.click(screen.getByRole("button", { name: /save list/i }));
    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true),
    );
    const post = vi.mocked(globalThis.fetch).mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({
      lines: [],
      salaries: [{ employeeId: RAMESH, month: "2026-09", amount: "19000", note: "2 days leave" }],
    });
  });

  it("puts the salaries on the picture, the text and the Excel, after the parties and in the total", () => {
    const list = {
      listDate: "2026-10-07",
      title: null,
      companyName: "DH PATEL",
      lines: [{ id: "l1", partyId: "p1", partyName: "AL BURHAN", amount: "1000.00", outstandingAtSave: null, outstandingNow: "0", extraPaid: null, invoices: [] }],
      salaries: [{ id: "s1", employeeId: RAMESH, employeeName: "Ramesh Patel", siteName: null, month: "2026-09", amount: "19000.00", note: null, paidAmount: null }],
    };
    const rows = buildImageRows(list);
    expect(rows.find((row) => row.kind === "party" && row.left.startsWith("Ramesh"))).toMatchObject({ left: "Ramesh Patel (Salary Sep 2026)", right: "Rs 19,000.00" });
    expect(rows[rows.length - 1]).toMatchObject({ left: "Total (1 party, 1 salary)", right: "Rs 20,000.00" });
    expect(buildPayoutMessage(list)).toContain("2. Ramesh Patel (Salary Sep 2026) - Rs 19,000.00");
    expect(buildPayoutSheet(list).rows).toEqual([
      ["AL BURHAN", "1000.00"],
      ["Ramesh Patel (Salary Sep 2026)", "19000.00"],
      ["Total (1 party, 1 salary)", "20000.00"],
    ]);
  });
});
