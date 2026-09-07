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
import { sites } from "./users";
import { items, units } from "./masters";

/**
 * Inventory inward — stock arriving at a site.
 *
 * `InventoryInward` in SQL Server, reached through `/Sales/CreateInventory`.
 * There is no repository of its own: the five methods live inside `SalesRepo.cs`
 * alongside sales invoices, which is why assessment 03 lists it as "part of
 * SalesRepo". The smallest transaction table in the system — three live rows.
 *
 * One line per arrival: an item, a quantity, a unit, a date. No document number,
 * no supplier, no money, no attachments.
 */
export const inventoryInward = pgTable(
  "inventory_inward",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * NULLABLE, and IN PRODUCTION IT IS ALWAYS NULL.
     *
     * The column exists on `InventoryInward` and nothing ever writes it:
     * `InsertInventoryDetails` builds the entity without it and
     * `UpdateInventoryDetails` does not touch it. The create form has no site
     * field at all — six fields, none of them a site.
     *
     * That matters for the SITE SCOPE. A scoped list that filtered
     * `site_id = :siteId` would hide every imported row from every user, because
     * every imported row has no site. So the read path treats null as
     * "unallocated" and shows it under any scope, and the write path sets the
     * caller's scoped site so new rows are attributable. See the note on
     * `InventoryInwardRepository.list`.
     */
    siteId: uuid("site_id").references(() => sites.id),

    /**
     * NOT NULL with a real foreign key, unlike `purchase_requests.item_id`.
     *
     * The source column is `Guid` rather than `Guid?` and the create form has no
     * free-text alternative, so unlike a purchase request there is no legitimate
     * off-catalogue row. `item_name` below is a denormalised snapshot, not a
     * fallback.
     */
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),

    /**
     * `Item` in the source — the item's name as it was when the row was keyed.
     *
     * KEPT, though it duplicates `items.name`, because the source reads the two
     * inconsistently and the difference is visible to users: `GetInventoryList`
     * projects `i.ItemName` from the master while `EditInventoryDetails`
     * projects `a.Item` from this column. Rename an item and the list shows the
     * new name while the edit form shows the old one. Dropping the column would
     * silently pick a winner; keeping it records that the question exists.
     * The list here reads the MASTER, and the form does too.
     */
    itemName: text("item_name"),

    unitId: integer("unit_id")
      .notNull()
      .references(() => units.id),

    quantity: numeric("quantity", { precision: 18, scale: 2 }).notNull(),

    /** `Date` — the date on the arrival, not when it was keyed. */
    documentDate: timestamp("document_date", { withTimezone: true }),

    /**
     * `Details` in the source. GENUINELY FREE TEXT — the captured row reads
     * "TO RAJAOUL", a destination rather than a description. Do not give it
     * meaning it does not have.
     */
    details: text("details"),

    /**
     * `IsApproved` is nullable in the source and NOT NULL here, as on
     * `purchase_requests`.
     *
     * DEFAULT DIFFERS FROM THE OTHER MODULES ON PURPOSE. `InsertInventoryDetails`
     * hard-codes `IsApproved = true`, so every inventory row in production was
     * created already approved and the Approve column has never gated anything.
     * The default here is false — the honest default for an approval flag — and
     * the API sets it explicitly on create. Flagged for sign-off: if the business
     * wants arrivals to post pre-approved, that is a decision to state, not a
     * constant buried in an insert.
     */
    isApproved: boolean("is_approved").notNull().default(false),

    /**
     * `IsDeleted` exists in the source AND IS NEVER OBSERVED.
     *
     * `DeleteInventoryDetails` sets `IsDeleted = true` and then calls
     * `Context.InventoryInwards.Remove(...)` on the same entity, so the row is
     * DELETED FROM THE TABLE and the flag write goes nowhere. The list filters
     * `IsDeleted == false` as though it were a soft delete, which is why nobody
     * has noticed. Deleting an inventory row in the old system is unrecoverable,
     * unlike every other module in it. Here the delete is a real soft delete.
     */
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("inventory_inward_site_id_idx").on(table.siteId),
    index("inventory_inward_item_id_idx").on(table.itemId),
    /** The dashboard's pending queue reads exactly this. */
    index("inventory_inward_is_approved_idx").on(table.isApproved),
  ],
);
