import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseInvoiceFormDialog } from "./PurchaseInvoiceFormDialog";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * THE TESTS THIS FILE EXISTS FOR are the two the live screen gets wrong.
 *
 * On the real Create Invoice page, three scripts define `updateTotals` and the
 * PURCHASE ORDER one loads last and wins. It has no TDS term and no round-off
 * term, so both boxes are inert: ₹500 of TDS typed there moves the total by
 * nothing. These type into the boxes and read the rendered total.
 *
 * They are deliberately end-to-end through the form rather than a check that
 * some function was called — the purchase order grid shipped showing 0.00 in
 * every computed cell while its domain tests were green, because those call the
 * calculator directly and the page tests never opened the form.
 */

const list = (rows: unknown[]) => ({ rows, nextCursor: null, total: rows.length });

const UNIT = { id: 1, name: "Bag", createdAt: "2026-01-01T00:00:00.000Z" };

const routes = () =>
  routeFetch([
    [/\/sites\/assignable$/, { scope: "all", sites: [{ id: "s1", name: "Akwada Lake Front" }] }],
    [/\/units/, list([UNIT])],
    [/\/items/, list([])],
    [/\/suppliers/, list([])],
    [/\/companies/, list([])],
    [/\/purchase-orders/, list([])],
    [/\/purchase-invoices/, list([])],
  ]);

const open = () =>
  renderWithAuth(<PurchaseInvoiceFormDialog open invoiceId={null} onClose={() => {}} />, {
    permissions: ["purchase-invoice.view", "purchase-invoice.add"],
  });

/** The line-item grid is the only table in the dialog with a GST column. */
const grid = () => {
  const tables = screen.getAllByRole("table");
  return tables.find((t) => /gst/i.test(t.querySelector("thead")?.textContent ?? ""))!;
};

// The header, the body and the footer are ALL rowgroups, so
// `getAllByRole("rowgroup")[0]` is the THEAD. Address the sections by tag.
const line = (index: number) =>
  within(grid().querySelector("tbody")!).getAllByRole("row")[index]!;

/** The Totals panel below the grid, addressed by its own label. */
const totalAmount = () =>
  screen.getByText(/^total amount$/i).parentElement!.querySelector("div:last-child")!.textContent;

const typeLine = async (
  user: ReturnType<typeof userEvent.setup>,
  { qty = "3", price = "1000.00", gst = "18" }: { qty?: string; price?: string; gst?: string } = {},
) => {
  await user.type(screen.getByLabelText(/quantity on line 1/i), qty);
  await user.type(screen.getByLabelText(/price on line 1/i), price);
  await user.type(screen.getByLabelText(/gst percent on line 1/i), gst);
};

