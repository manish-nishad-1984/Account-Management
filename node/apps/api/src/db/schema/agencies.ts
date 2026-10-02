import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { cities, states } from "./geography";

/**
 * Agencies — the contractors who do work on a site: the plaster gang, the
 * shuttering contractor, the electrician. Asked for on 1 Oct 2026, from a
 * mockup of an "Agency Master" screen. NEW, with no counterpart in the legacy
 * application: nothing is ported and nothing is imported.
 *
 * NOT A ROW IN `suppliers`. That table already holds both sides of the trade —
 * sales invoices bill a "customer" out of it — and an agency is a third kind of
 * party: it is issued material and returns it (the inventory plan's later
 * phases), it is not invoiced for goods.
 *
 * GEOGRAPHY IS A REAL FOREIGN KEY HERE, unlike on the older address tables.
 * Those carry bare integers because the dev seed once invented ids no lookup
 * row backed (see geography.ts); a new table has no history to carry, and the
 * standing instruction is no orphan entries.
 */

/**
 * The trades an agency can be booked for — Plaster, Shuttering, Plumbing.
 *
 * A master of its own rather than free text on the agency, because the list
 * screen filters by it: "every agency that does Waterproofing" only works when
 * two agencies' Waterproofing is the same row. Migration 0021 seeds the trades
 * named in the mockup; more are added from the agency form itself.
 */
export const workTypes = pgTable(
  "work_types",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    name: text("name").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // "Tiles" and "tiles " are one trade; the form refuses the second.
    uniqueIndex("work_types_name_lower_key").on(sql`lower(${table.name})`),
  ],
);

export const agencies = pgTable(
  "agencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    address: text("address"),
    stateId: integer("state_id")
      .notNull()
      .references(() => states.id),
    cityId: integer("city_id")
      .notNull()
      .references(() => cities.id),
    gstNo: text("gst_no"),
    panNo: text("pan_no"),
    bankName: text("bank_name"),
    accountNo: text("account_no"),
    ifscCode: text("ifsc_code"),
    accountHolderName: text("account_holder_name"),
    /**
     * Active / Inactive, as the mockup's status column and tiles show. An
     * inactive agency stays on the list, marked; deleting is a separate act.
     */
    isActive: boolean("is_active").notNull().default(true),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("agencies_city_id_idx").on(table.cityId),
    // One live agency per name, ignoring case — the same rule items follow.
    uniqueIndex("agencies_name_lower_key")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.isDeleted} = false`),
  ],
);

export const agencyWorkTypes = pgTable(
  "agency_work_types",
  {
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    workTypeId: integer("work_type_id")
      .notNull()
      .references(() => workTypes.id),
  },
  (table) => [
    primaryKey({ columns: [table.agencyId, table.workTypeId] }),
    index("agency_work_types_work_type_id_idx").on(table.workTypeId),
  ],
);

/**
 * The people to call. Line 1 is the PRIMARY contact — the mockup's "Primary
 * Contact" block, and what the list shows; the rest are its "Additional
 * Contacts". One table, not a primary pair of columns plus a list, so the two
 * can never disagree and promoting a contact is reordering, not copying.
 *
 * Replaced as a whole on every save, like site contacts: nothing references a
 * contact, so ids need not survive.
 */
export const agencyContacts = pgTable(
  "agency_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    name: text("name").notNull(),
    designation: text("designation"),
    mobile: text("mobile"),
    email: text("email"),
    lineNumber: integer("line_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agency_contacts_agency_id_idx").on(table.agencyId)],
);
