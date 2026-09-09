import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SalesInvoicesPage } from "./SalesInvoicesPage";
import { json, renderWithAuth, routeFetch } from "../../test/render";

/**
 * `sales-invoice`, SINGULAR — production `forms` id 27, active.
 *
 * Also worth knowing, and pinned by the last test in this file: production
 * grants user `ac` approve WITHOUT view on this row. The guards are checked
 * independently, so that combination is real rather than a data error to
 * paper over.
 */
const ALL_RIGHTS = [
  "sales-invoice.view",
  "sales-invoice.add",
  "sales-invoice.edit",
  "sales-invoice.delete",
  "sales-invoice.approve",
];

const SITE = "22222222-2222-2222-2222-222222222222";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  salesInvoiceNo: "DHP/26-27/001",
  customerInvoiceNo: null,
  invoiceType: "Sales",
  siteId: SITE,
  siteName: "Akwada Lake Front",
  customerId: "44444444-4444-4444-4444-444444444444",
  customerName: "RELIANCE INFRASTRUCTURE",
  companyId: "55555555-5555-5555-5555-555555555555",
  companyName: "DH PATEL",
  documentDate: "2026-08-07T00:00:00.000Z",
  subtotal: "15000.00",
  totalGstAmount: "2700.00",
  totalDiscount: "0.00",
  tds: "0.00",
  roundOff: "0.00",
  totalAmount: "17700.00",
  lineCount: 2,
  paymentStatus: null,
  isPaidIn: false,
  isApproved: false,
  createdAt: "2026-08-07T10:00:00.000Z",
  capabilities: { canEdit: true, canDelete: true, canApprove: true },
  ...overrides,
});

const list = (rows: unknown[]) => ({ rows, nextCursor: null, total: rows.length });

const routes = (rows: unknown[]) =>
  routeFetch([
    [/\/sales-invoices\/.+\/approval$/, json(row({ isApproved: true }))],
    [/\/sales-invoices$/, list(rows)],
    [/\/suppliers/, list([])],
    [/\/companies/, list([])],
    [/\/units$/, list([])],
    [/\/items/, list([])],
    [/\/sites\/assignable$/, { scope: "all", sites: [{ id: SITE, name: "Akwada Lake Front" }] }],
  ]);

const listCalls = () =>
  vi.mocked(globalThis.fetch).mock.calls.filter((call) =>
    String(call[0]).includes("/sales-invoices?"),
  );

const lastListUrl = () => new URL(String(listCalls().at(-1)![0]), "http://localhost");

describe("SalesInvoicesPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists an invoice by OUR number", async () => {
    routes([row()]);
    renderWithAuth(<SalesInvoicesPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("DHP/26-27/001")).toBeInTheDocument();
    expect(screen.getByText("RELIANCE INFRASTRUCTURE")).toBeInTheDocument();
    expect(screen.getByText("17,700.00")).toBeInTheDocument();
  });

  /**
   * The legacy list's column says Customer while its filter beside it says
   * Supplier — one party table, both sides of the trade. The column here is
   * named for what it means.
   */
  it("calls the counterparty column Customer", async () => {
    routes([row()]);
    renderWithAuth(<SalesInvoicesPage />, { permissions: ALL_RIGHTS });
    await screen.findByText("DHP/26-27/001");

    expect(screen.getByRole("columnheader", { name: /customer/i })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /^supplier$/i })).not.toBeInTheDocument();
  });

  it("shows the customer's own reference when there is one", async () => {
    routes([row({ customerInvoiceNo: "PO-7001" })]);
    renderWithAuth(<SalesInvoicesPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText(/Their ref PO-7001/)).toBeInTheDocument();
  });

  it("names the TDS on the row when there is one", async () => {
    routes([row({ tds: "500.00" })]);
    renderWithAuth(<SalesInvoicesPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText(/less 500\.00 TDS/)).toBeInTheDocument();
  });

  it("marks a sales return", async () => {
    routes([row({ invoiceType: "Sales Return" })]);
    renderWithAuth(<SalesInvoicesPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("Sales Return")).toBeInTheDocument();
  });

  it("renders an em dash for an invoice with no site", async () => {
    routes([row({ siteId: null, siteName: null })]);
    renderWithAuth(<SalesInvoicesPage />, { permissions: ALL_RIGHTS });
    await screen.findByText("DHP/26-27/001");

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("filters by invoice type", async () => {
    routes([row()]);
    const user = userEvent.setup();
    renderWithAuth(<SalesInvoicesPage />, { permissions: ALL_RIGHTS });
    await screen.findByText("DHP/26-27/001");

    await user.selectOptions(screen.getByLabelText(/^type$/i), "Credit Note");

    await waitFor(() => {
      expect(lastListUrl().searchParams.get("invoiceType")).toBe("Credit Note");
    });
  });

  /** Ours and NOT NULL, so unlike the purchase side it sorts as document order. */
  it("sorts on the invoice number by default", async () => {
    routes([row()]);
    renderWithAuth(<SalesInvoicesPage />, { permissions: ALL_RIGHTS });
    await screen.findByText("DHP/26-27/001");

    expect(lastListUrl().searchParams.get("sortBy")).toBe("salesInvoiceNo");
  });

  it("offers no active/inactive filter, because the table has no such column", async () => {
    routes([row()]);
    renderWithAuth(<SalesInvoicesPage />, { permissions: ALL_RIGHTS });
    await screen.findByText("DHP/26-27/001");

    expect(screen.queryByLabelText(/^status$/i)).not.toBeInTheDocument();
    expect(lastListUrl().searchParams.get("isActive")).toBeNull();
  });

  it("approves a row and asks the server to state it", async () => {
    routes([row()]);
    const user = userEvent.setup();
    renderWithAuth(<SalesInvoicesPage />, { permissions: ALL_RIGHTS });
    await screen.findByText("DHP/26-27/001");

    await user.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => {
      const call = vi
        .mocked(globalThis.fetch)
        .mock.calls.find(([url]) => String(url).includes("/approval"));
      expect(call).toBeDefined();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ isApproved: true });
    });
  });

  /** A real delete, and the wording says so — there is no soft-delete column. */
  it("warns that deleting is permanent and the number is not reissued", async () => {
    routes([row()]);
    const user = userEvent.setup();
    renderWithAuth(<SalesInvoicesPage />, { permissions: ALL_RIGHTS });
    await screen.findByText("DHP/26-27/001");

    await user.click(screen.getByRole("button", { name: /delete DHP\/26-27\/001/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/removed permanently/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/number is not reissued/i)).toBeInTheDocument();
  });

  it("hides the actions a permission does not grant", async () => {
    routes([row({ capabilities: { canEdit: false, canDelete: false, canApprove: false } })]);
    renderWithAuth(<SalesInvoicesPage />, { permissions: ["sales-invoice.view"] });
    await screen.findByText("DHP/26-27/001");

    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new invoice/i })).not.toBeInTheDocument();
  });

  /**
   * Production really does grant `ac` approve WITHOUT view on this form. The
   * rights are independent, so the Approve button appears for a user who has
   * only that — which is what the data asks for.
   */
  it("shows Approve for a user granted approve but not edit or delete", async () => {
    routes([row({ capabilities: { canEdit: false, canDelete: false, canApprove: true } })]);
    renderWithAuth(<SalesInvoicesPage />, {
      permissions: ["sales-invoice.view", "sales-invoice.approve"],
    });
    await screen.findByText("DHP/26-27/001");

    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit/i })).not.toBeInTheDocument();
  });
});
