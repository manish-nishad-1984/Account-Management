import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";
import { json, renderWithAuth, routeFetch } from "../../test/render";

const caps = (canApprove = true) => ({ canEdit: true, canDelete: true, canApprove });

const prRow = (id: string, prNo: string, overrides: Record<string, unknown> = {}) => ({
  id,
  prNo,
  siteId: "site-1",
  siteName: "OM SAGAR",
  siteAddress: null,
  itemId: "item-1",
  itemLabel: "Cement",
  itemDescription: null,
  unitId: 1,
  unitName: "Bag",
  quantity: "10.00",
  documentDate: null,
  isApproved: false,
  createdAt: "2026-09-08T00:00:00.000Z",
  capabilities: caps(),
  ...overrides,
});

const itemRow = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  unitId: 1,
  unitName: "Bag",
  pricePerUnit: "395.00",
  isWithGst: false,
  gstPercent: null,
  gstAmount: null,
  hsnCode: null,
  isApproved: false,
  capabilities: caps(),
  ...overrides,
});

const supplierRow = (id: string, name: string) => ({
  id,
  name,
  mobile: null,
  email: null,
  gstNo: "24AACD1234A1Z5",
  area: "Ring Road",
  pincode: null,
  isApproved: false,
  openingBalance: null,
  capabilities: caps(),
});

const challanRow = (id: string) => ({
  id,
  siteId: "site-1",
  siteName: "OM SAGAR",
  itemId: "item-1",
  itemName: "Bricks",
  // No supplier is the COMMON case: the source's live create path
  // (`AddItemInWordDetails`) never records one.
  supplierId: null,
  supplierName: null,
  unitId: 1,
  unitName: "Nos",
  quantity: "50.00",
  invoiceNo: null,
  documentDate: null,
  vehicleNumber: null,
  receiverName: null,
  documentCount: 0,
  isApproved: false,
  createdAt: "2026-09-08T00:00:00.000Z",
  capabilities: caps(),
});

const list = (rows: unknown[]) => ({ rows, nextCursor: null, total: rows.length });
const challanList = (rows: unknown[]) => ({ ...list(rows), totalQuantity: "0" });

const EMPTY = list([]);

/** Every queue the dashboard fetches, so no panel falls through to a 404. */
const routes = (over: Partial<Record<string, unknown>> = {}) =>
  routeFetch([
    [/\/purchase-requests\/approvals$/, over.prApprove ?? { updated: 1 }],
    [/\/items\/approvals$/, over.itemApprove ?? { updated: 1 }],
    [/\/suppliers\/approvals$/, over.supplierApprove ?? { updated: 1 }],
    [/\/inward-challans\/approvals$/, over.challanApprove ?? { updated: 1 }],
    [/\/purchase-requests$/, over.pr ?? EMPTY],
    [/\/items$/, over.items ?? EMPTY],
    [/\/suppliers$/, over.suppliers ?? EMPTY],
    [/\/inward-challans$/, over.challans ?? challanList([])],
    [/\/sites\/assignable$/, { rows: [], nextCursor: null, total: 0 }],
  ]);

const ALL = [
  "purchase-request.view",
  "purchase-request.approve",
  "item.view",
  "item.approve",
  "supplier.view",
  "supplier.approve",
  "inward-challan.view",
  "inward-challan.approve",
];

