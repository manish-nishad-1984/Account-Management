import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sites } from "./users";
import { items, units } from "./masters";

/**
 * Procurement — the first transaction tables, starting with Purchase Requests.
 *
 * Phase 3 of `13-Migration-Strategy-and-Roadmap.md`, chosen deliberately as the
 * first transaction wave because it carries NO money arithmetic. The GST
 * calculators of finding B-2 are still an open business question, so the first
 * transactional screens are the ones that do not depend on the answer.
 */

/**
 * Document number sequences, one row per (document type, financial year).
 *
 * This replaces `PurchaseRequestRepo.CheckPRNo()`, which had two defects:
 *
 *  1. RACE. It read the last row, added one, and returned — with no lock and no
 *     uniqueness anywhere. Two people creating a request in the same second get
 *     the same number.
 *
 *  2. COLLISION AFTER TEN. It parsed the sequence with
 *     `int.Parse(LastPr.PrNo.Substring(11))`. "PR/25-26/001" is twelve
 *     characters, so index 11 is the LAST CHARACTER only. From "009" it reads
 *     "9" and correctly produces "010" — but from "010" it reads "0" and
 *     produces "001" again, colliding with the first request of the year. The
 *     sequence cannot survive its own eleventh document.
 *
 *     CONFIRMED IN THE DATA, not just in the code. `PurchaseRequest` holds 28
 *     rows carrying only 12 distinct numbers: the sequence runs 001-010, restarts
 *     at 001, runs to 010 again, restarts once more and reaches 006. Ten numbers
 *     have been issued to more than one document. Only three rows are live and
 *     those three do not collide, so the import is clean — but every deleted row
 *     is evidence the defect has been firing since the 24-25 financial year.
 *
 * `PurchaseRequestNumbers.next()` increments this row inside the caller's
 * transaction instead, which is atomic under concurrency and reads the whole
 * counter rather than one character of it. The FORMAT is unchanged —
 * `PR/25-26/001` — because those strings are in the database and on paper.
 *
 * ETL NOTE: the importer must seed `next_value` from the highest number already
 * issued per year, or the new system reissues numbers the old one used.
 */
export const documentCounters = pgTable(
  "document_counters",
  {
    /** "purchase_request". Widened as purchase orders and invoices land. */
    documentType: text("document_type").notNull(),
    /** As the number renders it, e.g. "25-26". See `financialYear.format`. */
    financialYear: text("financial_year").notNull(),
    /** The number the NEXT document of this type and year will take. */
    nextValue: integer("next_value").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.documentType, table.financialYear] })],
);

/**
 * Purchase requests. `PurchaseRequest` in SQL Server, `Pid` renamed to `id`.
 *
 * One request is ONE LINE — a single item, quantity and unit. It is not a header
 * with detail rows, unlike every document downstream of it. That is the source's
 * shape and it is preserved: changing it would silently alter what a "purchase
 * request" means to the people using it.
 *
 * Quantity is `numeric`, so Drizzle hands it back as a STRING and it never
 * becomes a JavaScript float on the way through. A quantity is a decimal for the
 * same reason money is.
 */
export const purchaseRequests = pgTable(
  "purchase_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** `PR/25-26/001`. Issued by `document_counters`, never by the client. */
    prNo: text("pr_no").notNull(),

    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),

    /**
     * NULLABLE, with a real foreign key — a null means "no catalogue item", and
     * `item_name` carries the free text instead. Both spellings exist in the
     * source, which stores `ItemId` and a denormalised `ItemName` side by side.
     *
     * The source's list query INNER JOINs `ItemMaster`, so a request with no
     * `ItemId` is invisible in the application today while sitting in the table.
     * The read path here LEFT JOINs and falls back to `item_name`. That is a
     * deliberate departure, flagged for sign-off: a request that exists but
     * cannot be seen is a defect, not a rule, and the foreign key means the
     * column is either a real item or nothing.
     */
    itemId: uuid("item_id").references(() => items.id),
    itemName: text("item_name"),
    itemDescription: text("item_description"),

    unitId: integer("unit_id")
      .notNull()
      .references(() => units.id),

    /**
     * No CHECK (quantity > 0) yet, though the write contract requires it.
     *
     * Same reasoning as the nullable geography columns on `suppliers`: a
     * constraint on unvalidated history turns a data-quality problem into a
     * migration failure. The importer reports what it would refuse; the
     * constraint lands once that number is known to be zero.
     */
    quantity: numeric("quantity", { precision: 18, scale: 2 }).notNull(),

    /** `Date` in the source — the date on the document, not when it was keyed. */
    documentDate: timestamp("document_date", { withTimezone: true }),

    /**
     * The delivery address chosen on the request. Carried as a plain integer with
     * NO foreign key, exactly like `city_id` and `state_id` elsewhere: the source
     * `SiteAddress` table has not been extracted and its orphan volume is
     * unmeasured, so a real FK would refuse rows the ETL must still carry.
     *
     * `site_address` is the source's denormalised snapshot of the address text.
     */
    siteAddressId: integer("site_address_id"),
    siteAddress: text("site_address"),

    /**
     * `IsApproved` is NULLABLE in the source and NOT NULL here, defaulting false.
     * A three-state approval flag where the third state means "nobody has said"
     * is indistinguishable from "not approved" everywhere it is read.
     */
    isApproved: boolean("is_approved").notNull().default(false),

    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    /**
     * A request number identifies one document. NOT enforced in SQL Server, and
     * the `Substring(11)` defect above means production may well already hold
     * duplicates — in which case the importer refuses the losers and says so,
     * which is the point of having the index at all.
     */
    uniqueIndex("purchase_requests_pr_no_key")
      .on(sql`upper(${table.prNo})`)
      .where(sql`${table.isDeleted} = false`),

    index("purchase_requests_site_id_idx").on(table.siteId),
    index("purchase_requests_item_id_idx").on(table.itemId),

    /** The dashboard's pending-approval queue reads exactly this. */
    index("purchase_requests_is_approved_idx").on(table.isApproved),
  ],
);
