import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies, sites } from "./users";
import { items, suppliers, units } from "./masters";
import { siteGroups } from "./site-groups";

/**
 * Purchase orders — `PurchaseOrder` and `PurchaseOrderDetail` in SQL Server.
 *
 * A header with detail rows, unlike the purchase request upstream of it, which
 * is one line per document.
 *
 * WHY THIS IS BUILDABLE WHILE THE INVOICES ARE NOT
 *
 * `08-create-purchase-order.md` point 5 marks PO totals as the reason B-2 has to
 * be answered first. That is true of invoices and not of this screen — see the
 * long note in `packages/domain/src/purchase-order-total.ts`, which records what
 * was counted in `CreatePurchaseOrder.cshtml` to establish it. In short: one
 * calculator script, no discount, no TDS, no round-off, and the row class the
 * calculator iterates matches the one the partial renders.
 *
 * The totals here are therefore SERVER-AUTHORITATIVE, computed by
 * `purchaseOrderTotal()` and stored. The source computes them in the browser and
 * saves whatever was posted, checking nothing.
 */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * `DHP/PO/24-25/049`. Issued by `document_counters`, never by the client.
     *
     * Numbered per COMPANY and per financial year — the company's invoice prefix
     * leads it — where a purchase request is numbered `PR/25-26/001` globally.
     * That is why `document_counters` gained a company dimension.
     *
     * NOT the string the legacy list displays. `_POListPartial.cshtml:8` renders
     * `@item.Poid - @item.BuyersPurchaseNo`, so the ` - OMSAGAR` suffix in the
     * capture is the BUYER'S purchase number concatenated in the view, not part
     * of the document number. `07-purchase-orders.md` reads it as an appended
     * free-text component of the number; that is a misreading of the screenshot
     * and the number itself is clean.
     */
    poNo: text("po_no").notNull(),

    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),

    /** `FromSupplierId`. */
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),

    /** `ToCompanyId` — the company raising the order, and the number's prefix. */
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),

    documentDate: timestamp("document_date", { withTimezone: true }),

    /**
     * `SiteGroup` is an `nvarchar` in the source holding the group's NAME, matched
     * by string equality — the de facto foreign key of section 6, where renaming a
     * group silently detaches its documents. A real reference here.
     *
     * DEPARTURE, flagged for sign-off: it changes nothing a user sees, but it
     * means a group cannot be renamed out from under its orders.
     */
    siteGroupId: uuid("site_group_id").references(() => siteGroups.id),

    /**
     * DELIVERY SCHEDULE — one legacy column, two meanings, split deliberately.
     *
     * `DeliveryShedule` (sic) is a single nullable string holding either a date or
     * the word "Immediate", because the form is a date input beside an
     * Immediate/Date radio pair. `08-create-purchase-order.md` point 4 says to
     * pick one representation.
     *
     * Picked: a nullable date PLUS a boolean. The alternative — a nullable date
     * where NULL means immediate — cannot distinguish "immediate" from "nobody
     * filled it in", and both occur.
     *
     * ETL: parse the legacy string; report what will not parse rather than
     * dropping it. Do NOT keep the raw string alongside these two, or the table
     * carries the same fact twice and they drift, which is the defect §5j found
     * in `DocumentName`.
     */
    deliveryDate: timestamp("delivery_date", { withTimezone: true }),
    deliveryImmediate: boolean("delivery_immediate").notNull().default(false),

    /**
     * Terms and conditions — SANITISED HTML.
     *
     * This column held plain text until the sanitiser landed, and the reason is
     * the same class of hole §5l closed on attachments: the source renders
     * stored terms with `@Html.Raw(firstItem.PaymentTerms)` straight into the
     * printed order (`POPrintDetails.cshtml:406`), so whatever HTML is stored
     * runs for everyone who opens that order. Storing rich text before markup
     * could be refused at the boundary would have been stored XSS on the
     * application's own origin.
     *
     * What may be in it is `TERMS_ALLOWED_TAGS` in
     * `contracts/purchase-order-terms.ts`, and `TermsSanitiser` is the only
     * thing that writes it. Everything outside the allowlist is removed before
     * the insert, so a reader of this column can render it.
     *
     * THE ETL TRAP, and it is the expensive one. The legacy column holding these
     * terms is `PurchaseOrder.PaymentTerms`, NOT `PurchaseOrder.Terms` — no
     * control on the create screen binds to `Terms` at all. So legacy
     * `PaymentTerms` loads HERE, through the sanitiser, and must NOT be loaded
     * into `payment_terms` below, which is a different and much shorter field.
     * Getting it the obvious way round drops a page of terms into a one-line box
     * and leaves every imported order with no terms at all.
     */
    terms: text("terms"),

    /**
     * Which of the three boilerplate templates the terms started from —
     * `PaymentTermsId` in the source, an `nvarchar(100)` holding the literal
     * strings "Term-1", "Term-2" and "Term-3".
     *
     * Stored because the legacy screen reopens an order on the tab it was saved
     * from, and because it is the only record of which boilerplate a given
     * supplier was actually sent. `LEGACY_TERMS_TEMPLATE_IDS` maps the old
     * strings; an unrecognised value becomes null rather than failing the row.
     */
    termsTemplate: text("terms_template"),

    description: text("description"),

    /** Snapshots, as the source holds them. */
    billingAddress: text("billing_address"),

    /**
     * The source's `SiteGroup`-side snapshot, and it is LOSSY BY CONSTRUCTION.
     *
     * `PurchaseRequestScript.js:1046` fills it with
     * `$('input[name="selectedPOGroupAddress"]:checked').val()`, and jQuery's
     * `.val()` on a set returns only the FIRST element's value. So an order
     * delivered to four group addresses records one of them here while the list
     * beside it carries all four — a header column that silently disagrees with
     * its own detail rows.
     *
     * `purchase_order_delivery_addresses` is the real answer and is what the
     * screen reads. This is kept so the ETL is lossless and so an imported order
     * whose detail rows are missing still shows the one address the header
     * happened to catch.
     */
    groupAddress: text("group_address"),

    buyersPurchaseNo: text("buyers_purchase_no"),
    contactName: text("contact_name"),
    contactNumber: text("contact_number"),

    /** `OtherContact` / `OtherName`. The FORM misspells its label "Other
     * ContectNo"; the column does not. */
    otherContactName: text("other_contact_name"),
    otherContactNumber: text("other_contact_number"),

    dispatchBy: text("dispatch_by"),
    paymentTerms: text("payment_terms"),

    /**
     * TOTALS — computed on the server from the lines, never accepted from the
     * client. Stored because the list shows Total Amount and recomputing it per
     * row on every page would mean a join and an aggregate for a value that
     * cannot change without the lines changing.
     *
     * `numeric`, so Drizzle hands them back as STRINGS and no total ever becomes
     * a JavaScript float on the way through.
     */
    subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull().default("0"),
    totalGstAmount: numeric("total_gst_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull().default("0"),

    /**
     * `TotalDiscount` exists on the source header and `Discount` on each source
     * line, and the CREATE SCREEN HAS NEITHER — `CreatePurchaseOrder.cshtml`
     * contains zero occurrences of "discount". The calculator has no discount
     * term either, so no order this system issued has ever had one applied.
     *
     * Carried so the ETL is lossless and any value already stored survives, and
     * deliberately NOT fed into the totals, because doing so would change what
     * historical orders are worth. Nothing reads it yet. If the business wants
     * discounts on orders, that is a new field on the form and a decision about
     * the arithmetic, not a column to quietly switch on.
     */
    totalDiscount: numeric("total_discount", { precision: 18, scale: 2 }),

    /** The list's status filter defaults to Active, not All. */
    isActive: boolean("is_active").notNull().default(true),
    isApproved: boolean("is_approved").notNull().default(false),
    isDeleted: boolean("is_deleted").notNull().default(false),

    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("purchase_orders_site_id_idx").on(table.siteId),
    index("purchase_orders_supplier_id_idx").on(table.supplierId),
    index("purchase_orders_company_id_idx").on(table.companyId),
    index("purchase_orders_is_approved_idx").on(table.isApproved),
    index("purchase_orders_is_active_idx").on(table.isActive),
    index("purchase_orders_created_at_idx").on(table.createdAt),
  ],
);

