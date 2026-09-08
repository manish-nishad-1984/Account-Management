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
     * Terms and conditions.
     *
     * PLAIN TEXT IN THIS PASS, deliberately. The source stores HTML from a rich
     * text editor with a full toolbar, and three stored templates behind tabs.
     * Rendering stored HTML back to users needs a sanitiser, and the editor
     * itself is a dependency `05-legacy-screens` calls unbudgeted. Storing HTML
     * now without a sanitiser would put stored XSS on the application's own
     * origin — the same class of hole §5l closed on attachments.
     *
     * So: text is accepted and rendered as text. Importing the legacy HTML needs
     * the sanitiser first, and the ETL must not load this column until then.
     */
    terms: text("terms"),
    description: text("description"),

    /** Snapshots, as the source holds them. */
    billingAddress: text("billing_address"),
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
