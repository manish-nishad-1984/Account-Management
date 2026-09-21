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
     * The address deliveries to this location go to — the other half of the PAIR
     * (business, 17 Sep 2026).
     *
     * NULLABLE, and `name` may be "" for the same reason: the rows migrated out
     * of `site_location_addresses` have an address and no name, because nothing
     * recorded which name went with which address. Either half may be blank while
     * someone is filling the other in. The unique index below exempts blank names
     * so that several unnamed pairs can sit on one site.
     */
    address: text("address"),

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
    /**
     * One "Block A" per site, case-insensitively. Two sites may both have one.
     *
     * BLANK NAMES ARE EXEMPT (`name <> ''`). A site can hold several pairs that
     * have an address and no name yet — BHAVNAGAR-RAJUBHAI arrived with eight —
     * and without the exemption the second one violates this index. Two REAL
     * locations sharing a name are still refused, which is the rule this is for.
     */
    uniqueIndex("site_locations_site_name_key")
      .on(table.siteId, sql`lower(${table.name})`)
      .where(sql`${table.isDeleted} = false AND ${table.name} <> ''`),
  ],
);

/**
 * SUPERSEDED by `siteLocations.address` on 17 Sep 2026, and read by nothing.
 *
 * The business asked for a location and its address to be one PAIR, so these
 * rows were copied into `site_locations` with a blank name (migration 0020) and
 * this table stopped being written. It is kept, populated, on purpose: it is the
 * only pre-pairing copy of addresses that people deliver material to, and a
 * dropped table is the one thing a rollback cannot undo.
 *
 * Drop it once the pairs on the Site Location screen have been named — on
 * purpose, in its own migration, not as a side effect of this one.
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