const panel = async (title: string) => {
  const heading = await screen.findByRole("heading", { name: title });
  // The Card is the heading's nearest ancestor that also holds the table.
  return heading.closest("div.rounded-xl") as HTMLElement;
};

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the four migrated queues", async () => {
    routes();
    renderWithAuth(<DashboardPage />, { permissions: ALL });

    for (const title of ["Purchase Requests", "Items", "Suppliers", "Inward Challans"]) {
      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("gives each queue the columns of its own module", async () => {
    routes({
      pr: list([prRow("p1", "PR/25-26/001")]),
      items: list([itemRow("i1", "Cement")]),
      suppliers: list([supplierRow("s1", "Asian Granito")]),
      challans: challanList([challanRow("c1")]),
    });
    renderWithAuth(<DashboardPage />, { permissions: ALL });

    const requests = await panel("Purchase Requests");
    expect(await within(requests).findByText("PR/25-26/001")).toBeInTheDocument();
    // `itemLabel`, not the item's name — a free-text request is invisible in the
    // source, which INNER JOINs ItemMaster (§5f).
    expect(within(requests).getByText("Cement")).toBeInTheDocument();

    const suppliersPanel = await panel("Suppliers");
    expect(await within(suppliersPanel).findByText("Asian Granito")).toBeInTheDocument();
    expect(within(suppliersPanel).getByText("24AACD1234A1Z5")).toBeInTheDocument();

    const challansPanel = await panel("Inward Challans");
    expect(await within(challansPanel).findByText("Bricks")).toBeInTheDocument();
    // A challan with no supplier is the COMMON case — the source's live create
    // path never records one — so it reads as "Not recorded", not as blank.
    expect(within(challansPanel).getByText("Not recorded")).toBeInTheDocument();

    const itemsPanel = await panel("Items");
    expect(await within(itemsPanel).findByText("Cement")).toBeInTheDocument();
  });

  it("counts each queue from its own total", async () => {
    routes({ items: list([itemRow("i1", "A"), itemRow("i2", "B")]) });
    renderWithAuth(<DashboardPage />, { permissions: ALL });

    const items = await panel("Items");
    expect(await within(items).findByText("2 awaiting approval")).toBeInTheDocument();
  });

  /**
   * Convention 2. The two Phase 4 queues have no table behind them, so they must
   * not render as an empty queue — which would read as "nothing is pending".
   */
  it("says which two queues are not migrated, and why", async () => {
    routes();
    renderWithAuth(<DashboardPage />, { permissions: ALL });

    const orders = await panel("Purchase Orders");
    expect(within(orders).getByText("Not migrated")).toBeInTheDocument();
    expect(within(orders).getByText(/not migrated yet.*question 2/s)).toBeInTheDocument();

    const invoices = await panel("Purchase Invoices");
    expect(within(invoices).getByText(/Supplier invoices are not migrated/)).toBeInTheDocument();
  });

  it("asks each queue only for unapproved rows", async () => {
    routes();
    renderWithAuth(<DashboardPage />, { permissions: ALL });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const urls = vi.mocked(globalThis.fetch).mock.calls.map((call) => String(call[0]));

    for (const resource of ["purchase-requests", "items", "suppliers", "inward-challans"]) {
      const call = urls.find((url) => url.includes(`/${resource}?`));
      expect(call, `${resource} was not fetched`).toBeDefined();
      expect(call).toContain("isApproved=false");
    }
  });

  /** The legacy wording, because an empty panel usually means the site filter. */
  it("uses the legacy empty-state sentence", async () => {
    routes();
    renderWithAuth(<DashboardPage />, { permissions: ALL });

    const items = await panel("Items");
    await waitFor(() =>
      expect(
        within(items).getByText("No data found for the selected criteria"),
      ).toBeInTheDocument(),
    );
  });

  describe("the select-all in the header", () => {
    it("selects every approvable row and offers one bulk action", async () => {
      const user = userEvent.setup();
      routes({ items: list([itemRow("i1", "Cement"), itemRow("i2", "Sand")]) });
      renderWithAuth(<DashboardPage />, { permissions: ALL });

      const items = await panel("Items");
      await within(items).findByText("Cement");

      await user.click(within(items).getByLabelText("Select all items"));
      expect(await within(items).findByRole("button", { name: /Approve 2/ })).toBeInTheDocument();
    });

    it("clears the selection when clicked again", async () => {
      const user = userEvent.setup();
      routes({ items: list([itemRow("i1", "Cement")]) });
      renderWithAuth(<DashboardPage />, { permissions: ALL });

      const items = await panel("Items");
      await within(items).findByText("Cement");

      const all = within(items).getByLabelText("Select all items");
      await user.click(all);
      await within(items).findByRole("button", { name: /Approve 1/ });
      await user.click(all);

      expect(within(items).queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
    });

    /**
     * A row the caller may not approve must not be swept up: the server would
     * refuse it and the reported count would disagree with the tick marks.
     */
    it("leaves rows the caller cannot approve out of select-all", async () => {
      const user = userEvent.setup();
      routes({
        items: list([
          itemRow("i1", "Cement"),
          itemRow("i2", "Locked", { capabilities: caps(false) }),
        ]),
      });
      renderWithAuth(<DashboardPage />, { permissions: ALL });

      const items = await panel("Items");
      await within(items).findByText("Locked");

      await user.click(within(items).getByLabelText("Select all items"));
      expect(await within(items).findByRole("button", { name: /Approve 1/ })).toBeInTheDocument();
    });
  });

  describe("bulk approving", () => {
    it("posts the selected ids and reports what actually changed", async () => {
      const user = userEvent.setup();
      routes({
        items: list([itemRow("i1", "Cement"), itemRow("i2", "Sand")]),
        itemApprove: { updated: 2 },
      });
      renderWithAuth(<DashboardPage />, { permissions: ALL });

      const items = await panel("Items");
      await within(items).findByText("Cement");
      await user.click(within(items).getByLabelText("Select all items"));
      await user.click(await within(items).findByRole("button", { name: /Approve 2/ }));

      expect(await within(items).findByText("2 rows approved.")).toBeInTheDocument();

      const post = vi
        .mocked(globalThis.fetch)
        .mock.calls.find((call) => String(call[0]).includes("/items/approvals"));
      expect(post).toBeDefined();
      expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({
        ids: ["i1", "i2"],
        isApproved: true,
      });
    });

    /**
     * `updated` is what CHANGED, not how many boxes were ticked — the statement
     * skips rows already approved. Reporting the tick count would overstate it.
     */
    it("says plainly when nothing changed", async () => {
      const user = userEvent.setup();
      routes({ items: list([itemRow("i1", "Cement")]), itemApprove: { updated: 0 } });
      renderWithAuth(<DashboardPage />, { permissions: ALL });

      const items = await panel("Items");
      await within(items).findByText("Cement");
      await user.click(within(items).getByLabelText("Select all items"));
      await user.click(await within(items).findByRole("button", { name: /Approve 1/ }));

      expect(
        await within(items).findByText(/Nothing changed — those rows were already approved/),
      ).toBeInTheDocument();
    });

    it("shows the failure instead of claiming success", async () => {
      const user = userEvent.setup();
      routes({
        items: list([itemRow("i1", "Cement")]),
        itemApprove: json({ message: "You may not approve items." }, 403),
      });
      renderWithAuth(<DashboardPage />, { permissions: ALL });

      const items = await panel("Items");
      await within(items).findByText("Cement");
      await user.click(within(items).getByLabelText("Select all items"));
      await user.click(await within(items).findByRole("button", { name: /Approve 1/ }));

      expect(await within(items).findByText("You may not approve items.")).toBeInTheDocument();
      expect(within(items).queryByText(/rows approved/)).not.toBeInTheDocument();
    });
  });

  describe("permissions", () => {
    /** Hiding the control is a convenience; the server is the guard. */
    it("shows no checkboxes to someone who cannot approve", async () => {
      routes({ items: list([itemRow("i1", "Cement")]) });
      renderWithAuth(<DashboardPage />, { permissions: ["item.view"] });

      const items = await panel("Items");
      await within(items).findByText("Cement");

      expect(within(items).queryByLabelText("Select all items")).not.toBeInTheDocument();
    });

    it("still lists the rows, so a viewer can see what is pending", async () => {
      routes({ items: list([itemRow("i1", "Cement")]) });
      renderWithAuth(<DashboardPage />, { permissions: ["item.view"] });

      const items = await panel("Items");
      expect(await within(items).findByText("Cement")).toBeInTheDocument();
    });
  });
});
