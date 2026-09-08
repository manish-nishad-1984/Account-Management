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
import { purchaseOrders } from "./purchase-orders";

/**
 * Purchase invoices — `SupplierInvoice` and `SupplierInvoiceDetail`.
 *
 * WHAT B-2 ACTUALLY BLOCKS, AND WHAT IT DOES NOT
 *
 * `11-create-purchase-invoice.md` says "none of it can be built honestly until
 * B-2 is answered". That was right about the ARITHMETIC and it has since been
 * answered — not by the business, but by reading and running the source. The
 * answer lives in `packages/domain/src/invoice-total.ts`, which carries both
 * `asProduced()` (what the shipped JavaScript computes, defects included) and
 * `corrected()` (what the business believes it is getting), so the difference
 * between them can be measured per invoice instead of argued about.
 *
 * Re-verified from the source on 8 Sep 2026 before this table was written,
 * because building the money on a second-hand summary is how the wrong rule
 * gets baked in. Counted, not inferred:
 *
 *   - `CreateInvoice.cshtml` loads THREE scripts. Two define `updateTotals`;
 *     `PurchaseRequestScript.js` loads last and wins. It has no discount, no
 *     TDS and no round-off.
 *   - `CreateInvoice.cshtml` has 3 rows classed `productRow` and 0 classed
 *     `product`. The two partials that add rows have 1 `product` and 0
 *     `productRow` each. The winning calculator iterates `.product`, so it
 *     cannot see a single row the page was built with — confirming B-2(b)
 *     independently.
 *   - The losing calculator DOES read TDS and round-off, and rounds the grand
 *     total to a whole rupee with exactly .50 going DOWN. Every one of the six
 *     sample totals in `10-purchase-invoice.md` ends in `.00`, which is what
 *     that rule would produce and what nothing else would.
 *
 * So this table stores SERVER-COMPUTED totals from `invoiceTotal.corrected()`.
 * What remains open in B-2 is historical remediation — how far back to
 * investigate documents already saved with a total that ignored their TDS — and
 * that is a question about existing data, not about what this table should hold.
 *
 * D7 DOES NOT BLOCK THIS EITHER, and it is worth saying why. D7 is "purchase
 * returns are added to supplier balances instead of subtracted". The adding
 * happens in `SupplierInvoiceRepo.cs:227` and its four copies, which bucket
 * `InvoiceType in ('Purchase Return','Credit Note')` into `PayOutTotalAmount`.
 * That is a BALANCE aggregate, in the reports and payments screens. Listing,
 * detailing, creating and approving an invoice never computes a supplier
 * balance, so none of it depends on the answer. D7 still blocks Phase 5.
 */
export const purchaseInvoices = pgTable(
  "purchase_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * THE SUPPLIER'S OWN NUMBER — `BB/154`, `016`, `BE-2026-27-4756`.
     *
     * Free text in whatever format the supplier uses, so NO UNIQUENESS IS
     * ASSUMED, not across suppliers and not within one. There is deliberately no
     * unique index here; `10-purchase-invoice.md` point 1 says the same.
     */
    supplierInvoiceNo: text("supplier_invoice_no"),

    /**
     * Our own reference, where one exists. The source has BOTH columns and the
     * list partial picks between them:
     *
     *     @if (item.SupplierInvoiceNo == "") { @item.InvoiceNo } else { @item.SupplierInvoiceNo }
     *
     * DEFECT, not reproduced: that test is `== ""`, so a NULL supplier number
     * takes the else branch and the row renders an EMPTY link — a document you
     * cannot identify or click. Null and empty mean the same thing here, and
     * `displayNo` in the repository treats them the same.
     */
    invoiceNo: text("invoice_no"),

    /**
     * `Purchase`, `Purchase Return` or `Credit Note`.
     *
     * Text rather than an enum because the source is an unconstrained nvarchar
     * and the ETL must be able to load whatever is actually in there — including
     * rows that are none of the three. Reads that care compare on the two return
     * kinds, never on the positive one, which is why the default is the plain
     * purchase and no check constraint narrows it yet. Narrowing it needs the
     * census (§8) to say what values exist.
     */
    invoiceType: text("invoice_type").notNull().default("Purchase"),

    siteId: uuid("site_id").references(() => sites.id),

    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),

    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),

    /**
     * The purchase order this invoices, as a REAL foreign key.
     *
     * `SupplierInvoice.Poid` is an `nvarchar` holding the order's number as
     * text, matched by string equality — assessment 09 §7.5, and the same de
     * facto foreign key the site group has. Renaming or reissuing an order
     * silently detaches its invoices today.
     *
     * Nullable because an invoice with no order behind it is ordinary: goods
     * bought without one, and every historical row whose text never matched.
     * The ETL resolves the text and REPORTS what it cannot match rather than
     * dropping it.
     */
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id),

    /** See `purchase_orders.site_group_id` — the same text match, made real. */
    siteGroupId: uuid("site_group_id").references(() => siteGroups.id),

    documentDate: timestamp("document_date", { withTimezone: true }),

    /** Goods-receipt references, all free text on the source. */
    challanNo: text("challan_no"),
    lrNo: text("lr_no"),
    vehicleNo: text("vehicle_no"),
    dispatchBy: text("dispatch_by"),
    paymentTerms: text("payment_terms"),
    description: text("description"),

    contactName: text("contact_name"),
    contactNumber: text("contact_number"),
    shippingAddress: text("shipping_address"),
    groupAddress: text("group_address"),

    /**
     * TOTALS — computed by `invoiceTotal.corrected()` on the server, never
     * accepted from the client.
     *
     * `subtotal` HAS NO SOURCE COLUMN. `SupplierInvoice` stores TotalAmount,
     * TotalGstamount, TotalDiscount, DiscountRoundoff and Tds but no net — so
     * the legacy grand total cannot be checked against its own lines without
     * re-deriving it. Storing it makes every one of these six numbers
     * reconcilable, which is precisely what B-2 needs to be answerable over
     * historical data.
     */
    subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull().default("0"),
    totalGstAmount: numeric("total_gst_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    totalDiscount: numeric("total_discount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),

    /** Tax deducted at source. SUBTRACTED from the total. */
    tds: numeric("tds", { precision: 18, scale: 2 }).notNull().default("0"),

    /**
     * The "Adjustment" box — `DiscountRoundoff`. ADDED to the total, and signed:
     * nudging a total DOWN to match a supplier's paperwork is the common case,
     * so this is routinely negative. Not a `numeric` with a positive check.
     */
    roundOff: numeric("round_off", { precision: 18, scale: 2 }).notNull().default("0"),

    /**
     * What is owed. `subtotal + gst − discount − tds + roundOff`, then rounded
     * to a WHOLE RUPEE with .50 going down — see `roundToWholeRupeeAsProduced`.
     * That rounding is a business rule applied to every document ever issued,
     * not a defect, and it is not switched off without an answer to question 1.
     */
    totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull().default("0"),

    /**
     * PAYMENT STATE IS CARRIED, NOT MANAGED. `PaymentStatus` is free text and
     * `IsPayOut` a flag, both written by the payments screens, which are Phase 5
     * and blocked on D7. Held so the ETL is lossless and the list can show what
     * a document's state already was; nothing in this module writes them.
     */
    paymentStatus: text("payment_status"),
    isPaidOut: boolean("is_paid_out").notNull().default(false),

    /**
     * NO `is_active` AND NO `is_deleted`, unlike purchase orders — because
     * `SupplierInvoice` has neither, and the list screen has no Active/All
     * filter to go with them. Inventing a soft delete here would mean the ETL
     * had to guess a value for every historical row and the list had to filter
     * on a column that never meant anything. Deleting an invoice deletes it.
     */
    isApproved: boolean("is_approved").notNull().default(false),

    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("purchase_invoices_site_id_idx").on(table.siteId),
    index("purchase_invoices_supplier_id_idx").on(table.supplierId),
    index("purchase_invoices_company_id_idx").on(table.companyId),
    index("purchase_invoices_purchase_order_id_idx").on(table.purchaseOrderId),
    index("purchase_invoices_is_approved_idx").on(table.isApproved),
    index("purchase_invoices_document_date_idx").on(table.documentDate),
    index("purchase_invoices_created_at_idx").on(table.createdAt),
  ],
);

