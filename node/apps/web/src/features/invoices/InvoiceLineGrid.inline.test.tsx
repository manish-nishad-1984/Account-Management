import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseInvoiceFormDialog } from "../purchase-invoices/PurchaseInvoiceFormDialog";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * One row per line, with a + on each row to add the next (client request,
 * 14 Sep 2026). Driven through the purchase invoice form; the sales form uses
 * the same grid.
 */

const list = (rows: unknown[]) => ({ rows, nextCursor: null, total: rows.length });
const CAPS = { canEdit: true, canDelete: true, canApprove: false };

const CEMENT = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  name: "OPC Cement",
  unitId: 1,
  unitName: "Bag",
  pricePerUnit: "395.00",
  isWithGst: false,
  gstPercent: null,
  gstAmount: null,
  hsnCode: null,
  isApproved: true,
  capabilities: CAPS,
};

const open = () =>
  renderWithAuth(<PurchaseInvoiceFormDialog open invoiceId={null} onClose={() => {}} />, {
    permissions: ["purchase-invoice.view", "purchase-invoice.add", "item.view"],
  });

describe("the invoice line grid, one row per line", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    routeFetch([
      [/\/sites\/assignable$/, { scope: "all", sites: [] }],
      [/\/units/, list([{ id: 1, name: "Bag", itemCount: 0, capabilities: CAPS }])],
      [/\/items$/, list([CEMENT])],
      [/\/suppliers/, list([])],
      [/\/companies/, list([])],
      [/\/purchase-orders/, list([])],
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("has no separate Add product button, and no second box under the item", async () => {
    open();
    await screen.findByLabelText(/item on line 1/i);

    expect(screen.queryByRole("button", { name: /add product/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/product name on line 1/i)).not.toBeInTheDocument();
  });

  it("adds a line directly after the row whose + was pressed, and puts the cursor in it", async () => {
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole("button", { name: "Add a line after line 1" }));
    await user.type(screen.getByLabelText(/quantity on line 2/i), "7");

    // + on line 1 again: the new line goes between 1 and the old line 2.
    await user.click(screen.getByRole("button", { name: "Add a line after line 1" }));

    expect(screen.getByLabelText(/quantity on line 2/i)).toHaveValue("");
    expect(screen.getByLabelText(/quantity on line 3/i)).toHaveValue("7");
    await waitFor(() => expect(screen.getByLabelText(/item on line 2/i)).toHaveFocus());
    expect(screen.getByText("3 lines")).toBeInTheDocument();
  });

  it("offers a typed name from inside the dropdown, and can go back to the list", async () => {
    const user = userEvent.setup();
    open();

    const select = await screen.findByLabelText(/item on line 1/i);
    await user.selectOptions(select, "Not in the list — type a name");

    const name = screen.getByLabelText(/product name on line 1/i);
    await user.type(name, "Loose sand");
    expect(name).toHaveValue("Loose sand");
    expect(screen.queryByLabelText(/item on line 1/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Choose an item from the list on line 1" }));

    expect(screen.getByLabelText(/item on line 1/i)).toHaveValue("");
    expect(screen.queryByLabelText(/product name on line 1/i)).not.toBeInTheDocument();
  });
});
