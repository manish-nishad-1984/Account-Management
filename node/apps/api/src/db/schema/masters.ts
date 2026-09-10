import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Suppliers, units and items — the three masters that feed procurement.
 *
 * Two conventions carried over from `users.ts` and applied again here:
 *
 *  - `IsDelete` / `IsDeleted` is spelled `is_deleted` everywhere. The source is
 *    inconsistent (`SupplierMaster` says `IsDelete`, `ItemMaster` says
 *    `IsDeleted`) and one spelling has to win.
 *  - `Iffccode` is `ifsc_code`. The source name is a typo for the Indian bank
 *    routing code IFSC.
 *
 * MONEY IS `numeric`, NEVER `real` or `double precision`. Drizzle hands `numeric`
 * back as a string, which is the point: it never becomes a JavaScript float, so
 * 0.1 + 0.2 cannot happen on the way through. The source columns are SQL Server
 * `decimal`, so this is a faithful port as well as the correct choice.
 */

/**
 * Units of measure. `UnitMaster` in SQL Server — two columns, no audit trail and
 * no soft delete, reproduced as-is.
 *
 * `created_at` is added because it is not in the source: keyset pagination needs
 * a NOT NULL tiebreaker-friendly sort column, and a two-column table with no
 * timestamp cannot offer one other than the name.
 *
 * There is no `is_deleted`. The source has none, and a unit that items reference
 * must not vanish — `UnitsRepository.remove` refuses instead, which is a clearer
 * answer than a soft delete that leaves items pointing at a hidden row.
 */
export const units = pgTable(
  "units",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    name: text("name").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("units_name_lower_key").on(sql`lower(${table.name})`)],
);

/**
 * Suppliers. `SupplierMaster` in SQL Server, 20 columns.
 *
 * Deliberate departures:
 *  - `BuildingName` is `building_name`; `PinCode` is `pincode`, matching the
 *    spelling already used on `companies` and `sites`.
 *  - `State` and `City` are `state_id` / `city_id`. The source names a foreign
 *    key after the entity rather than the reference, and `state`/`city` as column
 *    names read as if they held the name, not the id.
 *  - Geography stays `integer` with NO foreign key, exactly as on `companies`
 *    and `sites`: the lookup tables have not been extracted and the orphan volume
 *    is unmeasured, so a real FK would refuse rows the ETL must still carry.
 *    These become FKs once the census in `Migration-Assessment/tools/` has run.
 *  - `city_id` and `state_id` are NULLABLE here though the source declares them
 *    NOT NULL, for the same reason: a NOT NULL on an unvalidated reference turns
 *    a data-quality problem into a migration failure. The write API requires them.
 */
export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),

    mobile: text("mobile"),
    email: text("email"),
    gstNo: text("gst_no"),

    buildingName: text("building_name"),
    area: text("area").notNull(),
    cityId: integer("city_id"),
    stateId: integer("state_id"),
    pincode: text("pincode"),

    bankName: text("bank_name"),
    bankBranch: text("bank_branch"),
    accountNo: text("account_no"),
    ifscCode: text("ifsc_code"),

    /**
     * `IsApproved` in the source. Nothing in the repository layer reads it as a
     * gate — an unapproved supplier can still be selected on a purchase order —
     * so it is carried as a flag, not enforced as one. Enforcing it would be a
     * behaviour change and needs business sign-off.
     */
    isApproved: boolean("is_approved").notNull().default(false),

    /** Opening ledger balance. `decimal` in SQL Server; string in and out here. */
    openingBalance: numeric("opening_balance", { precision: 18, scale: 2 }),
    openingBalanceDate: timestamp("opening_balance_date", { withTimezone: true }),

    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    /**
     * ~~A GST number identifies one legal entity; two live suppliers cannot
     * share one.~~ **THAT RULE WAS WRONG, AND IT COST REAL HISTORY.**
     *
     * It was invented by this port — SQL Server does not enforce it — and the
     * live data refuses it in three different ways:
     *
     * - **One entity, several supplier rows, deliberately.** UltraTech Cement
     *   appears as `ULTRATECH CEMENT LIMITED- CONCRETE`, `-AMBIKA` and
     *   `-SHIVAM`, all on `24AAACL6442L1ZG`. The business keeps a supplier row
     *   per site and product, which is ordinary practice, not an error.
     * - **A placeholder.** Four suppliers carry the GST number `00`.
     * - **Copy-paste.** Five unrelated names share `24AADCD9500G2ZY`.
     *
     * Only the first case has to be legitimate for uniqueness to be the wrong
     * constraint, and it is. Enforcing it dropped 11 live suppliers, and with
     * them 34 invoices worth Rs 46.4 lakh and 15 payments worth Rs 29.8 lakh —
     * history the old system holds and the new one would silently not have had.
     *
     * The index stays without the uniqueness, because suppliers are looked up
     * by GST number.
     */
    index("suppliers_gst_no_key").on(sql`upper(${table.gstNo})`),

    /**
     * Names are unique case-insensitively among live suppliers.
     *
     * Suppliers are chosen from a name dropdown on every purchase order, so two
     * rows reading "Shah Traders" are indistinguishable to the person picking
     * one. The source only guards this in application code, if at all.
     *
     * ETL NOTE: the supplier census has not run, so whether production already
     * holds case-duplicate names is unknown. If it does, the ETL must soft-delete
     * the losers before this index will build — that is the intended outcome, not
     * a reason to drop the constraint.
     */
    uniqueIndex("suppliers_name_lower_key")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.isDeleted} = false`),

    index("suppliers_is_approved_idx").on(table.isApproved),
  ],
);

/**
 * Items. `ItemMaster` in SQL Server.
 *
 * `UnitType` is a real foreign key here — it references `UnitMaster` in the
 * source too, and unlike geography the unit list is small, closed and fully
 * extractable, so there is nothing for an orphan to hide behind.
 *
 * GST columns are carried but NOT computed here. `Gstamount` is stored alongside
 * `Gstper` and `PricePerUnit`, which makes it derivable and therefore capable of
 * disagreeing with its own inputs. Today it is computed in the browser — the
 * three jQuery money calculators of assessment finding B-2 — and whichever of
 * them is correct is still an open business question. Until that is answered the
 * server stores what it is given and does not arbitrate. See
 * `07-Business-Rule-Inventory.md`.
 */
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),

    unitId: integer("unit_id")
      .notNull()
      .references(() => units.id),

    pricePerUnit: numeric("price_per_unit", { precision: 18, scale: 2 }).notNull(),

    isWithGst: boolean("is_with_gst").notNull().default(false),
    /** Percentage, e.g. "18.00". Nullable because a non-GST item has none. */
    gstPercent: numeric("gst_percent", { precision: 5, scale: 2 }),
    gstAmount: numeric("gst_amount", { precision: 18, scale: 2 }),

    /** Harmonised System of Nomenclature code — the GST classification code. */
    hsnCode: text("hsn_code"),

    isApproved: boolean("is_approved").notNull().default(false),

    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    /** Same reasoning as `suppliers_name_lower_key`, including the ETL note. */
    uniqueIndex("items_name_lower_key")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.isDeleted} = false`),

    index("items_unit_id_idx").on(table.unitId),
  ],
);
