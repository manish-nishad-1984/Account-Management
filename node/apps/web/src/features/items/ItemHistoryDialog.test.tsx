import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemsPage } from "./ItemsPage";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * The clock icon's panel, driven from the Item Master row it opens from.
 *
 * Tested through `ItemsPage` rather than by rendering the dialog directly,
 * because half of what is being checked is the wiring: that the button carries
 * the item's name into its accessible label, that the panel is not fetched
 * until it is opened, and that the row's own master price reaches the header.
 */

const CEMENT = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  name: "OPC 53 Grade Cement",
  unitId: 1,
  unitName: "Bag",
  pricePerUnit: "395.00",
  isWithGst: true,
  gstPercent: "18.00",
  gstAmount: "71.10",
  hsnCode: "2523",
  isApproved: true,
  capabilities: { canEdit: true, canDelete: true, canApprove: false },
};

const ITEMS = { rows: [CEMENT], nextCursor: null, total: 1 };
const UNITS = { rows: [], nextCursor: null, total: 0 };

const line = (overrides: Record<string, unknown> = {}) => ({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  invoiceId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  displayNo: "BB/154",
  invoiceType: "Purchase",
  supplierId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
  supplierName: "AL BURHAN PIPES & SANITATION",
  siteId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
  siteName: "Akwada Lake Front",
  companyId: "ffffffff-ffff-4fff-8fff-fffffffffff1",
  companyName: "DH PATEL",
  documentDate: "2026-02-11T00:00:00.000Z",
  createdAt: "2026-02-11T09:00:00.000Z",
  quantity: "10.00",
  unitPrice: "400.00",
  discountPerUnit: "20.00",
  gstPercent: "18.00",
  gstAmount: "684.00",
  netAmount: "3800.00",
  lineTotal: "4484.00",
  effectiveUnitPrice: "380.00",
  effectiveUnitPriceWithGst: "448.40",
  isApproved: true,
  ...overrides,
});

const withHistory = (history: unknown) =>
  routeFetch([
    [/\/items\/[^/]+\/price-history$/, history],
    [/\/units/, UNITS],
    [/\/items$/, ITEMS],
  ]);

const openHistory = async () => {
  const user = userEvent.setup();
  const button = await screen.findByRole("button", {
    name: /Price history for OPC 53 Grade Cement/,
  });
  await user.click(button);
  return user;
};

describe("the item price history panel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not fetch the history until the panel is opened", async () => {
    withHistory({ rows: [], total: 0 });
    renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });

    await screen.findByText("OPC 53 Grade Cement");
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    const asked = vi
      .mocked(globalThis.fetch)
      .mock.calls.map((call) => String(call[0]))
      .some((url) => url.includes("price-history"));
    expect(asked).toBe(false);
  });

  it("shows the invoice, the supplier, the site and what was paid per unit", async () => {
    withHistory({ rows: [line()], total: 1 });
    renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });
    await openHistory();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("BB/154")).toBeInTheDocument();
    expect(within(dialog).getByText("AL BURHAN PIPES & SANITATION")).toBeInTheDocument();
    expect(within(dialog).getByText("Akwada Lake Front")).toBeInTheDocument();
    // 400 list, 20 off, so 380 paid and 448.40 with GST.
    expect(within(dialog).getByText("380.00")).toBeInTheDocument();
    expect(within(dialog).getByText("448.40")).toBeInTheDocument();
  });

  /**
   * The master price and the invoiced price are different numbers, and the
   * whole point of the panel is that they can disagree. The header says which
   * is which so nobody reads the table as the master price changing over time.
   */
  it("shows the item master price beside the invoiced ones", async () => {
    withHistory({ rows: [line()], total: 1 });
    renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });
    await openHistory();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/item master price is/)).toHaveTextContent("395.00");
  });

  it("renders the legacy empty state for an item never invoiced", async () => {
    withHistory({ rows: [], total: 0 });
    renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });
    await openHistory();

    expect(await screen.findByText("No invoices found")).toBeInTheDocument();
  });

  /**
   * A purchase return is in the legacy list, unlabelled and indistinguishable
   * from a purchase. It stays in the list and gains a label.
   */
  it("marks a purchase return so it is not read as a price paid", async () => {
    withHistory({ rows: [line({ invoiceType: "Purchase Return" })], total: 1 });
    renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });
    await openHistory();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Purchase Return")).toBeInTheDocument();
  });

  it("marks an unapproved invoice as an unconfirmed price", async () => {
    withHistory({ rows: [line({ isApproved: false })], total: 1 });
    renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });
    await openHistory();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Not approved")).toBeInTheDocument();
  });

  /**
   * `site_id` is nullable and the legacy query INNER JOINs it, so these rows
   * are absent from the legacy panel entirely rather than shown without a site.
   */
  it("says No site rather than dropping an invoice raised without one", async () => {
    withHistory({ rows: [line({ siteId: null, siteName: null })], total: 1 });
    renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });
    await openHistory();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("No site")).toBeInTheDocument();
  });

  it("says how many lines it is not showing when the cap bites", async () => {
    const rows = Array.from({ length: 50 }, (_unused, index) =>
      line({ id: `line-${index}`, displayNo: `INV-${index}` }),
    );
    withHistory({ rows, total: 213 });
    renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });
    await openHistory();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/50 most recent of 213/)).toBeInTheDocument();
  });

  it("reports a failed load rather than an empty history", async () => {
    routeFetch([
      [/\/items\/[^/]+\/price-history$/, new Response("nope", { status: 500 })],
      [/\/units/, UNITS],
      [/\/items$/, ITEMS],
    ]);
    renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });
    await openHistory();

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText("No invoices found")).not.toBeInTheDocument();
  });

  /**
   * The button is not a row capability. `RowActions` renders from the flags the
   * server computes for edit, delete and approve; history is guarded by
   * `item.view`, the right that drew the screen at all — so it is present for a
   * reader who can do nothing else.
   */
  it("offers history to a read-only viewer", async () => {
    withHistory({ rows: [line()], total: 1 });
    renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });

    expect(
      await screen.findByRole("button", { name: /Price history for OPC 53 Grade Cement/ }),
    ).toBeInTheDocument();
  });
});