/** `SupplierInvoiceDetail`. `RefInvoiceId` becomes a real foreign key. */
export const purchaseInvoiceItems = pgTable(
  "purchase_invoice_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    purchaseInvoiceId: uuid("purchase_invoice_id")
      .notNull()
      .references(() => purchaseInvoices.id, { onDelete: "cascade" }),

    /**
     * NULLABLE, where the source's `ItemId` is a non-null `Guid`.
     *
     * The source cannot represent a line for something not in the catalogue, so
     * people put the real description in `ItemName` against whatever item id was
     * handy. A null here means "no catalogue item" honestly, and the line lists
     * labelled by its own text — the same decision as purchase orders and
     * requests.
     */
    itemId: uuid("item_id").references(() => items.id),
    itemName: text("item_name"),
    itemDescription: text("item_description"),

    unitId: integer("unit_id")
      .notNull()
      .references(() => units.id),

    quantity: numeric("quantity", { precision: 18, scale: 2 }).notNull(),

    /** Price of one unit BEFORE discount — the source's hidden `.productamount`. */
    unitPrice: numeric("unit_price", { precision: 18, scale: 2 }).notNull(),

    /**
     * DISCOUNT IS STORED ONCE, IN RUPEES PER UNIT — and this is a departure.
     *
     * The source has BOTH `DiscountAmount` and `DiscountPer`, and
     * `11-create-purchase-invoice.md` asks which is authoritative when both are
     * set. Reading the handlers answers it: they are two views of one number and
     * cannot independently disagree.
     *
     *   `updateDiscount`          rupees typed -> writes the percent
     *   `UpdateDiscountPercentage` percent typed -> writes the rupees
     *
     * Each writes the other, and both then write the effective price. So there
     * is no state in which they hold different discounts — the second field is a
     * rendering of the first. Storing both would put the same fact in the table
     * twice and let them drift, which is the defect §5j found in `DocumentName`.
     *
     * The percent is derived for display from `unit_price` and this. The ETL
     * must RECONCILE the legacy pair and report rows where they disagree, rather
     * than trusting either — a row where they do disagree was written by
     * something other than these two handlers and is worth seeing.
     */
    discountPerUnit: numeric("discount_per_unit", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),

    /** Percentage, e.g. "18.00". `Gstper`. */
    gstPercent: numeric("gst_percent", { precision: 5, scale: 2 }),

    /** Computed from the line, never accepted from the client. */
    gstAmount: numeric("gst_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    netAmount: numeric("net_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull().default("0"),

    /**
     * Position in the grid. THE SOURCE HAS NO SUCH COLUMN — its detail rows come
     * back in whatever order the query happens to return, so a printed invoice
     * can list its lines differently from the screen that keyed them. Added, and
     * the ETL fills it from the identity `InvoiceDetailsId` so existing
     * documents keep the order they were entered in.
     */
    lineNumber: integer("line_number").notNull(),

    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("purchase_invoice_items_purchase_invoice_id_idx").on(table.purchaseInvoiceId),
    index("purchase_invoice_items_item_id_idx").on(table.itemId),
  ],
);
