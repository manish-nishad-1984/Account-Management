import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies, sites } from "./users";

/**
 * The Client Master (client request, 9 Oct 2026): who PAYS US for a project.
 * Not a supplier - `suppliers` is who we pay (and, for old sales invoices, who
 * owed us). A separate table so that neither list is polluted by the other.
 */
export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  mobile: text("mobile"),
  email: text("email"),
  gstNo: text("gst_no"),
  panNo: text("pan_no"),
  address: text("address"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

/** The projects (sites) a client pays for. */
export const clientSites = pgTable(
  "client_sites",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.clientId, table.siteId] })],
);

/**
 * Income: money a client has paid for a project, received in one of our companies.
 *
 * `amount` is the main figure; `additional_total` and `deduction_total` are the
 * sums of the lines in `client_income_adjustments`, and `total` is
 * amount + additional - deduction. All four are stored (worked out by the server
 * on every save) so the balance sheet reads one column and never re-adds lines.
 *
 * Site and company are both here and independent: the application has never tied
 * a company to a site.
 */
export const clientIncomes = pgTable(
  "client_incomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incomeDate: date("income_date").notNull(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    additionalTotal: numeric("additional_total", { precision: 18, scale: 2 }).notNull().default("0"),
    deductionTotal: numeric("deduction_total", { precision: 18, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 18, scale: 2 }).notNull(),
    method: text("method"),
    referenceNo: text("reference_no"),
    note: text("note"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("client_incomes_site_idx").on(table.siteId),
    index("client_incomes_date_idx")
      .on(sql`${table.incomeDate} desc`)
      .where(sql`${table.isDeleted} = false`),
    check("client_incomes_amount_positive", sql`${table.amount} > 0`),
  ],
);

/** The additions and deductions under an income. Replaced as a whole on every save. */
export const clientIncomeAdjustments = pgTable(
  "client_income_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incomeId: uuid("income_id")
      .notNull()
      .references(() => clientIncomes.id, { onDelete: "cascade" }),
    /** `addition` adds to the total, `deduction` takes from it. */
    kind: text("kind").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    remark: text("remark"),
    lineNumber: integer("line_number").notNull(),
  },
  (table) => [
    index("client_income_adjustments_income_idx").on(table.incomeId),
    check("client_income_adjustments_kind", sql`${table.kind} in ('addition', 'deduction')`),
    check("client_income_adjustments_amount_positive", sql`${table.amount} > 0`),
  ],
);
