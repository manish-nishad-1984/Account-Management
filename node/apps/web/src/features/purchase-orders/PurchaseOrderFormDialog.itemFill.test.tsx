import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseOrderFormDialog } from "./PurchaseOrderFormDialog";
import { AuthProvider } from "../../contexts/AuthContext";
import { SiteScopeProvider } from "../../contexts/SiteScopeContext";

/**
 * CHOOSING AN ITEM FILLS QUANTITY 1 AND THE LATEST PRICE (client, 17 Sep 2026).
 *
 * The two invoice forms already did this; the purchase order did not, which is
 * the gap this covers. `direction: "in"` is asserted because a purchase order
 * BUYS — offering the price last charged to a customer would be the expensive
 * way to get this wrong, and it is invisible without a test.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ITEM = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "OPC 53 Grade Cement",
  unitId: 1,
  unitName: "Bag",
  pricePerUnit: "395.00",
  gstPercent: "18.00",
  gstAmount: "0.00",
  hsnCode: "25232910",
  isApproved: true,
  capabilities: { canEdit: true, canDelete: true, canApprove: false },
};

const LATEST_PRICE = {
  itemId: ITEM.id,
  source: "purchase-invoice" as const,
  unitPrice: "412.50",
  unitId: 1,
  gstPercent: "18.00",
  discountPerUnit: "0.00",
  documentDate: "2026-09-10T00:00:00.000Z",
  displayNo: "PI/26-27/004",
  partyName: "A-ONE SURVEYS",
};

const UNITS = {
  rows: [
    { id: 1, name: "Bag", itemCount: 4, capabilities: { canEdit: true, canDelete: true, canApprove: false } },
  ],
  nextCursor: null,
  total: 1,
};

/** Every URL this form touches, answered by path. */
const routeFetch = () => {
  vi.mocked(globalThis.fetch).mockImplementation((input) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    if (path.includes("/latest-price")) return Promise.resolve(json(LATEST_PRICE));
    if (path.startsWith("/api/v1/units")) return Promise.resolve(json(UNITS));
    if (path.startsWith("/api/v1/items")) {
      return Promise.resolve(json({ rows: [ITEM], nextCursor: null, total: 1 }));
    }
    return Promise.resolve(json({ rows: [], nextCursor: null, total: 0 }));
  });
};

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <SiteScopeProvider userId={null}>
          <PurchaseOrderFormDialog open orderId={null} onClose={vi.fn()} />
        </SiteScopeProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const urlsCalled = () =>
  vi.mocked(globalThis.fetch).mock.calls.map((c) => String(c[0]));

describe("choosing an item on a purchase order line", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
    routeFetch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const pickTheItem = async () => {
    const user = userEvent.setup();
    const box = await screen.findByLabelText(/item on line 1/i);
    await user.type(box, "OPC");
    const option = await screen.findByText(ITEM.name);
    await user.click(option);
    return user;
  };

  it("sets the quantity to 1 and fills the latest price", async () => {
    renderForm();
    await pickTheItem();

    await waitFor(() =>
      expect(screen.getByLabelText(/price on line 1/i)).toHaveValue(LATEST_PRICE.unitPrice),
    );
    expect(screen.getByLabelText(/quantity on line 1/i)).toHaveValue("1");
    expect(screen.getByLabelText(/gst percent on line 1/i)).toHaveValue(LATEST_PRICE.gstPercent);
  });

  /**
   * A purchase order BUYS. Asking for `direction=out` would offer the price last
   * charged to a customer as the price to pay a supplier.
   */
  it("asks for the price last PAID, not the price last charged", async () => {
    renderForm();
    await pickTheItem();

    await waitFor(() => expect(urlsCalled().some((u) => u.includes("latest-price"))).toBe(true));
    const call = urlsCalled().find((u) => u.includes("latest-price"))!;
    expect(call).toContain("direction=in");
    expect(call).not.toContain("direction=out");
  });

  it("keeps a quantity already typed rather than resetting it to 1", async () => {
    renderForm();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/quantity on line 1/i), "12");

    await pickTheItem();

    await waitFor(() =>
      expect(screen.getByLabelText(/price on line 1/i)).toHaveValue(LATEST_PRICE.unitPrice),
    );
    expect(screen.getByLabelText(/quantity on line 1/i)).toHaveValue("12");
  });
});
