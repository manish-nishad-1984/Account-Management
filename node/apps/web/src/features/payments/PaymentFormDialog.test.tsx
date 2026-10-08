import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentFormDialog } from "./PaymentFormDialog";
import { renderWithAuth, routeFetch } from "../../test/render";

const SUPPLIER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SITE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BILL_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const BILL_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const bill = (documentId: string, displayNo: string, pending: string) => ({
  id: `invoice:${documentId}`,
  documentId,
  source: "invoice",
  displayNo,
  label: "Purchase Invoice",
  documentDate: "2026-09-01T00:00:00.000Z",
  partyId: SUPPLIER,
  partyName: "Ambica Steel Traders",
  siteId: SITE,
  siteName: "Akwada",
  siteLocationId: null,
  siteLocationName: null,
  companyId: COMPANY,
  companyName: "DH PATEL",
  amount: pending,
  pending,
  balance: pending,
});

describe("PaymentFormDialog - naming the bills", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    routeFetch([
      [/\/payments$/, { created: 1 }],
      [/\/suppliers/, { rows: [{ id: SUPPLIER, name: "Ambica Steel Traders", mobile: null, email: null, gstNo: null, area: null, pincode: null, isApproved: true, openingBalance: null, capabilities: { canEdit: true, canDelete: true, canApprove: true } }], nextCursor: null, total: 1 }],
      [/\/companies/, { rows: [{ id: COMPANY, name: "DH PATEL", invoicePrefix: null, gstNo: null, panNo: null, area: null, pincode: null, bankName: null, userCount: 0, capabilities: { canEdit: true, canDelete: true, canApprove: true } }], nextCursor: null, total: 1 }],
      [/\/sites/, { scope: "all", sites: [{ id: SITE, name: "Akwada" }] }],
      [
        /\/reports\/pending-ledger/,
        {
          rows: [bill(BILL_A, "INV-1", "3000.00"), bill(BILL_B, "INV-2", "1500.00")],
          total: 2,
          nextCursor: null,
          totalAmount: "4500.00",
          totalPending: "4500.00",
        },
      ],
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the bills ticked, and the payment's amount follows them", async () => {
    const user = userEvent.setup();
    renderWithAuth(<PaymentFormDialog open direction="out" onClose={() => {}} />, {
      permissions: ["reports-payments.view", "reports-payments.add"],
      scope: { sites: [{ id: SITE, name: "Akwada" }] },
    });

    await screen.findByRole("option", { name: "Ambica Steel Traders" });
    await screen.findByRole("option", { name: "DH PATEL" });
    await screen.findByRole("option", { name: "Akwada" });
    await user.selectOptions(screen.getByLabelText("Supplier"), SUPPLIER);
    await user.selectOptions(screen.getByLabelText("Company"), COMPANY);
    await user.selectOptions(screen.getByLabelText("Site on row 1"), SITE);
    await user.click(screen.getByRole("button", { name: "Choose bills on row 1" }));

    await user.click(await screen.findByLabelText("Pay bill INV-2"));
    expect(screen.getByLabelText("Amount on row 1")).toHaveValue("1500.00");

    await user.click(screen.getByRole("button", { name: /save 1 payment/i }));

    await waitFor(() => {
      const post = vi
        .mocked(globalThis.fetch)
        .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse(String((post![1] as RequestInit).body));
      expect(body.payments[0].amount).toBe("1500.00");
      expect(body.payments[0].allocations).toEqual([{ source: "invoice", documentId: BILL_B, amount: "1500.00" }]);
    });
  });
});
