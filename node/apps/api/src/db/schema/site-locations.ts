import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sites } from "./users";

/**
 * Site locations — what the business now calls the screen that was Site Groups
 * (15 Sep 2026).
 *
 * THE SHAPE CHANGED, NOT JUST THE NAME. A site group was a name shared by many
 * sites, with addresses of its own. A site location belongs to ONE site: the
 * form picks the site first, then lists the places inside it by name — "Block A",
 * "Store yard" — and, separately, the addresses deliveries for that site can go
 * to. The business chose names and addresses as two independent lists rather
 * than an address per name.
 *
 * So there is no "location record" table: a site's locations screen is simply
 * the rows below that carry its id, and the list screen groups by site.
 *
 * WHAT HAPPENED TO THE 35 SITE GROUPS. Migration 0019 turns every (group, member
 * site) pair into a location of that site named after the group, and copies the
 * group's addresses to each member site. Documents that named a group now name
 * the location of the same name at their own site, in `site_location_id`. The
 * old tables and `site_group_id` columns are left in place and no longer
 * written — they are the record of what the import brought, and dropping them
 * would make the conversion impossible to check.
 */
export const siteLocations = pgTable(
  "site_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    name: text("name").notNull(),

    /**
     * Soft delete, because documents reference a location by id. Removing a name
     * from the form marks it deleted; an order that already names it keeps
     * showing the name it was raised with.
     */
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("site_locations_site_id_idx").on(table.siteId),
    /** One "Block A" per site, case-insensitively. Two sites may both have one. */
    uniqueIndex("site_locations_site_name_key")
      .on(table.siteId, sql`lower(${table.name})`)
      .where(sql`${table.isDeleted} = false`),
  ],
);

/**
 * The addresses entered on the Site Location screen, one list per site.
 *
 * SEPARATE FROM `site_addresses`, which the Site master edits — the business
 * asked for two lists, as the legacy app had Site addresses and Group addresses
 * in two panels. A document's shipping choice offers both together.
 *
 * No document references these rows: a document COPIES the address it was
 * raised with as text, so a save replaces the list outright.
 */
export const siteLocationAddresses = pgTable(
  "site_location_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    address: text("address").notNull(),
    lineNumber: integer("line_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("site_location_addresses_site_id_idx").on(table.siteId)],
);
