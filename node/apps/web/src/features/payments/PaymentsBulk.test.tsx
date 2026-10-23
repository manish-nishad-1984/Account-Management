import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsPage } from "./PaymentsPage";
import { json, renderWithAuth } from "../../test/render";

/** Supplier and company filters, deleting several, and the import (client, 23 Oct 2026). */
const SUPPLIER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const COMPANY = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

const payment = (id: string, amount: string, partyName: string) => ({
  id, direction: "out", kind: "payment", partyId: SUPPLIER, partyName, companyId: COMPANY, companyName: "DH PATEL",
  siteId: "s1", siteName: "Akwada", siteLocationId: null, siteLocationName: null, paymentDate: "2026-10-05T00:00:00.000Z",
  amount, description: null, method: "NEFT", referenceNo: null, createdAt: "2026-10-05T09:00:00.000Z",
  capabilities: { canEdit: true, canDelete: true, canApprove: false },
});
const ROWS = [payment(P1, "1000.00", "SHAH ENTERPRISE"), payment(P2, "2500.00", "AL BURHAN")];
const options = (rows: Record<string, unknown>[]) => ({ rows: rows.map((row) => ({ ...row, capabilities: { canEdit: false, canDelete: false, canApprove: false } })), nextCursor: null, total: rows.length });

const calls = () => vi.mocked(globalThis.fetch).mock.calls.map(([input, init]) => ({ url: String(input), init: init as RequestInit | undefined }));

describe("payments: filters, delete several, import", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.endsWith("/payments/delete-many")) return Promise.resolve(json({ deleted: 2 }));
        if (url.pathname.endsWith("/payments")) return Promise.resolve(json({ rows: ROWS, nextCursor: null, total: 2 }));
        if (url.pathname.endsWith("/suppliers")) return Promise.resolve(json(options([{ id: SUPPLIER, name: "SHAH ENTERPRISE", mobile: null, email: null, gstNo: null, area: null, pincode: null, isApproved: true, openingBalance: null }])));
        if (url.pathname.endsWith("/companies")) return Promise.resolve(json(options([{ id: COMPANY, name: "DH PATEL", invoicePrefix: "DHP", gstNo: null, panNo: null, area: null, pincode: null, bankName: null, userCount: 0 }])));
        return Promise.resolve(json({ rows: [], nextCursor: null, total: 0 }));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks for one supplier's and one company's payments", async () => {
    const user = userEvent.setup();
    renderWithAuth(<PaymentsPage />, { permissions: ["reports-payments.view"] });
    await screen.findByText("AL BURHAN");
    await screen.findByRole("option", { name: "SHAH ENTERPRISE" });
    await user.selectOptions(screen.getByLabelText("Supplier"), SUPPLIER);
    await screen.findByRole("option", { name: "DH PATEL" });
    await user.selectOptions(screen.getByLabelText("Company"), COMPANY);
    await waitFor(() =>
      expect(calls().some(({ url }) => url.includes("/payments?") && url.includes(`partyId=${SUPPLIER}`) && url.includes(`companyId=${COMPANY}`))).toBe(true),
    );
  });

  it("deletes the ticked payments together, only after a confirmation", async () => {
    const user = userEvent.setup();
    renderWithAuth(<PaymentsPage />, { permissions: ["reports-payments.view", "reports-payments.delete"] });
    await screen.findByText("AL BURHAN");

    await user.click(screen.getByLabelText("Tick every payment on this page"));
    expect(screen.getByText(/2 payments ticked · 3,500.00/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /delete ticked/i }));

    const dialog = await screen.findByRole("dialog", { name: /delete 2 payments/i });
    expect(dialog).toHaveTextContent("3,500.00");
    // Nothing goes before the confirmation.
    expect(calls().some(({ url }) => url.includes("delete-many"))).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(calls().some(({ url }) => url.includes("delete-many"))).toBe(true));
    const sent = calls().find(({ url }) => url.includes("delete-many"))!;
    expect(JSON.parse(String(sent.init!.body))).toEqual({ ids: [P1, P2] });
  });

  it("offers ticking only to someone who may delete, and Import only to someone who may add", async () => {
    const { unmount } = renderWithAuth(<PaymentsPage />, { permissions: ["reports-payments.view"] });
    await screen.findByText("AL BURHAN");
    expect(screen.queryByLabelText("Tick every payment on this page")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^import$/i })).not.toBeInTheDocument();
    unmount();

    renderWithAuth(<PaymentsPage />, { permissions: ["reports-payments.view", "reports-payments.add"] });
    await screen.findByText("AL BURHAN");
    expect(screen.getByRole("button", { name: /^import$/i })).toBeInTheDocument();
  });
});
