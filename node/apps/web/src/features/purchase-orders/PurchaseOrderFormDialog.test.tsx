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

/**
 * `itemCount` and `capabilities` were MISSING here until 9 Sep 2026, so
 * `unitRowSchema` threw inside the query and the Unit dropdown was empty in
 * every test in this file. Nothing failed, because no test had ever needed to
 * choose a unit — the same incomplete-fixture trap as the sales form's company,
 * and it stays invisible until somebody tries to use the control.
 */
const UNIT = {
  id: 1,
  name: "Bag",
  itemCount: 3,
  capabilities: { canEdit: true, canDelete: true, canApprove: false },
};

/**
 * A catalogue item, for the tests that need the dropdown to have one.
 *
 * EVERY field `itemRowSchema` requires, `isWithGst` included. A fixture missing
 * one fails the parse INSIDE the query, so the dropdown never resolves and the
 * failure reads as "the select is broken" rather than "the fixture is short" —
 * the trap the sales form's company fixture sprang in §5r.
 */
const ITEM = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "OPC 53 Grade Cement",
  unitId: 1,
  unitName: "Bag",
  pricePerUnit: "395.00",
  isWithGst: true,
  gstPercent: "18.00",
  gstAmount: "0.00",
  hsnCode: "25232910",
  isApproved: true,
  capabilities: { canEdit: true, canDelete: true, canApprove: true },
};

/**
 * A SITE IN SCOPE, which the default test stub does not provide.
 *
 * `renderWithAuth` defaults to every site and a null `siteId`, and with no site
 * the delivery options request — which requires one — is correctly never made,
 * so both address panels sit empty however the fixture is written. A site clerk
 * is scoped to their own site, and that is the state these assertions are about.
 */
const SITE_SCOPE = { siteId: "11111111-1111-4111-8111-111111111111", sites: [{ id: "11111111-1111-4111-8111-111111111111", name: "Akwada Lake Front" }] };

/**
 * `delivery-options` is listed BEFORE `/purchase-orders`, because `routeFetch`
 * takes the first pattern that matches and `/purchase-orders/` matches both. A
 * list response arriving where the panels expect addresses fails the schema
 * parse inside the query, and the panels then render their empty state with no
 * error anywhere — the same shape of trap the sales form's incomplete company
 * fixture produced.
 */
const DELIVERY_OPTIONS = {
  siteAddresses: ["Gate 3, Plot 9, Mora", "Survey 118, Hazira"],
  groups: [
    { id: "55555555-5555-4555-8555-555555555555", name: "ROAD-GATE", addresses: ["Ward 3, Colony Office", "Ward 1"] },
    { id: "66666666-6666-4666-8666-666666666666", name: "PUMP HOUSE", addresses: [] },
  ],
};

const routes = () =>
  routeFetch([
    [/\/purchase-orders\/delivery-options/, DELIVERY_OPTIONS],
    [/\/units/, list([UNIT])],
    [/\/items/, list([])],
    [/\/suppliers/, list([])],
    [/\/companies/, list([])],
    [/\/purchase-orders/, list([])],
  ]);

const SUPPLIER = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Asian Granito",
  mobile: null,
  email: null,
  gstNo: null,
  area: "Navrangpura",
  pincode: null,
  isApproved: true,
  openingBalance: null,
  capabilities: { canEdit: true, canDelete: true, canApprove: true },
};

const COMPANY = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "DH Patel",
  invoicePrefix: "DHP",
  gstNo: null,
  panNo: null,
  area: "Bopal",
  pincode: null,
  bankName: null,
  userCount: 0,
  capabilities: { canEdit: true, canDelete: true, canApprove: true },
};

/** Every dropdown populated — for the tests that fill the form in and save it. */
const fullRoutes = () =>
  routeFetch([
    [/\/purchase-orders\/delivery-options/, DELIVERY_OPTIONS],
    [/\/items/, list([ITEM])],
    [/\/units/, list([UNIT])],
    [/\/suppliers/, list([SUPPLIER])],
    [/\/companies/, list([COMPANY])],
    [/\/purchase-orders/, list([])],
  ]);

/** The body of the POST the form made, or null if it has not made one. */
const postedBody = (): { items: { itemId?: string; itemName?: string }[] } | null => {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find(
      ([url, init]) =>
        /\/purchase-orders$/.test(String(url)) &&
        (init as RequestInit | undefined)?.method === "POST",
    );
  const body = (call?.[1] as RequestInit | undefined)?.body;
  return typeof body === "string" ? JSON.parse(body) : null;
};

