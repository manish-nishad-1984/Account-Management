import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientIncomeFormDialog } from "./ClientIncomeFormDialog";
import { renderWithAuth, routeFetch } from "../../test/render";

const SITE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COMPANY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAPS = { canEdit: true, canDelete: true, canApprove: false };

const company = (id: string, name: string) => ({
  id,
  name,
  invoicePrefix: null,
  gstNo: null,
  panNo: null,
  area: null,
  pincode: null,
  bankName: null,
  userCount: 0,
  capabilities: CAPS,
});

describe("ClientIncomeFormDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    routeFetch([
      [/\/client-incomes$/, { id: "x" }],
      [
        /\/clients/,
        {
          rows: [{ id: CLIENT, name: "Shah Developers", mobile: null, email: null, gstNo: null, panNo: null, siteNames: ["Akwada"], capabilities: CAPS }],
          nextCursor: null,
          total: 1,
        },
      ],
      [
        /\/companies/,
        { rows: [company(COMPANY, "DH Patel"), company("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "DH Maharaj")], nextCursor: null, total: 2 },
      ],
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const open = () =>
    renderWithAuth(<ClientIncomeFormDialog open incomeId={null} onClose={() => {}} />, {
      permissions: ["income.view", "income.add"],
      scope: { siteId: SITE, siteName: "Akwada", sites: [{ id: SITE, name: "Akwada" }] },
    });

  it("takes the project from the header and offers only that project's clients", async () => {
    open();
    expect(await screen.findByText("Akwada")).toBeInTheDocument();
    expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
    // The one client of the project is picked for the user.
    await waitFor(() => expect(screen.getByLabelText(/^Client/)).toHaveValue(CLIENT));
    const clientCall = vi.mocked(globalThis.fetch).mock.calls.find(([url]) => String(url).includes("/clients"));
    expect(String(clientCall![0])).toContain(`siteId=${SITE}`);
  });

  it("shows the final total as amount plus additions minus deductions, and sends the lines", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("option", { name: "DH Patel" });
    await user.selectOptions(screen.getByLabelText(/^Company/), COMPANY);
    await user.type(screen.getByLabelText(/^Amount$/), "1000000");

    await user.click(screen.getByRole("button", { name: "Add additional" }));
    await user.type(screen.getByLabelText("Additional amount 1"), "50000");
    await user.type(screen.getByLabelText("Additional remark 1"), "Extra work");

    await user.click(screen.getByRole("button", { name: "Add deduction" }));
    await user.type(screen.getByLabelText("Deduction amount 1"), "20000");
    await user.type(screen.getByLabelText("Deduction remark 1"), "TDS");
    await user.click(screen.getByRole("button", { name: "Add deduction" }));
    await user.type(screen.getByLabelText("Deduction amount 2"), "5000");
    await user.type(screen.getByLabelText("Deduction remark 2"), "Discount");

    expect(screen.getByText("10,25,000.00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save income/i }));

    await waitFor(() => {
      const post = vi
        .mocked(globalThis.fetch)
        .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse(String((post![1] as RequestInit).body));
      expect(body).toMatchObject({ siteId: SITE, companyId: COMPANY, clientId: CLIENT, amount: "1000000" });
      expect(body.additions).toEqual([{ amount: "50000", remark: "Extra work" }]);
      expect(body.deductions).toEqual([
        { amount: "20000", remark: "TDS" },
        { amount: "5000", remark: "Discount" },
      ]);
    });
  });

  it("will not save without a company, and says so", async () => {
    const user = userEvent.setup();
    open();
    await waitFor(() => expect(screen.getByLabelText(/^Client/)).toHaveValue(CLIENT));
    await user.type(screen.getByLabelText(/^Amount$/), "500");
    await user.click(screen.getByRole("button", { name: /save income/i }));

    expect(await screen.findByText(/choose the company/i)).toBeInTheDocument();
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toBe(false);
  });

  it("warns when the deductions are more than the amount", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText(/^Amount$/), "100");
    await user.click(screen.getByRole("button", { name: "Add deduction" }));
    await user.type(screen.getByLabelText("Deduction amount 1"), "150");
    expect(await screen.findByText(/deductions are more than the amount/i)).toBeInTheDocument();
  });
});
