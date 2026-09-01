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

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  companyId: uuid("company_id").references(() => companies.id),
  isActive: boolean("is_active").notNull().default(true),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
