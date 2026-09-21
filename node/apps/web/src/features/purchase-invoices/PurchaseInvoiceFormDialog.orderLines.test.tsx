import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseInvoiceFormDialog } from "./PurchaseInvoiceFormDialog";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * CHOOSING A PURCHASE ORDER BRINGS ITS PRODUCTS IN (client, 17 Sep 2026).
 *
 * The third test is the one that matters most: typed lines are NOT thrown away.
 * There is no undo on this form, so replacing someone's work without asking
 * would be the expensive kind of helpful.
 */
const SUPPLIER_ID = "11111111-1111-1111-8111-111111111111";
const ORDER_ID = "22222222-2222-2222-8222-222222222222";
const COMPANY_ID = "33333333-3333-3333-8333-333333333333";
const SITE_ID = "44444444-4444-4444-8444-444444444444";

const list = (rows: unknown[]) => ({ rows, nextCursor: null, total: rows.length });
const caps = { canEdit: true, canDelete: true, canApprove: false };

const SUPPLIER = {
  id: SUPPLIER_ID,
  name: "A-ONE SURVEYS",
  mobile: null,
  email: null,
  gstNo: null,
  area: "Surat",
  pincode: null,
  isApproved: true,
  openingBalance: "0.00",
  capabilities: caps,
};

const COMPANY = {
  id: COMPANY_ID,
  name: "D H INFRA",
  invoicePrefix: "DH26-27",
  gstNo: null,
  panNo: null,
  area: null,
  pincode: null,
  bankName: null,
  userCount: 1,
  capabilities: caps,
};

const ORDER_ROW = {
  id: ORDER_ID,
  poNo: "PO/26-27/007",
  siteId: SITE_ID,
  siteName: "Akwada Lake Front",
  supplierId: SUPPLIER_ID,
  supplierName: SUPPLIER.name,
  companyId: COMPANY_ID,
  companyName: COMPANY.name,
  documentDate: "2026-09-15T00:00:00.000Z",
  buyersPurchaseNo: null,
  subtotal: "10400.00",
  totalGstAmount: "1872.00",
  totalAmount: "12272.00",
  lineCount: 2,
  isActive: true,
  isApproved: true,
  createdAt: "2026-09-15T00:00:00.000Z",
  capabilities: caps,
};

/** The detail is the row minus the joined names, plus the lines. */
const ORDER_DETAIL = (() => {
  const {
    capabilities: _caps,
    siteName: _site,
    supplierName: _supplier,
    companyName: _company,
    lineCount: _lines,
    ...rest
  } = ORDER_ROW;
  return {
    ...rest,
    siteLocationId: null,
    deliveryDate: null,
    deliveryImmediate: false,
    contactName: null,
    contactNumber: null,
    otherContactName: null,
    otherContactNumber: null,
    dispatchBy: null,
    paymentTerms: null,
    shippingAddress: null,
    terms: null,
    termsTemplate: null,
    description: null,
    billingAddress: null,
    groupAddress: null,
    totalDiscount: "0.00",
    deliveryAddresses: [],
    items: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        itemId: "55555555-5555-4555-8555-555555555551",
        itemLabel: "OPC 53 Grade Cement",
        itemDescription: null,
        hsnCode: "25232910",
        unitId: 1,
        unitName: "Bag",
        quantity: "20",
        unitPrice: "395.00",
        gstPercent: "18.00",
        gstAmount: "1422.00",
        lineTotal: "9322.00",
        lineNumber: 1,
      },
      {
        // Free text on the order, and it must stay free text on the invoice.
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        itemId: null,
        itemLabel: "Site levelling charges",
        itemDescription: null,
        hsnCode: null,
        unitId: 1,
        unitName: "Bag",
        quantity: "1",
        unitPrice: "2500.00",
        gstPercent: "18.00",
        gstAmount: "450.00",
        lineTotal: "2950.00",
        lineNumber: 2,
      },
    ],
  };
})();

const routes = () =>
  routeFetch([
    [/\/sites\/assignable$/, { scope: "all", sites: [{ id: SITE_ID, name: "Akwada Lake Front" }] }],
    [/\/units/, list([{ id: 1, name: "Bag", itemCount: 1, capabilities: caps }])],
    [/\/items/, list([])],
    [/\/suppliers/, list([SUPPLIER])],
    [/\/companies/, list([COMPANY])],
    // The detail must be matched BEFORE the list, or the list answers it.
    [new RegExp(`/purchase-orders/${ORDER_ID}$`), ORDER_DETAIL],
    [/\/purchase-orders/, list([ORDER_ROW])],
    [/\/purchase-invoices/, list([])],
  ]);

const open = () =>
  renderWithAuth(<PurchaseInvoiceFormDialog open invoiceId={null} onClose={() => {}} />, {
    permissions: ["purchase-invoice.view", "purchase-invoice.add"],
  });

/** Pick the supplier, then the order, as a person does. */
const chooseOrder = async (user: ReturnType<typeof userEvent.setup>) => {
  const supplier = await screen.findByRole("combobox", { name: "Supplier" });
  await waitFor(() =>
    expect(screen.getByRole("option", { name: SUPPLIER.name })).toBeInTheDocument(),
  );
  await user.selectOptions(supplier, SUPPLIER_ID);

  await waitFor(() =>
    expect(screen.getByRole("option", { name: /PO\/26-27\/007/ })).toBeInTheDocument(),
  );
  await user.selectOptions(screen.getByRole("combobox", { name: "Purchase order" }), ORDER_ID);
};

describe("choosing a purchase order on an invoice", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
    routes();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("brings the order's products into the lines", async () => {
    const user = userEvent.setup();
    open();
    await chooseOrder(user);

    await waitFor(() => expect(screen.getByLabelText(/quantity on line 1/i)).toHaveValue("20"));
    expect(screen.getByLabelText(/price on line 1/i)).toHaveValue("395.00");
    expect(screen.getByLabelText(/gst percent on line 1/i)).toHaveValue("18.00");

    expect(screen.getByLabelText(/quantity on line 2/i)).toHaveValue("1");
    expect(screen.getByLabelText(/price on line 2/i)).toHaveValue("2500.00");
  });

  /**
   * A purchase order has no discount column, so nothing is carried into the
   * invoice's own Disc/unit — it stays blank and editable.
   */
  it("leaves the invoice's discount blank, because an order has none", async () => {
    const user = userEvent.setup();
    open();
    await chooseOrder(user);

    await waitFor(() => expect(screen.getByLabelText(/quantity on line 1/i)).toHaveValue("20"));
    expect(screen.getByLabelText(/disc.*on line 1/i)).toHaveValue("");
  });

  /**
   * THE ONE THAT PROTECTS TYPED WORK. Someone who has entered lines and then
   * links the order is offered the swap rather than having it done to them.
   */
  it("does not overwrite lines already typed, but offers to", async () => {
    const user = userEvent.setup();
    open();

    await user.type(await screen.findByLabelText(/quantity on line 1/i), "7");
    await user.type(screen.getByLabelText(/price on line 1/i), "99.00");

    await chooseOrder(user);

    const offer = await screen.findByRole("button", { name: /load the order/i });
    expect(screen.getByLabelText(/quantity on line 1/i)).toHaveValue("7");
    expect(screen.getByLabelText(/price on line 1/i)).toHaveValue("99.00");

    await user.click(offer);

    await waitFor(() => expect(screen.getByLabelText(/quantity on line 1/i)).toHaveValue("20"));
    expect(screen.getByLabelText(/price on line 1/i)).toHaveValue("395.00");
  });
});