/**
 * `PurchaseOrderDetail`. `PorefId` becomes a real foreign key.
 *
 * The source's `Id` is an `int` identity and `PORefId` carries no constraint at
 * all — one of the ~62 unconstrained FK columns the census is meant to count.
 */
export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),

    /**
     * NULLABLE with a real foreign key, for the reason §5f gives on purchase
     * requests: the source INNER JOINs `ItemMaster`, so a line keyed as free
     * text with no `ItemId` sits in the table and is invisible in the
     * application. A null here means "no catalogue item", and the line still
     * lists, labelled by its own text.
     */
    itemId: uuid("item_id").references(() => items.id),
    itemName: text("item_name"),
    itemDescription: text("item_description"),

    unitId: integer("unit_id")
      .notNull()
      .references(() => units.id),

    quantity: numeric("quantity", { precision: 18, scale: 2 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 2 }).notNull(),

    /** Percentage, e.g. "18.00". `Gstper` in the source. */
    gstPercent: numeric("gst_percent", { precision: 5, scale: 2 }),

    /**
     * Computed from the line, not accepted from the client. `Gst` and
     * `ItemTotal` in the source, where the browser sends both.
     */
    gstAmount: numeric("gst_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull().default("0"),

    /** See `purchase_orders.total_discount`. Carried, never applied. */
    discount: numeric("discount", { precision: 18, scale: 2 }),

    /** Position in the grid, so the printed order matches what was keyed. */
    lineNumber: integer("line_number").notNull(),

    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("purchase_order_items_purchase_order_id_idx").on(table.purchaseOrderId),
    index("purchase_order_items_item_id_idx").on(table.itemId),
  ],
);