describe("PurchaseInvoiceFormDialog", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
    routes();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the line-item grid with one empty row", async () => {
    open();
    await screen.findByRole("table");

    expect(within(grid()).getAllByRole("row").length).toBeGreaterThan(1);
    expect(screen.getByLabelText(/quantity on line 1/i)).toHaveValue("");
    expect(screen.getByRole("button", { name: /add product/i })).toBeInTheDocument();
  });

  it("computes the line as it is typed", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");
    await typeLine(user);

    // 3 x 1000.00 = 3000.00, GST at 18% = 540.00, line total 3540.00.
    await waitFor(() => {
      expect(within(line(0)).getByText("540.00")).toBeInTheDocument();
    });
    expect(within(line(0)).getByText("3,540.00")).toBeInTheDocument();
  });

  /**
   * REGRESSION. The Amount footer showed the SUBTOTAL, so a one-line invoice
   * read Amount 885.00 with a footer of 750.00 — a column footer that does not
   * add up its own column. Found by looking at a screenshot of the finished
   * form, not by a test, which is why there is one now.
   */
  it("foots the Amount column with the sum of that column", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");
    await typeLine(user, { qty: "10", price: "100.00", gst: "18" });

    await waitFor(() => {
      expect(within(line(0)).getByText("1,180.00")).toBeInTheDocument();
    });

    const foot = within(grid().querySelector("tfoot")!);
    // Net 1,000.00 + GST 180.00 — the same 1,180.00 the only line shows, NOT
    // the 1,000.00 subtotal.
    expect(foot.getByText("1,180.00")).toBeInTheDocument();
    expect(foot.queryByText("1,000.00")).not.toBeInTheDocument();
  });

  /** B-2(a). The live screen's TDS box moves the total by nothing. */
  it("SUBTRACTS the TDS from the total, which the live screen does not", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");
    await typeLine(user);

    await waitFor(() => expect(totalAmount()).toBe("3,540.00"));

    await user.type(screen.getByLabelText(/^tds$/i), "500.00");

    await waitFor(() => expect(totalAmount()).toBe("3,040.00"));
  });

  /** Also inert on the live screen, and signed — negative is the common case. */
  it("adds the adjustment, and accepts a negative one", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");
    await typeLine(user);

    await user.type(screen.getByLabelText(/^adjustment$/i), "-40.00");

    await waitFor(() => expect(totalAmount()).toBe("3,500.00"));
  });

  /**
   * A leading minus must survive the preview normaliser. The purchase order
   * form's copy strips anything unparseable to "0", which would preview the
   * WRONG total for the ordinary downward adjustment while the user typed it.
   */
  it("does not flip a negative adjustment to zero mid-typing", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");
    await typeLine(user);

    const adjustment = screen.getByLabelText(/^adjustment$/i);
    // "-" alone is not a number; the total must hold, not jump.
    await user.type(adjustment, "-");
    await waitFor(() => expect(totalAmount()).toBe("3,540.00"));

    await user.type(adjustment, "1");
    await waitFor(() => expect(totalAmount()).toBe("3,539.00"));
  });

  it("subtracts a per-unit discount and shows the percent it works out to", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");

    await user.type(screen.getByLabelText(/quantity on line 1/i), "10");
    await user.type(screen.getByLabelText(/price on line 1/i), "100.00");
    await user.type(screen.getByLabelText(/discount per unit on line 1/i), "25.00");

    // (100 − 25) x 10 = 750, and the derived percent is shown, not typed.
    await waitFor(() => {
      expect(within(line(0)).getByText("750.00")).toBeInTheDocument();
    });
    expect(within(line(0)).getByText("25.00%")).toBeInTheDocument();
  });

  /**
   * ONE discount box, not two. The legacy grid has rupees AND percent, and doc 11
   * asks which wins when both are set. Offering only one means the question
   * cannot arise — the percent beside it is read-only.
   */
  it("offers no discount PERCENT input to disagree with the rupee one", async () => {
    open();
    await screen.findByRole("table");

    expect(screen.getByLabelText(/discount per unit on line 1/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/discount percent on line 1/i)).not.toBeInTheDocument();
  });

  /**
   * `money.decimal` throws on "1000.", which a person types on the way to
   * "1000.00". Found on the purchase order form by a test that types character
   * by character; a browser check missed it because `fill()` sets the whole
   * value at once.
   */
  it("survives a half-typed decimal without throwing", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");

    const price = screen.getByLabelText(/price on line 1/i);
    await user.type(screen.getByLabelText(/quantity on line 1/i), "1");
    // Stops on the point deliberately.
    await user.type(price, "1000.");

    expect(price).toHaveValue("1000.");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("rounds the grand total to a whole rupee, and says so", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");

    await user.type(screen.getByLabelText(/quantity on line 1/i), "1");
    await user.type(screen.getByLabelText(/price on line 1/i), "100.00");
    await user.type(screen.getByLabelText(/gst percent on line 1/i), "5");
    await user.type(screen.getByLabelText(/^adjustment$/i), "0.50");

    // 105.00 + 0.50 = 105.50, and exactly .50 rounds DOWN.
    await waitFor(() => expect(totalAmount()).toBe("105.00"));
    expect(screen.getByText(/50 paise rounding down/i)).toBeInTheDocument();
  });

  it("says the number is the supplier's, not ours", async () => {
    open();
    await screen.findByRole("table");

    expect(screen.getByText(/number is the supplier's, not ours/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/supplier's invoice number/i)).toBeInTheDocument();
  });

  /** The order dropdown is scoped to the supplier, so it waits for one. */
  it("asks for a supplier before offering purchase orders", async () => {
    open();
    await screen.findByRole("table");

    expect(screen.getByText(/choose a supplier first/i)).toBeInTheDocument();
  });
});
