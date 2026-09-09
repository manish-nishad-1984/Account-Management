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

/**
 * Sales invoices — `SalesInvoice` and `SalesInvoiceDetail`.
 *
 * WHAT IS DIFFERENT FROM A PURCHASE INVOICE, which is less than doc 13 expects.
 * "One editor component, two directions" is right, and the three differences it
 * names are the real ones: the counterparty side, whether the number is issued
 * or typed, and the missing purchase-order link.
 *
 * THE SALES CALCULATOR IS THE HEALTHIEST OF THE THREE, and that is worth
 * stating because the assessment groups all three together under B-2.
 * Counted in the source on 8 Sep 2026, the same way the other two were:
 *
 *   - `CreateSalesInvoice.cshtml` loads exactly ONE script,
 *     `SalesInvoiceMasterScript.js`, so there is no same-name overwrite. B-2(a)
 *     — the TDS box read by a calculator that has been replaced — DOES NOT
 *     APPLY HERE.
 *   - `CreateSalesInvoice.cshtml` renders ZERO product rows; every row comes
 *     from `_DisplaySalesItemDetailsPartial.cshtml`, which carries
 *     `class="product"` — exactly what `updateSalesTotals` iterates. So B-2(b),
 *     the calculator that can see only half the table, DOES NOT APPLY HERE
 *     either. The purchase invoice page has 3 rows the winner cannot see; this
 *     one has none.
 *
 * TWO DEFECTS IT DOES HAVE, neither previously recorded, both found by reading
 * `updateSalesProductTotalAmount` against `updateSalesTotals`:
 *
 *  1. EDITING A PRICE SPLITS THE LINE IN TWO. The visible price box
 *     (`#txtSalesproductamount`) is editable, and the catalogue price is kept in
 *     a hidden twin (`#Salesproductamount`). The LINE's GST is computed from the
 *     HIDDEN one — `AmtWithDisc = hidden − discount` — while the ROLL-UP sums
 *     the VISIBLE one. So a user who types a price gets GST charged on the
 *     catalogue price and a subtotal based on what they typed, and the invoice
 *     total mixes the two.
 *
 *  2. TYPING A DISCOUNT THEN SILENTLY DISCARDS THAT PRICE. Both discount
 *     handlers end with
 *     `row.find("#txtSalesproductamount").val(productPrice - discountprice)`,
 *     where `productPrice` is the HIDDEN catalogue value — so the price the user
 *     typed is overwritten and there is no indication it happened.
 *
 * Neither is reproduced. There is one price here, it is the price, and the
 * server computes everything from it.
 */
