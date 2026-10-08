import { sql } from "drizzle-orm";
import { boolean, check, index, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies, sites } from "./users";
import { suppliers } from "./masters";
import { siteGroups } from "./site-groups";
import { siteLocations } from "./site-locations";

/**
 * Payments — the modelling decision this module was blocked on.
 *
 * THERE IS NO PAYMENTS TABLE IN THE SOURCE. A payment is a row in
 * `SupplierInvoice` (or `SalesInvoice`) with no detail lines, identified by a
 * MAGIC STRING in the number column. `14-reports-and-payments.md` calls this
 * "the single largest modelling decision left in the migration". It is decided
 * here, and this comment is the argument.
 *
 * THREE sentinel numbers exist, not one:
 *
 *   InvoiceNo = "PayOut"           a payment made to a supplier
 *   InvoiceNo = "Opening Balance"  a brought-forward balance
 *   SalesInvoiceNo = "PayIn"       a receipt from a customer
 *
 * `InsertPayOutDetailsReport` in `PayOutScript.js:687` chooses between the first
 * two in the BROWSER and posts the literal string; `AddSupplierInvoice`
 * (`SupplierInvoiceRepo.cs:43`) stores whatever arrives and additionally
 * hard-codes `IsPayOut = true`. So there are two independent markers for the
 * same fact, set in two different places, and **they disagree**: an Opening
 * Balance row has `IsPayOut = true` and an `InvoiceNo` that is not "PayOut".
 * Every read in the system discriminates on the STRING and ignores the boolean.
 *
 * WHY A REAL TABLE, RATHER THAN REPRODUCING THE SENTINEL ROWS
 *
 * 1. Every read of `purchase_invoices` would have to remember to exclude three
 *    magic strings, forever, and the ones that forget do not fail — they quietly
 *    include payments in an invoice list. `SalesRepo.cs:39` and the item price
 *    history of §5t are two places that remember; nothing enforces it.
 * 2. It would mean weakening the invoice contract. `createPurchaseInvoiceSchema`
 *    REQUIRES a supplier invoice number and at least one line. A payment has
 *    neither. Admitting payments would relax both for every invoice.
 * 3. It is the same decision this port has already made four times: the document
 *    counter that replaced a substring parse, the site group FK that replaced a
 *    name match, the purchase order FK that replaced a text match, and the
 *    delivery address `kind` column that replaced a `"Group-"` string prefix. A
 *    fact the source encodes in a string is a column here.
 *
 * The ETL keeps this lossless: a legacy payment row carries its own id, so a
 * `payments` row can be created from it and the invoice row dropped, and the
 * three sentinel strings are recoverable from `direction` and `kind`.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * `out` is money paid to a supplier, `in` is money received from a customer.
     *
     * The source expresses this by which TABLE the row is in, which is why the
     * ledger has to run two near-identical queries over two near-identical
     * shapes. One table with a direction is the same information; `suppliers`
     * already holds both sides of the trade (see `sales_invoices.customer_id`).
     */
    direction: text("direction").notNull(),

    /**
     * `payment` or `opening_balance`.
     *
     * An opening balance is not a payment — it is the balance carried in when
     * the business started using the system, and it moves the ledger the
     * OPPOSITE way. The source distinguishes them by the sentinel string alone,
     * which is why `IsPayOut = true` sits on rows that are not payouts.
     */
    kind: text("kind").notNull().default("payment"),

    /** Supplier or customer — one party table, as `sales_invoices` already uses. */
    partyId: uuid("party_id")
      .notNull()
      .references(() => suppliers.id),

    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),

    /**
     * NULLABLE, and this is not laziness.
     *
     * `PayOutScript.js:713` validates `SiteId` for a payment and DELIBERATELY
     * does not for an opening balance — the two branches of that `if` differ by
     * exactly that field. A brought-forward balance belongs to the party, not to
     * a site, so it genuinely has none. A NOT NULL column here would make every
     * historical opening balance unimportable.
     */
    siteId: uuid("site_id").references(() => sites.id),

    /** See `purchase_orders.site_group_id` — the same text match, made real. */
    siteGroupId: uuid("site_group_id").references(() => siteGroups.id),

    /** See `purchase_orders.site_location_id`. */
    siteLocationId: uuid("site_location_id").references(() => siteLocations.id),

    /** The date the money moved, as typed. Distinct from `created_at`. */
    paymentDate: timestamp("payment_date", { withTimezone: true }),

    /**
     * Always POSITIVE. The direction of the effect comes from `direction` and
     * `kind`, never from the sign.
     *
     * The source stores it in `TotalAmount` and negates it at read time —
     * `NetAmount = group.Sum(x => x.InvoiceNo != "PayOut" ? x.TotalAmount :
     * -x.TotalAmount)` — so the sign lives in four separate expressions across
     * two repositories and a JavaScript file, and they do not agree (§5u).
     */
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),

    description: text("description"),

    /**
     * Cash, cheque, NEFT — the source's `PaymentStatus` column, which on a
     * payment row holds the payment TYPE radio rather than a status. The name is
     * not reproduced because it means the opposite of what it says; the ETL
     * loads `PaymentStatus` into here and the note is on this line so an ETL
     * author standing on this column reads it.
     */
    method: text("method"),

    /** Cheque or transaction number. NEW: the source has nowhere to put one. */
    referenceNo: text("reference_no"),

    /**
     * SOFT delete, where `DeletePayoutDetails` (`SupplierInvoiceRepo.cs:1236`)
     * calls `Remove()` and the row leaves the table.
     *
     * A DEPARTURE, and an easy one to argue: a deleted payment changes a
     * supplier balance, and a balance that changed with no record of why is the
     * thing an audit asks about. The same departure §5i made for inventory
     * arrivals, where the source's delete was also unrecoverable and the list
     * filtered on a flag the delete never wrote.
     */
    isDeleted: boolean("is_deleted").notNull().default(false),

    /**
     * The payout list this payment was made by, when it was made by confirming one
     * (7 Oct 2026). Null for a payment keyed on the Payments screen. It is what lets
     * "reverse the confirmation" find exactly the payments that list created and no
     * others. No foreign key: the payout tables are a later layer than this one.
     */
    sourcePayoutListId: uuid("source_payout_list_id"),

    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("payments_source_payout_list_idx").on(table.sourcePayoutListId),
    index("payments_party_id_idx").on(table.partyId),
    index("payments_company_id_idx").on(table.companyId),
    index("payments_site_id_idx").on(table.siteId),
    index("payments_direction_idx").on(table.direction),
    index("payments_payment_date_idx").on(table.paymentDate),
    index("payments_created_at_idx").on(table.createdAt),
  ],
);

