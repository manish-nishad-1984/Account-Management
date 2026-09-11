import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseOrdersPage } from "./PurchaseOrdersPage";
import { json, renderWithAuth, routeFetch } from "../../test/render";

const ALL_RIGHTS = [
  "purchase-orders.view",
  "purchase-orders.add",
  "purchase-orders.edit",
  "purchase-orders.delete",
  "purchase-orders.approve",
];

const SITE = "22222222-2222-2222-2222-222222222222";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  poNo: "DHP/PO/24-25/049",
  siteId: SITE,
  siteName: "Akwada Lake Front",
  supplierId: "44444444-4444-4444-4444-444444444444",
  supplierName: "ASIAN GRANITO INDIA LIMITED",
  companyId: "55555555-5555-5555-5555-555555555555",
  companyName: "DH PATEL",
  documentDate: "2024-12-24T00:00:00.000Z",
  buyersPurchaseNo: null,
  subtotal: "3951763.00",
  totalGstAmount: "711317.34",
  totalAmount: "4663080.34",
  lineCount: 3,
  isActive: true,
  isApproved: false,
  createdAt: "2024-12-24T10:00:00.000Z",
  capabilities: { canEdit: true, canDelete: true, canApprove: true },
  ...overrides,
});

const list = (rows: unknown[]) => ({ rows, nextCursor: null, total: rows.length });

const routes = (rows: unknown[]) =>
  routeFetch([
    [/\/purchase-orders\/.+\/approval$/, json(row({ isApproved: true }))],
    [/\/purchase-orders$/, list(rows)],
    [/\/suppliers/, list([])],
    [/\/companies/, list([])],
    [/\/units$/, list([])],
    [/\/items/, list([])],
  ]);

const listCalls = () =>
  vi.mocked(globalThis.fetch).mock.calls.filter((call) =>
    String(call[0]).includes("/purchase-orders?"),
  );

const lastListUrl = () => new URL(String(listCalls().at(-1)![0]), "http://localhost");

describe("PurchaseOrdersPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the order number, supplier, company and site", async () => {
    routes([row()]);
    renderWithAuth(<PurchaseOrdersPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("DHP/PO/24-25/049")).toBeInTheDocument();
    expect(screen.getByText("ASIAN GRANITO INDIA LIMITED")).toBeInTheDocument();
    expect(screen.getByText("DH PATEL")).toBeInTheDocument();
    expect(screen.getByText("Akwada Lake Front")).toBeInTheDocument();
  });

  /**
   * The legacy list renders this total Western-grouped — ₹4,663,080.34. The port
   * groups it the Indian way, which is a deliberate change to what people read on
   * the same document (`00-shell-and-navigation.md`).
   */
  it("groups the total the Indian way, not the way the legacy screen does", async () => {
    routes([row()]);
    renderWithAuth(<PurchaseOrdersPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText(/46,63,080\.34/)).toBeInTheDocument();
    expect(screen.queryByText(/4,663,080\.34/)).not.toBeInTheDocument();
  });

  /**
   * `@item.Poid - @item.BuyersPurchaseNo` in one legacy cell is what made
   * `07-purchase-orders.md` read the buyer's reference as a suffix ON the number.
   * They are two fields and the number stays clean.
   */
  it("keeps the buyer's reference out of the order number", async () => {
    routes([row({ buyersPurchaseNo: "OMSAGAR" })]);
    renderWithAuth(<PurchaseOrdersPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("DHP/PO/24-25/049")).toBeInTheDocument();
    expect(screen.getByText(/Buyer's ref OMSAGAR/)).toBeInTheDocument();
    expect(screen.queryByText("DHP/PO/24-25/049 - OMSAGAR")).not.toBeInTheDocument();
  });

  /** The legacy status dropdown defaults to Active rather than All. */
  it("asks for active orders by default", async () => {
    routes([row()]);
    renderWithAuth(<PurchaseOrdersPage />, { permissions: ALL_RIGHTS });

    await screen.findByText("DHP/PO/24-25/049");
    await waitFor(() => expect(lastListUrl().searchParams.get("isActive")).toBe("true"));
  });

  it("drops the filter when both are asked for", async () => {
    routes([row()]);
    const user = userEvent.setup();
    renderWithAuth(<PurchaseOrdersPage />, { permissions: ALL_RIGHTS });

    await screen.findByText("DHP/PO/24-25/049");
    await user.selectOptions(screen.getByLabelText("Status"), "all");

    await waitFor(() => expect(lastListUrl().searchParams.get("isActive")).toBeNull());
  });

  it("marks an inactive order on the row", async () => {
    routes([row({ isActive: false })]);
    renderWithAuth(<PurchaseOrdersPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("Inactive")).toBeInTheDocument();
  });

  it("shows how many lines an order has", async () => {
    routes([row({ lineCount: 3 })]);
    renderWithAuth(<PurchaseOrdersPage />, { permissions: ALL_RIGHTS });

    await screen.findByText("DHP/PO/24-25/049");
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides New order from someone without the add right", async () => {
    routes([row()]);
    renderWithAuth(<PurchaseOrdersPage />, { permissions: ["purchase-orders.view"] });

    await screen.findByText("DHP/PO/24-25/049");
    expect(screen.queryByRole("button", { name: /new order/i })).not.toBeInTheDocument();
  });

  it("shows New order to someone with it", async () => {
    routes([row()]);
    renderWithAuth(<PurchaseOrdersPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByRole("button", { name: /new order/i })).toBeInTheDocument();
  });

  it("hides Approve from someone without the approve right", async () => {
    routes([row({ capabilities: { canEdit: true, canDelete: true, canApprove: false } })]);
    renderWithAuth(<PurchaseOrdersPage />, { permissions: ["purchase-orders.view"] });

    await screen.findByText("DHP/PO/24-25/049");
    expect(screen.queryByRole("button", { name: /^approve/i })).not.toBeInTheDocument();
  });

  /** The value is stated, not toggled from what the row happens to show. */
  it("sends the intended approval value rather than a toggle", async () => {
    routes([row({ isApproved: false })]);
    const user = userEvent.setup();
    renderWithAuth(<PurchaseOrdersPage />, { permissions: ALL_RIGHTS });

    await screen.findByText("DHP/PO/24-25/049");
    // The accessible name is the button's TEXT ("Approve"), not its `title` —
    // visible content wins over the title attribute in the name computation.
    await user.click(screen.getByRole("button", { name: /^approve /i }));

    await waitFor(() => {
      const call = vi
        .mocked(globalThis.fetch)
        .mock.calls.find((entry) => String(entry[0]).includes("/approval"));
      expect(call).toBeDefined();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ isApproved: true });
    });
  });

  it("filters by approval state", async () => {
    routes([row()]);
    const user = userEvent.setup();
    renderWithAuth(<PurchaseOrdersPage />, { permissions: ALL_RIGHTS });

    await screen.findByText("DHP/PO/24-25/049");
    await user.selectOptions(screen.getByLabelText("Approval"), "pending");

    await waitFor(() => expect(lastListUrl().searchParams.get("isApproved")).toBe("false"));
  });
});