export const salesInvoices = pgTable(
  "sales_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * OURS, unlike a purchase invoice's — issued from `document_counters`, per
     * company and financial year, inside the insert's transaction.
     *
     * `SalesRepo.CheckSalesInvoiceNo` has THREE defects, and the third is not
     * shared with the purchase order numberer:
     *
     *  1. Read-then-increment with no lock — `OrderByDescending(CreatedOn)
     *     .FirstOrDefault()` then a regex on the tail. Two concurrent callers
     *     get the same number.
     *  2. `CompanyDetails.InvoicePef.Trim()` with no null check, and
     *     `invoice_prefix` is nullable.
     *  3. IT NEVER RESTARTS AT 001. The lookup filters on company only, never on
     *     the financial year, while the LABEL it formats uses the current year.
     *     So the first invoice after 1 April continues last year's count:
     *     `DHP/25-26/157` is followed by `DHP/26-27/158`, and 26-27 has no 001.
     *
     * The counter here is keyed by year and starts each year at 001, as the
     * number's own format implies. FLAGGED FOR SIGN-OFF, same as the purchase
     * order sequence: the first sales invoice of a new financial year will be
     * 001 where the old system would have carried on counting.
     *
     * NOTE THE FORMAT HAS NO DOCUMENT-TYPE SEGMENT — `DHP/26-27/001`, where a
     * purchase order is `DHP/PO/26-27/001`. That is the source's format and it
     * is kept.
     */
    salesInvoiceNo: text("sales_invoice_no").notNull(),

    /** The customer's own reference for this invoice, if they gave one. */
    customerInvoiceNo: text("customer_invoice_no"),

    /** `Sales`, `Sales Return` or `Credit Note`. See `purchase_invoices`. */
    invoiceType: text("invoice_type").notNull().default("Sales"),

    siteId: uuid("site_id").references(() => sites.id),

    /**
     * THE CUSTOMER — and it references `suppliers`, which is not a mistake.
     *
     * `SalesInvoice.SupplierId` points at `SupplierMaster`: the source stores
     * BOTH sides of the trade in one party table, so a customer IS a supplier
     * row. `12-sales-invoice.md` notes the list column says "Customer" while the
     * filter beside it says "Supplier", which is the same fact surfacing as a
     * labelling inconsistency.
     *
     * The COLUMN is named for what it means. Splitting the party master into
     * customers and suppliers is a real modelling question with a data migration
     * behind it — every row would need classifying, and rows that are both would
     * need duplicating — so it is not something to decide while porting a screen.
     * The name at least stops the next reader thinking a sales invoice bills a
     * supplier.
     */
    customerId: uuid("customer_id")
      .notNull()
      .references(() => suppliers.id),

    /** The company SELLING, and the source of the invoice number's prefix. */
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),

    documentDate: timestamp("document_date", { withTimezone: true }),

    challanNo: text("challan_no"),
    lrNo: text("lr_no"),
    vehicleNo: text("vehicle_no"),
    dispatchBy: text("dispatch_by"),
    paymentTerms: text("payment_terms"),
    description: text("description"),

    contactName: text("contact_name"),
    contactNumber: text("contact_number"),
    shippingAddress: text("shipping_address"),

    /**
     * TOTALS — computed by `invoiceTotal.corrected()`, the same function the
     * purchase invoice uses and the same one the browser previews with.
     *
     * `subtotal` again has no source column; see `purchase_invoices.subtotal`.
     */
    subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull().default("0"),
    totalGstAmount: numeric("total_gst_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    totalDiscount: numeric("total_discount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    tds: numeric("tds", { precision: 18, scale: 2 }).notNull().default("0"),

    /** The Adjustment box. ADDED, and signed. */
    roundOff: numeric("round_off", { precision: 18, scale: 2 }).notNull().default("0"),

    /**
     * What the customer owes. Rounded to a WHOLE RUPEE with .50 going down —
     * `updateSalesTotals` carries its own copy of that rule, identical to the
     * purchase one, so it applies to every sales invoice ever issued too.
     */
    totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull().default("0"),

    /**
     * Carried, not managed — written by the PayIn screens, which are Phase 5.
     *
     * A payment is stored as a sales invoice row whose number is literally
     * `"PayIn"`; `CheckSalesInvoiceNo` excludes those when it looks for the last
     * number. The mirror of `"PayOut"` on the purchase side. Nothing in this
     * module writes such a row, and the numberer here cannot produce one.
     */
    paymentStatus: text("payment_status"),
    isPaidIn: boolean("is_paid_in").notNull().default(false),

    /** No `is_active` and no `is_deleted` — `SalesInvoice` has neither. */
    isApproved: boolean("is_approved").notNull().default(false),

    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("sales_invoices_site_id_idx").on(table.siteId),
    index("sales_invoices_customer_id_idx").on(table.customerId),
    index("sales_invoices_company_id_idx").on(table.companyId),
    index("sales_invoices_is_approved_idx").on(table.isApproved),
    index("sales_invoices_document_date_idx").on(table.documentDate),
    index("sales_invoices_created_at_idx").on(table.createdAt),
  ],
);

/** `SalesInvoiceDetail`. Same shape as the purchase lines, same decisions. */
export const salesInvoiceItems = pgTable(
  "sales_invoice_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    salesInvoiceId: uuid("sales_invoice_id")
      .notNull()
      .references(() => salesInvoices.id, { onDelete: "cascade" }),

    /** Nullable, so a line can name something not in the catalogue. */
    itemId: uuid("item_id").references(() => items.id),
    itemName: text("item_name"),
    itemDescription: text("item_description"),

    unitId: integer("unit_id")
      .notNull()
      .references(() => units.id),

    quantity: numeric("quantity", { precision: 18, scale: 2 }).notNull(),

    /**
     * ONE PRICE, where the source keeps two.
     *
     * `#txtSalesproductamount` (visible, editable) and `#Salesproductamount`
     * (hidden, the catalogue price) disagree the moment anyone types in the
     * first, and the calculator reads one for the line and the other for the
     * roll-up — see the table comment above. Storing one value makes that
     * disagreement unrepresentable.
     */
    unitPrice: numeric("unit_price", { precision: 18, scale: 2 }).notNull(),

    /** Rupees per unit. The percent is derived — see `purchase_invoice_items`. */
    discountPerUnit: numeric("discount_per_unit", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),

    gstPercent: numeric("gst_percent", { precision: 5, scale: 2 }),

    /** Computed from the line, never accepted from the client. */
    gstAmount: numeric("gst_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    netAmount: numeric("net_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull().default("0"),

    /** The source has no such column; see `purchase_invoice_items.line_number`. */
    lineNumber: integer("line_number").notNull(),

    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("sales_invoice_items_sales_invoice_id_idx").on(table.salesInvoiceId),
    index("sales_invoice_items_item_id_idx").on(table.itemId),
  ],
);
