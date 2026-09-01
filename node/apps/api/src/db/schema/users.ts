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

/**
 * Users, sites, companies and permissions.
 *
 * Differences from the SQL Server schema, all deliberate:
 *
 *  - `User.SiteId` and `User.CompanyId` are CSV STRINGS in SQL Server, parsed at
 *    every call site. Here they are junction tables with real foreign keys
 *    (assessment 09 §7).
 *  - `User.Password` held plaintext. Here the column holds an argon2id hash, with
 *    `password_is_legacy` marking rows the ETL copied across unhashed so progress
 *    is reportable: `select count(*) from users where password_is_legacy`.
 *  - Foreign keys actually exist. SQL Server has ~62 reference columns with none.
 *  - Unique constraints exist on user_name and on (user_id, form_id).
 *
 * NOT modelled, on purpose: `UserRole` and `RolewiseFormPermission`. In the source
 * schema `User.RoleId` is `Guid?` while `UserRole.RoleId` and
 * `RolewiseFormPermission.RoleId` are `int` — they cannot join, and neither table
 * is referenced anywhere in the repository layer. Role-based permissions do not
 * function today; only user-wise permissions do. Porting the dead tables would
 * carry the defect forward.
 */

/**
 * Companies. 20 columns in SQL Server (assessment 04 §`Company`), reproduced here.
 *
 * Deliberate departures:
 *  - `IsDelete` is spelled `is_deleted`, as on every other table. The source is
 *    inconsistent — `Company` and `SupplierMaster` say `IsDelete`, the rest say
 *    `IsDeleted` — and one spelling has to win.
 *  - `Iffccode` is `ifsc_code`. The source name is a typo for the Indian bank
 *    routing code IFSC; nothing reads it by name outside the repository layer.
 *  - `city_id`, `state_id` and `country_id` are integers with NO foreign key yet.
 *    The source has 3 orphan geography references on this table and the lookup
 *    tables have not been extracted, so a real FK would refuse rows the ETL must
 *    still carry. They become FKs once the census in Migration-Assessment/tools/
 *    has run and the orphans have an agreed disposition.
 *
 * There is no `is_active`: the source table has no such column. A company is
 * either present or soft-deleted.
 */
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),

    /** Prefix stamped on invoice numbers for this company (`InvoicePef`). */
    invoicePrefix: text("invoice_prefix"),
    gstNo: text("gst_no"),
    panNo: text("pan_no"),

    address: text("address"),
    area: text("area"),
    cityId: integer("city_id"),
    stateId: integer("state_id"),
    countryId: integer("country_id"),
    pincode: text("pincode"),

    bankName: text("bank_name"),
    bankBranch: text("bank_branch"),
    accountNo: text("account_no"),
    ifscCode: text("ifsc_code"),

    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    // GST numbers identify a legal entity; two companies cannot share one. Not
    // enforced in SQL Server. Partial, because the column is nullable and the
    // source holds blanks.
    uniqueIndex("companies_gst_no_key")
      .on(sql`upper(${table.gstNo})`)
      .where(sql`${table.gstNo} is not null and ${table.isDeleted} = false`),
  ],
);

/**
 * Sites. 22 columns in SQL Server, with a billing address and a shipping address
 * held as two parallel column sets — reproduced rather than normalised, because
 * `SiteAddress` already exists for additional shipping addresses and collapsing
 * both into one structure is a business decision, not a mechanical one.
 *
 * Deliberate departures:
 *  - `ContectPersonName` / `ContectPersonPhoneNo` are spelled correctly here.
 *    Both are misspellings in the source (assessment 04 §`Site`).
 *  - Geography stays integer-without-FK for now: this table alone carries 6
 *    orphan geography references, the largest single block of them.
 *
 * `company_id` is NOT in the source schema. There is no Company↔Site relationship
 * in SQL Server at all — the two are associated only indirectly, through the CSV
 * `User.CompanyId`/`User.SiteId` columns and through `SalesInvoice`. It is kept
 * because the seed and the user↔site fixtures already use it, but nothing derives
 * it from production data, so no screen displays it. Confirm with the business
 * before treating it as meaningful.
 */
export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    companyId: uuid("company_id").references(() => companies.id),

    isActive: boolean("is_active").notNull().default(true),

    contactPersonName: text("contact_person_name"),
    contactPersonPhoneNo: text("contact_person_phone_no"),

    address: text("address"),
    area: text("area"),
    cityId: integer("city_id"),
    stateId: integer("state_id"),
    countryId: integer("country_id"),
    pincode: text("pincode"),

    shippingAddress: text("shipping_address"),
    shippingArea: text("shipping_area"),
    shippingCityId: integer("shipping_city_id"),
    shippingStateId: integer("shipping_state_id"),
    shippingCountryId: integer("shipping_country_id"),
    shippingPincode: text("shipping_pincode"),

    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [index("sites_is_active_idx").on(table.isActive)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phoneNo: text("phone_no").notNull(),
    userName: text("user_name").notNull(),

    /** argon2id hash, or a legacy plaintext value when passwordIsLegacy is true. */
    password: text("password").notNull(),
    passwordIsLegacy: boolean("password_is_legacy").notNull().default(false),
    passwordMigratedAt: timestamp("password_migrated_at", { withTimezone: true }),

    isActive: boolean("is_active").notNull().default(true),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    // Login matches case-insensitively, so uniqueness must too — otherwise
    // 'Manish' and 'manish' become two accounts that both answer one login.
    uniqueIndex("users_user_name_lower_key").on(sql`lower(${table.userName})`),
    index("users_is_active_idx").on(table.isActive),
  ],
);

export const forms = pgTable("forms", {
  id: integer("id").primaryKey(),
  formGroup: text("form_group"),
  formName: text("form_name").notNull(),
  controller: text("controller"),
  action: text("action"),
  orderId: integer("order_id"),
  isActive: boolean("is_active").notNull().default(true),
});

export const userFormPermissions = pgTable(
  "user_form_permissions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    formId: integer("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    isViewAllow: boolean("is_view_allow").notNull().default(false),
    isAddAllow: boolean("is_add_allow").notNull().default(false),
    isEditAllow: boolean("is_edit_allow").notNull().default(false),
    isDeleteAllow: boolean("is_delete_allow").notNull().default(false),
    isApproved: boolean("is_approved").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.formId] })],
);

export const userSites = pgTable(
  "user_sites",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.siteId] })],
);

export const userCompanies = pgTable(
  "user_companies",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.companyId] })],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    // The token itself is never stored, only its SHA-256.
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("refresh_tokens_user_id_idx").on(table.userId)],
);
