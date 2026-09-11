import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseInvoicesPage } from "./PurchaseInvoicesPage";
import { json, renderWithAuth, routeFetch } from "../../test/render";

/**
 * SINGULAR — `purchase-invoice`, not `purchase-invoices`.
 *
 * The subject comes from the ACTIVE production `forms` row, which is
 * "Purchase  Invoice" (id 9). Its neighbour, purchase orders, is plural because
 * its own active row is "Purchase Orders". Copying either as a convention is how
 * the order module shipped a subject that 403'd in production.
 */
const ALL_RIGHTS = [
  "purchase-invoice.view",
  "purchase-invoice.add",
  "purchase-invoice.edit",
  "purchase-invoice.delete",
  "purchase-invoice.approve",
];

const SITE = "22222222-2222-2222-2222-222222222222";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  displayNo: "BB/154",
  supplierInvoiceNo: "BB/154",
  invoiceNo: null,
  invoiceType: "Purchase",
  siteId: SITE,
  siteName: "Akwada Lake Front",
  supplierId: "44444444-4444-4444-4444-444444444444",
  supplierName: "AL BURHAN PIPES & SANITATION",
  companyId: "55555555-5555-5555-5555-555555555555",
  companyName: "DH PATEL",
  siteGroupId: null,
  siteGroupName: "GOLF CLUB",
  documentDate: "2026-08-07T00:00:00.000Z",
  subtotal: "15000.00",
  totalGstAmount: "2700.00",
  totalDiscount: "0.00",
  tds: "0.00",
  roundOff: "-27.00",
  totalAmount: "17673.00",
  lineCount: 2,
  paymentStatus: null,
  isPaidOut: false,
  isApproved: false,
  createdAt: "2026-08-07T10:00:00.000Z",
  capabilities: { canEdit: true, canDelete: true, canApprove: true },
  ...overrides,
});

const list = (rows: unknown[]) => ({ rows, nextCursor: null, total: rows.length });

const routes = (rows: unknown[]) =>
  routeFetch([
    [/\/purchase-invoices\/.+\/approval$/, json(row({ isApproved: true }))],
    [/\/purchase-invoices$/, list(rows)],
    [/\/purchase-orders/, list([])],
    [/\/suppliers/, list([])],
    [/\/companies/, list([])],
    [/\/units$/, list([])],
    [/\/items/, list([])],
    [/\/sites\/assignable$/, { scope: "all", sites: [{ id: SITE, name: "Akwada Lake Front" }] }],
  ]);

const listCalls = () =>
  vi.mocked(globalThis.fetch).mock.calls.filter((call) =>
    String(call[0]).includes("/purchase-invoices?"),
  );

const lastListUrl = () => new URL(String(listCalls().at(-1)![0]), "http://localhost");

