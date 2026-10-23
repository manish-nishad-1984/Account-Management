import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmployeeFormDialog } from "./EmployeeFormDialog";
import { json, renderWithAuth } from "../../test/render";

/** The Employee Master (client request, 23 Oct 2026). */
const COMPANY = "99999999-9999-4999-8999-999999999999";
const COMPANIES = {
  rows: [
    {
      id: COMPANY, name: "DH PATEL", invoicePrefix: "DHP", gstNo: null, panNo: null, area: null, pincode: null,
      bankName: null, userCount: 0, capabilities: { canEdit: false, canDelete: false, canApprove: false },
    },
  ],
  nextCursor: null,
  total: 1,
};

describe("EmployeeFormDialog", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.endsWith("/companies")) return Promise.resolve(json(COMPANIES));
        return Promise.resolve(json({ id: "new" }, 201));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("adds up the net salary from basic, additions and deductions, and sends the employee", async () => {
    const user = userEvent.setup();
    renderWithAuth(<EmployeeFormDialog open employeeId={null} onClose={() => {}} />, { permissions: ["employee.view", "employee.add"] });

    await user.type(screen.getByLabelText(/employee name/i), "Ramesh Patel");
    await screen.findByRole("option", { name: "DH PATEL" });
    await user.selectOptions(screen.getByLabelText(/^company/i), COMPANY);
    await user.type(screen.getByLabelText(/date of joining/i), "2026-01-15");
    await user.type(screen.getByLabelText(/basic salary/i), "20000");

    await user.click(screen.getByRole("button", { name: /add addition/i }));
    await user.type(screen.getByLabelText("Name 1"), "Travel");
    await user.type(screen.getByLabelText("Amount 1"), "1500");
    await user.click(screen.getByRole("button", { name: /add addition/i }));
    await user.selectOptions(screen.getByLabelText("Type 2"), "deduction");
    await user.type(screen.getByLabelText("Name 2"), "PF");
    await user.type(screen.getByLabelText("Amount 2"), "1800");
    expect(screen.getByLabelText("Net salary")).toHaveTextContent("19,700.00");

    await user.click(screen.getByRole("button", { name: /create employee/i }));
    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true),
    );
    const post = vi.mocked(globalThis.fetch).mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({
      name: "Ramesh Patel",
      companyId: COMPANY,
      siteId: null,
      joinDate: "2026-01-15",
      basicSalary: "20000",
      isActive: true,
      items: [
        { kind: "addition", label: "Travel", amount: "1500" },
        { kind: "deduction", label: "PF", amount: "1800" },
      ],
    });
  });
});
