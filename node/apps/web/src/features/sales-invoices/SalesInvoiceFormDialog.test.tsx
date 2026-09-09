import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SalesInvoiceFormDialog } from "./SalesInvoiceFormDialog";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * The sales form shares its grid with the purchase one — `InvoiceLineGrid` —
 * so these do NOT re-test the arithmetic that file already covers. What they
 * cover is what this screen does differently:
 *
 *  - the number is OURS and issued on save, so there is no box for it;
 *  - the counterparty is the CUSTOMER, from the supplier master;
 *  - there is no purchase-order link;
 *  - a company with no invoice prefix cannot number an invoice, and is warned
 *    about before the save rather than refused after it.
 *
 * Plus one shared behaviour worth pinning HERE too: the grid and the totals are
 * wired to this form's own `useWatch`, and a form that renders the grid without
 * connecting it would still pass every test in the grid's own file.
 */

const list = (rows: unknown[]) => ({ rows, nextCursor: null, total: rows.length });

const UNIT = { id: 1, name: "Bag", createdAt: "2026-01-01T00:00:00.000Z" };

// Every field `companyRowSchema` requires. A fixture missing one does not fail
// loudly — the parse throws inside the query, the dropdown sits on "Loading
// companies…" forever, and the test reads as though the SELECT were broken.
const COMPANY = {
  id: "55555555-5555-5555-5555-555555555555",
  name: "DH PATEL",
  invoicePrefix: "DHP",
  gstNo: null,
  panNo: null,
  area: null,
  pincode: null,
  bankName: null,
  userCount: 0,
  capabilities: { canEdit: true, canDelete: true, canApprove: true },
};

const NO_PREFIX = { ...COMPANY, id: "66666666-6666-6666-6666-666666666666", name: "NO PREFIX LTD", invoicePrefix: null };

const routes = (companies: unknown[] = [COMPANY]) =>
  routeFetch([
    [/\/sites\/assignable$/, { scope: "all", sites: [{ id: "s1", name: "Akwada Lake Front" }] }],
    [/\/units/, list([UNIT])],
    [/\/items/, list([])],
    [/\/suppliers/, list([])],
    [/\/companies/, list(companies)],
    [/\/sales-invoices/, list([])],
  ]);

const open = () =>
  renderWithAuth(<SalesInvoiceFormDialog open invoiceId={null} onClose={() => {}} />, {
    permissions: ["sales-invoice.view", "sales-invoice.add"],
  });

const grid = () => {
  const tables = screen.getAllByRole("table");
  return tables.find((t) => /gst/i.test(t.querySelector("thead")?.textContent ?? ""))!;
};

const line = (index: number) =>
  within(grid().querySelector("tbody")!).getAllByRole("row")[index]!;

const totalAmount = () =>
  screen.getByText(/^total amount$/i).parentElement!.querySelector("div:last-child")!.textContent;

describe("SalesInvoiceFormDialog", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says the number is issued on save, rather than showing a box for it", async () => {
    routes();
    open();
    await screen.findByRole("table");

    expect(screen.getByText(/invoice number is issued when this is saved/i)).toBeInTheDocument();
    // The legacy form's Invoice No box is empty and EDITABLE — worse than the
    // purchase order's disabled one, because it can be typed over before submit.
    expect(screen.queryByLabelText(/invoice number/i)).not.toBeInTheDocument();
  });

  it("asks for a CUSTOMER, and says where that list comes from", async () => {
    routes();
    open();
    await screen.findByRole("table");

    expect(screen.getByLabelText(/customer/i)).toBeInTheDocument();
    expect(screen.getByText(/customers and suppliers share one list/i)).toBeInTheDocument();
  });

  /** `13-create-sales-invoice.md`: "No Active PO row". */
  it("has no purchase order link", async () => {
    routes();
    open();
    await screen.findByRole("table");

    expect(screen.queryByLabelText(/purchase order/i)).not.toBeInTheDocument();
  });

  /**
   * `CheckSalesInvoiceNo` dereferences a nullable `InvoicePef` with no check,
   * inside a catch that returns the error text AS the number. Said here, before
   * the save.
   */
  it("warns before the save when the company cannot number an invoice", async () => {
    routes([COMPANY, NO_PREFIX]);
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");

    await screen.findByRole("option", { name: NO_PREFIX.name });
    await user.selectOptions(screen.getByLabelText(/^company/i), NO_PREFIX.id);

    expect(
      await screen.findByText(/NO PREFIX LTD has no invoice prefix/i),
    ).toBeInTheDocument();
  });

  it("says nothing when the company has a prefix", async () => {
    routes();
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");

    await screen.findByRole("option", { name: COMPANY.name });
    await user.selectOptions(screen.getByLabelText(/^company/i), COMPANY.id);

    expect(screen.queryByText(/no invoice prefix/i)).not.toBeInTheDocument();
  });

  /**
   * The grid is shared, but its wiring to THIS form is not. A form that rendered
   * the grid without connecting `useWatch` would pass every test in the grid's
   * own file and show 0.00 here — which is exactly what happened once on the
   * purchase order screen.
   */
  it("computes the line and the total as they are typed", async () => {
    routes();
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");

    await user.type(screen.getByLabelText(/quantity on line 1/i), "3");
    await user.type(screen.getByLabelText(/price on line 1/i), "1000.00");
    await user.type(screen.getByLabelText(/gst percent on line 1/i), "18");

    await waitFor(() => {
      expect(within(line(0)).getByText("540.00")).toBeInTheDocument();
    });
    expect(within(line(0)).getByText("3,540.00")).toBeInTheDocument();
    await waitFor(() => expect(totalAmount()).toBe("3,540.00"));
  });

  it("subtracts the TDS and adds a signed adjustment", async () => {
    routes();
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");

    await user.type(screen.getByLabelText(/quantity on line 1/i), "3");
    await user.type(screen.getByLabelText(/price on line 1/i), "1000.00");
    await user.type(screen.getByLabelText(/gst percent on line 1/i), "18");
    await user.type(screen.getByLabelText(/^tds$/i), "500.00");
    await user.type(screen.getByLabelText(/^adjustment$/i), "-40.00");

    await waitFor(() => expect(totalAmount()).toBe("3,000.00"));
  });

  /**
   * The source computes the LINE's GST from a hidden catalogue price and the
   * ROLL-UP from the visible one, so a typed price is charged GST on a different
   * number. There is one price here and both derive from it.
   */
  it("computes GST on the price that was typed, not a hidden one", async () => {
    routes();
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");

    await user.type(screen.getByLabelText(/quantity on line 1/i), "10");
    await user.type(screen.getByLabelText(/price on line 1/i), "250.00");
    await user.type(screen.getByLabelText(/discount per unit on line 1/i), "50.00");
    await user.type(screen.getByLabelText(/gst percent on line 1/i), "18");

    // (250 − 50) x 10 = 2000, GST 18% of THAT = 360, not 18% of 2500.
    await waitFor(() => {
      expect(within(line(0)).getByText("360.00")).toBeInTheDocument();
    });
    await waitFor(() => expect(totalAmount()).toBe("2,360.00"));
  });

  it("offers one discount box, not the source's competing pair", async () => {
    routes();
    open();
    await screen.findByRole("table");

    expect(screen.getByLabelText(/discount per unit on line 1/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/discount percent on line 1/i)).not.toBeInTheDocument();
  });
});
