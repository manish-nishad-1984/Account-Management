import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseOrderFormDialog } from "./PurchaseOrderFormDialog";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * THE TEST THIS FILE EXISTS FOR is "computes the line and the totals as they are
 * typed".
 *
 * The grid's computed cells shipped showing 0.00 for every input, because the
 * first version subscribed with `watch("items")` instead of `useWatch`, and with
 * a `useFieldArray` that does not re-render per keystroke — so `totals.lines` was
 * empty and every cell fell through to its `?? "0"` fallback.
 *
 * Everything was green while that was true: the domain tests call the calculator
 * directly, and `PurchaseOrdersPage.test.tsx` never opens the form. It took a
 * real browser to see it. So the assertion here is deliberately end-to-end
 * through the form — type into the inputs, read the rendered cells — rather than
 * a check that some function was called.
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
  ]);

const open = () =>
  renderWithAuth(<PurchaseOrderFormDialog open orderId={null} onClose={() => {}} />, {
    permissions: ["purchase-orders.view", "purchase-orders.add"],
  });

/** The line-item grid is the only table in the dialog with a GST column. */
const grid = () => {
  const tables = screen.getAllByRole("table");
  return tables.find((t) => /gst/i.test(t.querySelector("thead")?.textContent ?? ""))!;
};

/**
 * One data row of the grid, addressed on its own.
 *
 * Needed because with a single line the row's GST and the FOOTER's total GST are
 * the same number — which is correct, and makes a whole-grid `getByText` throw
 * "found multiple elements". Asserting on the row proves the line was computed;
 * asserting on the footer proves the roll-up was.
 */
const line = (index: number) =>
  // `getAllByRole("rowgroup")[0]` is the THEAD, not the body — the header, the
  // body and the footer are all rowgroups. Address the sections by tag.
  within(grid().querySelector("tbody")!).getAllByRole("row")[index]!;

const footer = () => within(grid().querySelector("tfoot")!);

describe("PurchaseOrderFormDialog", () => {
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

  it("computes the line and the totals as they are typed", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");

    await user.type(screen.getByLabelText(/quantity on line 1/i), "3");
    await user.type(screen.getByLabelText(/price on line 1/i), "1000.00");
    await user.type(screen.getByLabelText(/gst percent on line 1/i), "18");

    // 3 x 1000.00 = 3000.00, GST at 18% = 540.00, line total 3540.00.
    await waitFor(() => {
      expect(within(line(0)).getByText("540.00")).toBeInTheDocument();
    });
    expect(within(line(0)).getByText("3,540.00")).toBeInTheDocument();

    // ...and the footer rolls the same line up.
    expect(footer().getByText("540.00")).toBeInTheDocument();
    expect(footer().getByText("3,540.00")).toBeInTheDocument();
  });

  it("rolls the lines up into the totals panel", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");

    await user.type(screen.getByLabelText(/quantity on line 1/i), "3");
    await user.type(screen.getByLabelText(/price on line 1/i), "1000.00");
    await user.type(screen.getByLabelText(/gst percent on line 1/i), "18");

    await waitFor(() => {
      // Sub total 3,000.00 appears only in the totals panel; the grid shows the
      // line's own net through its Amount column.
      expect(screen.getByText("3,000.00")).toBeInTheDocument();
    });
  });

  it("adds a second line and includes it in the totals", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");

    await user.type(screen.getByLabelText(/quantity on line 1/i), "1");
    await user.type(screen.getByLabelText(/price on line 1/i), "1000.00");

    await user.click(screen.getByRole("button", { name: /add product/i }));

    await user.type(await screen.findByLabelText(/quantity on line 2/i), "1");
    await user.type(screen.getByLabelText(/price on line 2/i), "500.00");

    await waitFor(() => {
      // No GST on either line, so the total is the plain sum.
      expect(screen.getAllByText("1,500.00").length).toBeGreaterThan(0);
    });
  });

  /**
   * 27 at 18% is 4.86 exactly. A float implementation reached for a rate and got
   * 4.859999999999999; this asserts the browser shows what the SERVER will store,
   * because both call the same domain function.
   */
  it("shows the exact decimal the server will store", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");

    await user.type(screen.getByLabelText(/quantity on line 1/i), "1");
    await user.type(screen.getByLabelText(/price on line 1/i), "27.00");
    await user.type(screen.getByLabelText(/gst percent on line 1/i), "18");

    await waitFor(() => {
      expect(within(line(0)).getByText("4.86")).toBeInTheDocument();
    });
    expect(within(line(0)).getByText("31.86")).toBeInTheDocument();
  });

  it("says the order number is issued on save, rather than showing a box for it", async () => {
    open();
    await screen.findByRole("table");

    expect(screen.getByText(/order number is issued when this is saved/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/order no/i)).not.toBeInTheDocument();
  });

  /** The terms field is plain text until a sanitiser lands with the editor. */
  it("says why terms and conditions is a plain text box", async () => {
    open();
    await screen.findByRole("table");

    expect(screen.getByText(/plain text until that editor and an HTML sanitiser/i)).toBeInTheDocument();
  });
});