/**
 * WHICH BILLS A PAYMENT SETTLES (client request, 7 Oct 2026).
 *
 * A payment on its own only moves the party's balance, and the reports ASSUME it
 * paid the oldest bills first. A row here says, instead, "this much of this
 * payment paid this bill". A payment with no rows is exactly what it always was,
 * and keeps the oldest-first rule; only the part of a payment not named here
 * falls back to it. So an existing payment needs no row, and nothing about the
 * 583 that exist changes.
 *
 * `document_kind` is `invoice` or `opening_balance`, the two kinds of thing that
 * can be owed, as the Pending Outstanding report names them. `document_id` is
 * not a foreign key to either, because it points at two tables. A reader that
 * joins this to the ledger entries by id and kind gets the bill.
 *
 * A payment and the bill it pays are always the same party, company and site: the
 * ledger groups by party and site, and an allocation that crossed groups would
 * make one group's balance disagree with its own bills. The server refuses it.
 */
export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    documentKind: text("document_kind").notNull(),
    documentId: uuid("document_id").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("payment_allocations_payment_idx").on(table.paymentId),
    index("payment_allocations_document_idx").on(table.documentKind, table.documentId),
    unique("payment_allocations_payment_document_key").on(table.paymentId, table.documentKind, table.documentId),
    check("payment_allocations_amount_positive", sql`${table.amount} > 0`),
    check("payment_allocations_kind", sql`${table.documentKind} in ('invoice', 'opening_balance')`),
  ],
);