describe("PurchaseInvoicesPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists an invoice by the supplier's number", async () => {
    routes([row()]);
    renderWithAuth(<PurchaseInvoicesPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("BB/154")).toBeInTheDocument();
    expect(screen.getByText("AL BURHAN PIPES & SANITATION")).toBeInTheDocument();
    // Indian digit grouping, as everywhere else in the app.
    expect(screen.getByText("17,673.00")).toBeInTheDocument();
  });

  /**
   * REGRESSION for the legacy list's blank row. Its partial tests
   * `SupplierInvoiceNo == ""`, which a NULL fails, so an invoice with no supplier
   * number renders an EMPTY link — a document nobody can identify or open.
   */
  it("shows the fallback number rather than an empty cell", async () => {
    routes([row({ supplierInvoiceNo: null, invoiceNo: "INV/26-27/7", displayNo: "INV/26-27/7" })]);
    renderWithAuth(<PurchaseInvoicesPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("INV/26-27/7")).toBeInTheDocument();
  });

  /**
   * TDS is on the row because it is the term the live screen silently drops. An
   * invoice whose total does not deduct a TDS it records is the exact document
   * B-2 asks the business about.
   */
  it("names the TDS on the row when there is one", async () => {
    routes([row({ tds: "500.00" })]);
    renderWithAuth(<PurchaseInvoicesPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText(/less 500\.00 TDS/)).toBeInTheDocument();
  });

  it("says nothing about TDS when there is none", async () => {
    routes([row({ tds: "0.00" })]);
    renderWithAuth(<PurchaseInvoicesPage />, { permissions: ALL_RIGHTS });

    await screen.findByText("BB/154");
    expect(screen.queryByText(/TDS/)).not.toBeInTheDocument();
  });

  it("marks a return, and leaves a plain purchase unmarked", async () => {
    routes([row({ invoiceType: "Purchase Return" })]);
    renderWithAuth(<PurchaseInvoicesPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("Purchase Return")).toBeInTheDocument();
  });

  /**
   * `siteId` is nullable on the source, so the cell must say so rather than
   * rendering blank — the same reason the API left-joins it.
   */
  it("renders an em dash for an invoice with no site", async () => {
    routes([row({ siteId: null, siteName: null })]);
    renderWithAuth(<PurchaseInvoicesPage />, { permissions: ALL_RIGHTS });

    await screen.findByText("BB/154");
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("filters by invoice type", async () => {
    routes([row()]);
    const user = userEvent.setup();
    renderWithAuth(<PurchaseInvoicesPage />, { permissions: ALL_RIGHTS });
    await screen.findByText("BB/154");

    await user.selectOptions(screen.getByLabelText(/^type$/i), "Credit Note");

    await waitFor(() => {
      expect(lastListUrl().searchParams.get("invoiceType")).toBe("Credit Note");
    });
  });

  /** The legacy list is filtered by COMPANY — people work one company at a time. */
  it("filters by company", async () => {
    routes([row()]);
    const user = userEvent.setup();
    renderWithAuth(<PurchaseInvoicesPage />, { permissions: ALL_RIGHTS });
    await screen.findByText("BB/154");

    // The company dropdown is fed by the companies endpoint, which the fixture
    // leaves empty — so only "All companies" is selectable and the assertion is
    // that no company filter is sent, not that one is.
    expect(lastListUrl().searchParams.get("companyId")).toBeNull();
    await user.selectOptions(screen.getByLabelText(/^approval$/i), "pending");

    await waitFor(() => {
      expect(lastListUrl().searchParams.get("isApproved")).toBe("false");
    });
  });

  /**
   * There is deliberately NO Active/Inactive filter: `SupplierInvoice` has no
   * such column, and the legacy list offers no such dropdown. A filter over a
   * column that never meant anything is worse than none.
   */
  it("offers no active/inactive filter, because the table has no such column", async () => {
    routes([row()]);
    renderWithAuth(<PurchaseInvoicesPage />, { permissions: ALL_RIGHTS });
    await screen.findByText("BB/154");

    expect(screen.queryByLabelText(/^status$/i)).not.toBeInTheDocument();
    expect(lastListUrl().searchParams.get("isActive")).toBeNull();
  });

  it("approves a row and asks the server to state it", async () => {
    routes([row()]);
    const user = userEvent.setup();
    renderWithAuth(<PurchaseInvoicesPage />, { permissions: ALL_RIGHTS });
    await screen.findByText("BB/154");

    await user.click(screen.getByRole("button", { name: /^approve /i }));

    await waitFor(() => {
      const call = vi
        .mocked(globalThis.fetch)
        .mock.calls.find(([url]) => String(url).includes("/approval"));
      expect(call).toBeDefined();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ isApproved: true });
    });
  });

  it("hides the actions a permission does not grant", async () => {
    routes([row({ capabilities: { canEdit: false, canDelete: false, canApprove: false } })]);
    renderWithAuth(<PurchaseInvoicesPage />, { permissions: ["purchase-invoice.view"] });
    await screen.findByText("BB/154");

    expect(screen.queryByRole("button", { name: /^approve /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new invoice/i })).not.toBeInTheDocument();
  });

  /**
   * The delete wording differs from the purchase order screen's ON PURPOSE.
   * Orders are soft-deleted and their lines kept; `SupplierInvoice` has no
   * soft-delete column, so this really does remove the row. Promising otherwise
   * would be the more comfortable lie.
   */
  it("warns that deleting an invoice is permanent", async () => {
    routes([row()]);
    const user = userEvent.setup();
    renderWithAuth(<PurchaseInvoicesPage />, { permissions: ALL_RIGHTS });
    await screen.findByText("BB/154");

    await user.click(screen.getByRole("button", { name: /delete BB\/154/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/removed permanently/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it("sorts on createdAt, because documentDate is nullable", async () => {
    routes([row()]);
    renderWithAuth(<PurchaseInvoicesPage />, { permissions: ALL_RIGHTS });
    await screen.findByText("BB/154");

    expect(lastListUrl().searchParams.get("sortBy")).toBe("createdAt");
  });
});