const open = () =>
  renderWithAuth(<PurchaseOrderFormDialog open orderId={null} onClose={() => {}} />, {
    permissions: ["purchase-orders.view", "purchase-orders.add"],
    scope: SITE_SCOPE,
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

  /**
   * The free-text product name used to sit under EVERY row, so a line was two
   * controls tall whether it needed one or not. It is the alternative to the
   * dropdown, and it only means anything while the dropdown is empty.
   */
  describe("the free-text product name", () => {
    it("is offered while no catalogue item is chosen", async () => {
      open();
      await screen.findByRole("table");

      expect(screen.getByLabelText(/or name the product on line 1/i)).toBeInTheDocument();
    });

    it("disappears once an item is chosen", async () => {
      const user = userEvent.setup();
      fullRoutes();
      open();
      await screen.findByRole("table");

      await user.type(screen.getByLabelText(/or name the product on line 1/i), "Loose sand");
      await user.selectOptions(screen.getByLabelText(/item on line 1/i), "44444444-4444-4444-8444-444444444444");

      expect(screen.queryByLabelText(/or name the product on line 1/i)).not.toBeInTheDocument();
    });

    /**
     * The name is CLEARED, not merely hidden.
     *
     * React Hook Form keeps the value of an unmounted field, so a name typed
     * before an item was picked would otherwise be posted beside it and sit in
     * `item_name` contradicting the item the line references. That cannot be
     * asserted from the DOM — the placeholder option is disabled, so there is no
     * way back to an empty select — so it is asserted where it matters, in the
     * request body.
     */
    it("posts the chosen item with no leftover free text", async () => {
      const user = userEvent.setup();
      fullRoutes();
      open();
      await screen.findByRole("table");

      await user.type(screen.getByLabelText(/or name the product on line 1/i), "Loose sand");
      await user.selectOptions(screen.getByLabelText(/item on line 1/i), "44444444-4444-4444-8444-444444444444");

      await user.selectOptions(screen.getByLabelText(/^supplier/i), "22222222-2222-4222-8222-222222222222");
      await user.selectOptions(screen.getByLabelText(/^company/i), "33333333-3333-4333-8333-333333333333");
      await user.selectOptions(screen.getByLabelText(/unit on line 1/i), "1");
      await user.type(screen.getByLabelText(/quantity on line 1/i), "2");
      await user.type(screen.getByLabelText(/price on line 1/i), "100.00");

      await user.click(screen.getByRole("button", { name: /add purchase order/i }));

      await waitFor(() => {
        expect(postedBody()).not.toBeNull();
      });
      const line = postedBody()!.items[0];
      expect(line.itemId).toBe("44444444-4444-4444-8444-444444444444");
      expect(line.itemName ?? "").toBe("");
    });
  });

  it("says the order number is issued on save, rather than showing a box for it", async () => {
    open();
    await screen.findByRole("table");

    expect(screen.getByText(/order number is issued when this is saved/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/order no/i)).not.toBeInTheDocument();
  });

  /**
   * The two carve-outs of `08-create-purchase-order.md`, which shipped as
   * placeholders when the rest of this screen went in.
   *
   * WHAT THESE DO NOT COVER, stated so the green suite is not read as more than
   * it is: jsdom does not implement `document.execCommand`, so the editor's
   * formatting buttons cannot be exercised here. What is asserted is the wiring —
   * that a template loads, that editing stops the order claiming one, and that
   * the allocation rule is enforced before anything is sent. The formatting
   * itself is checked in a real browser.
   */
  describe("terms and conditions", () => {
    it("offers the three templates, and loads one into the editor", async () => {
      const user = userEvent.setup();
      open();
      await screen.findByRole("table");

      const editor = screen.getByRole("textbox", { name: /terms and conditions/i });
      expect(editor).toBeEmptyDOMElement();

      await user.click(screen.getByRole("button", { name: "Template 1" }));

      expect(editor).toHaveTextContent(/Prices: The Above Price are on site Vadodara/);
      expect(screen.getByRole("button", { name: "Template 1" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("swaps an untouched template for another without asking", async () => {
      const user = userEvent.setup();
      open();
      await screen.findByRole("table");

      await user.click(screen.getByRole("button", { name: "Template 1" }));
      await user.click(screen.getByRole("button", { name: "Template 2" }));

      expect(screen.getByRole("textbox", { name: /terms and conditions/i })).toHaveTextContent(
        /Supplier will Accept Site Wieght/,
      );
      expect(screen.getByRole("button", { name: "Template 2" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("asks before replacing terms somebody has written", async () => {
      const user = userEvent.setup();
      open();
      await screen.findByRole("table");

      const editor = screen.getByRole("textbox", { name: /terms and conditions/i });
      await user.click(editor);
      await user.keyboard("Ours, not a template");

      await user.click(screen.getByRole("button", { name: "Template 3" }));

      expect(await screen.findByText(/replace the terms you have written/i)).toBeInTheDocument();
      // Still the typed text: the question has not been answered yet.
      expect(editor).toHaveTextContent("Ours, not a template");
    });

    /**
     * The template record is a claim about which boilerplate a supplier was
     * sent. An order saying "Template 1" while carrying terms that no longer
     * resemble it is worse than one recording nothing.
     */
    it("stops claiming a template once the text is edited", async () => {
      const user = userEvent.setup();
      open();
      await screen.findByRole("table");

      await user.click(screen.getByRole("button", { name: "Template 1" }));
      expect(screen.getByRole("button", { name: "Template 1" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await user.click(screen.getByRole("textbox", { name: /terms and conditions/i }));
      await user.keyboard(" and one more clause");

      expect(screen.getByRole("button", { name: "Template 1" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });

  describe("delivery addresses", () => {
    const summary = () => screen.getByText("Allocated").closest("div")!;

    it("offers the site's addresses, and says when no group is chosen", async () => {
      open();

      expect(await screen.findByText("Gate 3, Plot 9, Mora")).toBeInTheDocument();
      expect(screen.getByText(/choose a group above to see its addresses/i)).toBeInTheDocument();
    });

    it("shows a group's addresses once the group is chosen", async () => {
      const user = userEvent.setup();
      open();
      await screen.findByText("Gate 3, Plot 9, Mora");

      await user.selectOptions(screen.getByLabelText(/^group/i), "55555555-5555-4555-8555-555555555555");

      expect(await screen.findByText("Ward 3, Colony Office")).toBeInTheDocument();
    });

    it("counts what is allocated against what is ordered, across both panels", async () => {
      const user = userEvent.setup();
      open();
      await screen.findByText("Gate 3, Plot 9, Mora");

      await user.type(screen.getByLabelText(/quantity on line 1/i), "10");
      await user.selectOptions(screen.getByLabelText(/^group/i), "55555555-5555-4555-8555-555555555555");

      await user.click(screen.getByRole("checkbox", { name: /deliver to Gate 3, Plot 9, Mora/i }));
      await user.type(screen.getByLabelText(/quantity for Gate 3, Plot 9, Mora/i), "4");
      await user.click(screen.getByRole("checkbox", { name: /deliver to Ward 3, Colony Office/i }));
      await user.type(screen.getByLabelText(/quantity for Ward 3, Colony Office/i), "6");

      // `formatQuantity` trims a whole number's fraction, so 10.00 reads "10".
      await waitFor(() => {
        expect(within(summary()).getAllByText("10")).toHaveLength(2);
      });
      // Ordered 10, allocated 10, nothing left unallocated.
      expect(within(summary()).getByText("0")).toBeInTheDocument();
    });

    /**
     * THE DEPARTURE FROM THE SOURCE, on screen.
     *
     * The source keeps one accumulator per panel and compares each to the order
     * on its own, so 10 units to a site address and 10 more to a group address
     * passes against an order for 10 — twice the goods, no warning anywhere.
     * Here the two are one total, and the form says so before Save is pressed.
     */
    it("refuses an allocation the source would have accepted twice over", async () => {
      const user = userEvent.setup();
      open();
      await screen.findByText("Gate 3, Plot 9, Mora");

      await user.type(screen.getByLabelText(/quantity on line 1/i), "10");
      await user.selectOptions(screen.getByLabelText(/^group/i), "55555555-5555-4555-8555-555555555555");

      await user.click(screen.getByRole("checkbox", { name: /deliver to Gate 3, Plot 9, Mora/i }));
      await user.type(screen.getByLabelText(/quantity for Gate 3, Plot 9, Mora/i), "10");
      await user.click(screen.getByRole("checkbox", { name: /deliver to Ward 3, Colony Office/i }));
      await user.type(screen.getByLabelText(/quantity for Ward 3, Colony Office/i), "10");

      expect(
        await screen.findByText(/account for 20\.00 units, and the order is for 10\.00/i),
      ).toBeInTheDocument();
    });

    it("removes the row when an address is unticked, rather than keeping a zero", async () => {
      const user = userEvent.setup();
      open();
      await screen.findByText("Gate 3, Plot 9, Mora");

      // An ordered quantity first, so 5 allocated is a part allocation rather
      // than an over-allocation — otherwise Allocated and "Over by" are both 5
      // and the assertion cannot tell which it matched.
      await user.type(screen.getByLabelText(/quantity on line 1/i), "10");

      const box = screen.getByRole("checkbox", { name: /deliver to Gate 3, Plot 9, Mora/i });
      await user.click(box);
      await user.type(screen.getByLabelText(/quantity for Gate 3, Plot 9, Mora/i), "5");

      await waitFor(() => {
        expect(within(summary()).getAllByText("5")).toHaveLength(2);
      });

      await user.click(box);
      await waitFor(() => {
        expect(within(summary()).queryByText("5")).not.toBeInTheDocument();
      });
      // Nothing allocated, and the whole order still unallocated.
      expect(within(summary()).getByText("0")).toBeInTheDocument();
    });

    it("says why a site with no address on file offers nothing", async () => {
      routeFetch([
        [/\/purchase-orders\/delivery-options/, { siteAddresses: [], groups: [] }],
        [/\/sites\/assignable$/, SITE_SCOPE],
        [/\/units/, list([UNIT])],
        [/\/items/, list([])],
        [/\/suppliers/, list([])],
        [/\/companies/, list([])],
        [/\/purchase-orders/, list([])],
      ]);
      open();

      expect(await screen.findByText(/this site has no address recorded/i)).toBeInTheDocument();
    });
  });
});
