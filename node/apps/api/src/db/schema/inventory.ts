import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sites } from "./users";
import { items, units } from "./masters";
import { agencies, agencyContacts } from "./agencies";

/**
 * THE INVENTORY ITEM MASTER (client, 26 Oct 2026): the things kept in stock at
 * a site and lent out by the day: tools, shuttering, a drill. Not the Items
 * master, which is what is BOUGHT; the two stocks are kept apart (client:
 * "purchase item stock is different and new arrival item also different").
 * An item comes into being from New Arrival, by name, with its photo.
 */
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("Nos"),
    /** The item's photo, in document storage; null for none. */
    photoKey: text("photo_key"),
    note: text("note"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("inventory_items_name_key")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.isDeleted} = false`),
  ],
);

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
    itemId: uuid("item_id").references(() => items.id),

    /**
     * Since 26 Oct 2026 an arrival is of an INVENTORY item (above), and `item_id`
     * and `unit_id` are null on it. The rows from before keep their Items-master
     * item. One of the two is always there.
     */
    inventoryItemId: uuid("inventory_item_id").references(() => inventoryItems.id),
    /** The arrival's photo, in document storage. */
    photoKey: text("photo_key"),
    /**
     * ONE TAG NAME AND ONE PHOTO FOR EACH PIECE that arrived (client, 30 Oct
     * 2026): a quantity of 3 has three, in order. Empty for a quantity that is
     * not whole, and on arrivals from before.
     */
    pieces: jsonb("pieces").$type<{ tag: string; photoKey: string | null }[]>().notNull().default([]),

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

    unitId: integer("unit_id").references(() => units.id),

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
    index("inventory_inward_inventory_item_idx").on(table.inventoryItemId),
    check("inventory_inward_item_present", sql`${table.itemId} is not null or ${table.inventoryItemId} is not null`),
  ],
);

/**
 * THE PEOPLE OF AN AGENCY WHO TAKE THINGS AWAY (client, 26 Oct 2026): picked or
 * added when an item is issued, with a photo and a mobile, and kept for the
 * next time.
 */
export const agencyPersons = pgTable(
  "agency_persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    name: text("name").notNull(),
    mobile: text("mobile"),
    photoKey: text("photo_key"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agency_persons_agency_idx").on(table.agencyId)],
);

/**
 * AN ITEM GIVEN OUT (client, 26 Oct 2026): from the inventory item stock or the
 * purchase item stock of a site, to a person of an agency. RETURNABLE ones are
 * expected back the same evening and wait on the dashboard until received; a
 * non-returnable one leaves the stock for good.
 *
 * What comes back goes back into the stock it left. `returned_quantity` below
 * `quantity` means some did not come back; that part stays out of stock.
 */
export const inventoryIssues = pgTable(
  "inventory_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").references(() => sites.id),
    /** `inventory` or `purchase`: which stock it came out of. */
    source: text("source").notNull(),
    inventoryItemId: uuid("inventory_item_id").references(() => inventoryItems.id),
    itemId: uuid("item_id").references(() => items.id),
    /** The item's name and unit when it was issued. */
    itemName: text("item_name").notNull(),
    unitName: text("unit_name"),
    quantity: numeric("quantity", { precision: 18, scale: 2 }).notNull(),
    returnable: boolean("returnable").notNull(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    /** The agency's contact picked (its main number). */
    agencyContactId: uuid("agency_contact_id").references(() => agencyContacts.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => agencyPersons.id),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
    /** The tagged pieces handed over, when chosen one by one (client, 2 Nov 2026). */
    pieces: jsonb("pieces").$type<{ arrivalId: string; n: number; tag: string }[]>().notNull().default([]),
    returnedQuantity: numeric("returned_quantity", { precision: 18, scale: 2 }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnedBy: uuid("returned_by"),
    returnNote: text("return_note"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("inventory_issues_site_idx").on(table.siteId),
    index("inventory_issues_inventory_item_idx").on(table.inventoryItemId),
    index("inventory_issues_item_idx").on(table.itemId),
    /** The dashboard's "to receive back" list reads exactly this. */
    index("inventory_issues_out_idx")
      .on(table.issuedAt)
      .where(sql`${table.isDeleted} = false and ${table.returnable} = true and ${table.returnedAt} is null`),
    check("inventory_issues_source", sql`${table.source} in ('inventory', 'purchase')`),
    check(
      "inventory_issues_item_of_source",
      sql`(${table.source} = 'inventory' and ${table.inventoryItemId} is not null) or (${table.source} = 'purchase' and ${table.itemId} is not null)`,
    ),
    check("inventory_issues_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "inventory_issues_returned_within",
      sql`${table.returnedQuantity} is null or (${table.returnedQuantity} >= 0 and ${table.returnedQuantity} <= ${table.quantity})`,
    ),
  ],
);
