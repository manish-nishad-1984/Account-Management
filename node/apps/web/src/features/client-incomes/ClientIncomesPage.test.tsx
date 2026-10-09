import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientIncomesPage } from "./ClientIncomesPage";
import { ClientsPage } from "../clients/ClientsPage";
import { renderWithAuth, routeFetch } from "../../test/render";

const CAPS = { canEdit: true, canDelete: true, canApprove: false };
const EMPTY = { rows: [], nextCursor: null, total: 0 };

const income = {
  id: "11111111-1111-4111-8111-111111111111",
  incomeDate: "2026-10-05",
  siteId: "s1",
  siteName: "Akwada Lake Front",
  companyId: "c1",
  companyName: "DH Patel",
  clientId: "k1",
  clientName: "Shah Developers",
  amount: "1000000.00",
  additionalTotal: "50000.00",
  deductionTotal: "25000.00",
  total: "1025000.00",
  method: "NEFT",
  referenceNo: "UTR123",
  createdAt: "2026-10-05T09:00:00.000Z",
  capabilities: CAPS,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Income screen", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    routeFetch([
      [/\/client-incomes$/, { rows: [income], nextCursor: null, total: 1, totalAmount: "1025000.00" }],
      [/\/companies/, EMPTY],
    ]);
  });

  it("lists an entry with its additions, deductions and final total, and sums the total", async () => {
    renderWithAuth(<ClientIncomesPage />, { permissions: ["income.view"] });

    expect(await screen.findByText("Shah Developers")).toBeInTheDocument();
    expect(screen.getByText("+ 50,000.00")).toBeInTheDocument();
    expect(screen.getByText("− 25,000.00")).toBeInTheDocument();
    // The row's final total, and the same figure in the summary above the grid.
    expect(screen.getAllByText("10,25,000.00").length).toBeGreaterThanOrEqual(2);
  });

  it("offers Record income only to someone who may add", async () => {
    const { unmount } = renderWithAuth(<ClientIncomesPage />, { permissions: ["income.view"] });
    await screen.findByText("Shah Developers");
    expect(screen.queryByRole("button", { name: /record income/i })).not.toBeInTheDocument();
    unmount();

    renderWithAuth(<ClientIncomesPage />, { permissions: ["income.view", "income.add"] });
    expect(await screen.findByRole("button", { name: /record income/i })).toBeInTheDocument();
  });
});

describe("the Clients screen", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    routeFetch([
      [
        /\/clients/,
        {
          rows: [
            { id: "k1", name: "Shah Developers", mobile: "9876543210", email: null, gstNo: null, panNo: null, siteNames: ["Akwada Lake Front"], capabilities: CAPS },
            { id: "k2", name: "Unlinked Co", mobile: null, email: null, gstNo: null, panNo: null, siteNames: [], capabilities: CAPS },
          ],
          nextCursor: null,
          total: 2,
        },
      ],
    ]);
  });

  it("shows the projects each client pays for, and flags one with none", async () => {
    renderWithAuth(<ClientsPage />, { permissions: ["client.view", "client.add"] });

    expect(await screen.findByText("Akwada Lake Front")).toBeInTheDocument();
    expect(screen.getByText("No project linked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add client/i })).toBeInTheDocument();
  });
});
