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
 * the document-options request — which needs one — is correctly never made, so
 * the address fields sit on "Choose a site first" however the fixture is written.
 */
const SITE_SCOPE = { siteId: "11111111-1111-4111-8111-111111111111", sites: [{ id: "11111111-1111-4111-8111-111111111111", name: "Akwada Lake Front" }] };

/**
 * What the site offers an order. Listed BEFORE `/purchase-orders` in the routes
 * for the old reason: `routeFetch` takes the first pattern that matches.
 */
const SITE_OPTIONS = {
  billingAddress: "Plot 12, Akwada Lake Front",
  shippingAddresses: [
    { key: "site", source: "site", address: "Plot 12, Akwada Lake Front" },
    { key: "extra-4", source: "extra", address: "Gate 3, Plot 9, Mora" },
    { key: "location-9", source: "location", address: "Block A gate, Hazira" },
  ],
  locations: [
    { id: "55555555-5555-4555-8555-555555555555", name: "Block A" },
    { id: "66666666-6666-4666-8666-666666666666", name: "Store Yard" },
  ],
  contacts: [
    { id: "c1", name: "Ramesh", phone: "9824000001" },
    { id: "c2", name: "Suresh", phone: "9824000002, 9824000003" },
  ],
};

const routes = () =>
  routeFetch([
    [/\/document-options/, SITE_OPTIONS],
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
    [/\/document-options/, SITE_OPTIONS],
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
      // Indexing an array yields `T | undefined` under
      // `noUncheckedIndexedAccess`. The `waitFor` above proves a body was
      // posted; it does not prove it had a line, so the assertion says so.
      const line = postedBody()!.items[0]!;
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

  /**
   * The rules of 15 Sep 2026: billing is the site's own address and is shown,
   * not typed; shipping is ONE of the site's addresses; the location is one of
   * the site's locations. They replaced the quantity-split panels.
   */
  describe("location and addresses", () => {
    it("shows the site's address as the billing address, with no box to type in", async () => {
      open();

      await waitFor(() =>
        expect(screen.getByLabelText("Billing address")).toHaveTextContent(
          "Plot 12, Akwada Lake Front",
        ),
      );
      expect(screen.queryByRole("textbox", { name: /billing address/i })).not.toBeInTheDocument();
    });

    it("offers every address of the site as ONE shipping choice, and posts the one chosen", async () => {
      const user = userEvent.setup();
      fullRoutes();
      open();

      const group = await screen.findByRole("radiogroup", { name: /shipping address/i });
      expect(within(group).getAllByRole("radio")).toHaveLength(3);
      expect(within(group).getByText("Location address")).toBeInTheDocument();

      await user.click(within(group).getByRole("radio", { name: /Gate 3, Plot 9, Mora/ }));
      // Choosing another moves the one choice; it never adds a second.
      await user.click(within(group).getByRole("radio", { name: /Block A gate, Hazira/ }));
      expect(within(group).getAllByRole("radio", { checked: true })).toHaveLength(1);

      await user.selectOptions(screen.getByLabelText(/^supplier/i), SUPPLIER.id);
      await user.selectOptions(screen.getByLabelText(/^company/i), COMPANY.id);
      await user.selectOptions(screen.getByLabelText(/item on line 1/i), ITEM.id);
      await user.selectOptions(screen.getByLabelText(/unit on line 1/i), String(UNIT.id));
      await user.type(screen.getByLabelText(/quantity on line 1/i), "2");
      await user.type(screen.getByLabelText(/price on line 1/i), "100");
      await user.selectOptions(screen.getByLabelText(/^location/i), "55555555-5555-4555-8555-555555555555");
      await user.click(screen.getByRole("button", { name: /add purchase order/i }));

      await waitFor(() => expect(postedBody()).not.toBeNull());
      const body = postedBody() as unknown as Record<string, unknown>;
      expect(body.shippingAddress).toBe("Block A gate, Hazira");
      expect(body.siteLocationId).toBe("55555555-5555-4555-8555-555555555555");
      expect(body).not.toHaveProperty("billingAddress");
    });

    it("picks the contact person from the site's contacts, with no boxes to type a name or number", async () => {
      const user = userEvent.setup();
      fullRoutes();
      open();

      const contact = await screen.findByLabelText(/^contact person/i);
      await waitFor(() => expect(within(contact).getAllByRole("option")).toHaveLength(3));
      expect(screen.queryByRole("textbox", { name: /^contact number/i })).not.toBeInTheDocument();

      await user.selectOptions(contact, "Suresh — 9824000002, 9824000003");

      await user.selectOptions(screen.getByLabelText(/^supplier/i), SUPPLIER.id);
      await user.selectOptions(screen.getByLabelText(/^company/i), COMPANY.id);
      await user.selectOptions(screen.getByLabelText(/item on line 1/i), ITEM.id);
      await user.selectOptions(screen.getByLabelText(/unit on line 1/i), String(UNIT.id));
      await user.type(screen.getByLabelText(/quantity on line 1/i), "2");
      await user.type(screen.getByLabelText(/price on line 1/i), "100");
      await user.click(screen.getByRole("button", { name: /add purchase order/i }));

      await waitFor(() => expect(postedBody()).not.toBeNull());
      const body = postedBody() as unknown as Record<string, unknown>;
      expect(body.contactName).toBe("Suresh");
      expect(body.contactNumber).toBe("9824000002, 9824000003");
    });

    describe("an order raised before the change, with a quantity split", () => {
      const ORDER_ID = "77777777-7777-4777-8777-777777777777";
      const DETAIL = {
        id: ORDER_ID,
        poNo: "DHP/PO/26-27/001",
        siteId: SITE_SCOPE.siteId,
        supplierId: SUPPLIER.id,
        companyId: COMPANY.id,
        siteLocationId: null,
        documentDate: "2026-09-01T00:00:00.000Z",
        buyersPurchaseNo: null,
        subtotal: "200.00",
        totalGstAmount: "36.00",
        totalAmount: "236.00",
        isActive: true,
        isApproved: false,
        createdAt: "2026-09-01T00:00:00.000Z",
        deliveryDate: null,
        deliveryImmediate: false,
        terms: null,
        description: null,
        billingAddress: "Plot 12, Akwada Lake Front",
        shippingAddress: "Typed by hand, long ago",
        groupAddress: null,
        contactName: "Mahesh",
        contactNumber: "98250 11111",
        otherContactName: null,
        otherContactNumber: null,
        dispatchBy: null,
        paymentTerms: null,
        termsTemplate: null,
        totalDiscount: null,
        items: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            itemId: ITEM.id,
            itemLabel: ITEM.name,
            itemDescription: null,
            hsnCode: null,
            unitId: UNIT.id,
            unitName: UNIT.name,
            quantity: "2.00",
            unitPrice: "100.00",
            gstPercent: "18.00",
            gstAmount: "36.00",
            lineTotal: "236.00",
            lineNumber: 1,
          },
        ],
        deliveryAddresses: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            kind: "site",
            address: "Gate 3, Plot 9, Mora",
            quantity: "2.00",
            lineNumber: 1,
          },
        ],
      };

      const patchedBody = (): Record<string, unknown> | null => {
        const call = vi
          .mocked(globalThis.fetch)
          .mock.calls.find(
            ([url, init]) =>
              String(url).endsWith("/purchase-orders/" + ORDER_ID) &&
              (init as RequestInit | undefined)?.method === "PATCH",
          );
        const body = (call?.[1] as RequestInit | undefined)?.body;
        return typeof body === "string" ? JSON.parse(body) : null;
      };

      const openOrder = () => {
        routeFetch([
          [/\/document-options/, SITE_OPTIONS],
          [new RegExp("/purchase-orders/" + ORDER_ID + "$"), DETAIL],
          [/\/items/, list([ITEM])],
          [/\/units/, list([UNIT])],
          [/\/suppliers/, list([SUPPLIER])],
          [/\/companies/, list([COMPANY])],
          [/\/purchase-orders/, list([])],
        ]);
        return renderWithAuth(<PurchaseOrderFormDialog open orderId={ORDER_ID} onClose={() => {}} />, {
          permissions: ["purchase-orders.view", "purchase-orders.edit"],
          scope: SITE_SCOPE,
        });
      };

      it("shows the old split and a hand-typed shipping address, and saves without touching the split", async () => {
        const user = userEvent.setup();
        openOrder();

        expect(await screen.findByText(/delivery split from the old screen/i)).toBeInTheDocument();
        const group = await screen.findByRole("radiogroup", { name: /shipping address/i });
        expect(within(group).getByRole("radio", { name: /Typed by hand, long ago/ })).toBeChecked();
        // A contact typed on the old form is not on the site's list; it stays, labelled.
        const contact = screen.getByLabelText(/^contact person/i) as HTMLSelectElement;
        await waitFor(() =>
          expect(contact.selectedOptions[0]?.textContent).toBe(
            "Mahesh — 98250 11111 (saved on this document)",
          ),
        );

        await user.click(screen.getByRole("button", { name: /save changes/i }));
        await waitFor(() => expect(patchedBody()).not.toBeNull());
        // The resolver's create-schema default would have sent [] and wiped the split.
        expect(patchedBody()).not.toHaveProperty("deliveryAddresses");
        expect(patchedBody()!.contactName).toBe("Mahesh");
        expect(patchedBody()!.contactNumber).toBe("98250 11111");
      });

      it("clears the split only when asked", async () => {
        const user = userEvent.setup();
        openOrder();

        await user.click(await screen.findByRole("button", { name: /remove the old split/i }));
        await user.click(screen.getByRole("button", { name: /save changes/i }));
        await waitFor(() => expect(patchedBody()).not.toBeNull());
        expect(patchedBody()!.deliveryAddresses).toEqual([]);
      });
    });

    it("lists the site's locations, with a choice of none", async () => {
      open();

      const select = await screen.findByLabelText(/^location/i);
      await waitFor(() =>
        expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
          "No location",
          "Block A",
          "Store Yard",
        ]),
      );
    });

    it("says so when the site has no addresses at all", async () => {
      routeFetch([
        [/\/document-options/, { billingAddress: null, shippingAddresses: [], locations: [] }],
        [/\/units/, list([UNIT])],
        [/\/items/, list([])],
        [/\/suppliers/, list([])],
        [/\/companies/, list([])],
        [/\/purchase-orders/, list([])],
      ]);
      open();

      expect(await screen.findByText(/this site has no addresses yet/i)).toBeInTheDocument();
      expect(screen.getByLabelText("Billing address")).toHaveTextContent(/has no address/i);
    });
  });
});