/**
 * Where an order is delivered, and how much goes to each place —
 * `PodeliveryAddress` in SQL Server.
 *
 * The legacy Create Purchase Order screen has two panels under the line grid:
 * "Shipping Addresses" listing the site's own addresses, and "Group Address"
 * listing the addresses of the chosen site group. Each row is a checkbox and a
 * quantity box. Both panels post into ONE list and land in ONE table.
 *
 * THREE THINGS ARE DIFFERENT HERE, and all three are recorded rather than fixed
 * quietly.
 *
 * 1. `kind` IS A COLUMN. The source tells the two panels apart by prefixing a
 *    group address with the string `"Group-"` before posting it
 *    (`PurchaseRequestScript.js:1003`) and stripping it on the way back out with
 *    `Address.Replace("Group-", "")` (`CreatePurchaseOrder.cshtml:619`). That
 *    puts a type tag inside the data it describes: `Replace` removes the marker
 *    from ANY position, so an address reading "Ward 3, Group-B" is displayed as
 *    "Ward 3, B", and a site address that genuinely starts with those characters
 *    is read back as a group one.
 *
 * 2. `quantity` IS DECIMAL. `PodeliveryAddress.Quantity` is `int?` while the
 *    browser collects it with `parseFloat` and every order line quantity is
 *    `numeric`. An order measured in tonnes cannot allocate 2.5 of them to a
 *    site: SQL Server rounds on the way in and the deliveries stop adding up to
 *    the order. Widening a column that has only ever held whole numbers cannot
 *    change an existing row.
 *
 * 3. `unit_type_id` IS NOT HERE. The source copies the HEADER's single
 *    `UnitTypeId` onto every delivery row (`PurchaseOrderRepo.cs:688`). Units in
 *    this port are per LINE, so there is no single header unit to copy, and
 *    stamping one unit onto an address serving lines measured in three different
 *    units would state something false. Nothing reads the source column: the
 *    view projects it and no screen displays it.
 *
 * The source ALSO has an `IsDeleted` flag here that nothing sets, because its
 * update path hard-deletes with `RemoveRange` instead
 * (`PurchaseOrderRepo.cs:806`). Rows are replaced wholesale here for the same
 * reason the line items are — see the note on `updatePurchaseOrderSchema` — so a
 * flag that only ever reads false is not carried.
 */
export const purchaseOrderDeliveryAddresses = pgTable(
  "purchase_order_delivery_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),

    /** `site` or `group` — which panel the address was ticked in. */
    kind: text("kind").notNull(),

    /**
     * A SNAPSHOT of the address text, as the source stores it.
     *
     * Not a reference to `sites` or to `site_group_addresses`, deliberately.
     * Editing a group's address later must not rewrite where an order that has
     * already shipped was sent, and a purchase order is a document of record.
     */
    address: text("address").notNull(),

    quantity: numeric("quantity", { precision: 18, scale: 2 }).notNull(),

    /** Position in the panel, so a reopened order lists them as they were keyed. */
    lineNumber: integer("line_number").notNull(),

    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("purchase_order_delivery_addresses_po_id_idx").on(table.purchaseOrderId),
  ],
);
