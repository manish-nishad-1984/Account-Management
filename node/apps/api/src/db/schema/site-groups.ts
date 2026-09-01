import { sql } from "drizzle-orm";
import { boolean, index, pgTable, primaryKey, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { sites } from "./users";

/**
 * Site groups — a named set of sites, used to scope purchase orders and supplier
 * invoices.
 *
 * The source table `GroupMaster` is one table doing three jobs, and it is the
 * clearest case in the schema for normalising rather than porting as-is:
 *
 *   Id int IDENTITY | GroupId uuid | GroupName | SiteId | GroupAddress | CreatedOn
 *
 * `SiteMasterRepo.cs:524-555` writes the CROSS PRODUCT — one row for every
 * (site x address) pair — repeating GroupName and GroupId in each. A group with
 * 4 sites and 3 addresses is 12 rows. Every read then has to `GroupBy` those rows
 * back into a group (`SiteMasterRepo.cs:574-587`), and `Id` — the actual primary
 * key — is meaningless, so the app addresses rows by `GroupId` instead
 * (assessment 04: "Dual key").
 *
 * Here that becomes three tables, which is what the data always was:
 *
 *   site_groups            one row per group, GroupId as the real primary key
 *   site_group_sites       the sites in the group
 *   site_group_addresses   the addresses of the group
 *
 * The ETL collapses the cross product with a DISTINCT on each side. That is
 * lossless in both directions: the source carries no information that only the
 * pairing expresses.
 */

export const siteGroups = pgTable(
  "site_groups",
  {
    /** The source's `GroupId`, promoted from a non-key column to the key. */
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),

    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    /**
     * The name must be unique, and case-insensitively so.
     *
     * This is not tidiness. `PurchaseOrder.SiteGroup` and
     * `SupplierInvoice.SiteGroup` are `nvarchar` columns holding the group's NAME,
     * matched by string equality (assessment 04 §"string equality") — so the name
     * is a de facto foreign key. Two groups differing only in case would make
     * those joins ambiguous, and renaming a group silently detaches its documents.
     *
     * The source only checks `Any(x => x.GroupName == name)` in application code,
     * with no constraint behind it, so a race or a direct write defeats it.
     */
    uniqueIndex("site_groups_name_lower_key")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.isDeleted} = false`),
  ],
);

export const siteGroupSites = pgTable(
  "site_group_sites",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => siteGroups.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.siteId] }),
    index("site_group_sites_site_id_idx").on(table.siteId),
  ],
);

export const siteGroupAddresses = pgTable(
  "site_group_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => siteGroups.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
  },
  (table) => [index("site_group_addresses_group_id_idx").on(table.groupId)],
);
