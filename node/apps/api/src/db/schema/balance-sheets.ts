import { sql } from "drizzle-orm";
import { boolean, date, index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies, sites } from "./users";

/**
 * Saved Balance Sheets (client request, 14 Oct 2026). A sheet is the site-wise
 * Balance Sheet report worked out for a company, a range of income dates and a
 * range of invoice dates, and KEPT: its rows are stored as they were worked
 * out, so an old sheet still reads as it did when more invoices have since been
 * entered. Editing a sheet works it out again.
 */
export const balanceSheets = pgTable(
  "balance_sheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title"),
    /** Null means every company. */
    companyId: uuid("company_id").references(() => companies.id),
    /** Null means every site. */
    siteId: uuid("site_id").references(() => sites.id),
    /** The income entries counted: by their own date. Null ends are open. */
    incomeFrom: date("income_from"),
    incomeTo: date("income_to"),
    /** The bills and payments counted: by their own date. Null ends are open. */
    invoiceFrom: date("invoice_from"),
    invoiceTo: date("invoice_to"),
    note: text("note"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("balance_sheets_created_at_idx")
      .on(sql`${table.createdAt} desc`)
      .where(sql`${table.isDeleted} = false`),
  ],
);

/** One row per project, as worked out when the sheet was saved. Replaced whole on an edit. */
export const balanceSheetRows = pgTable(
  "balance_sheet_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    balanceSheetId: uuid("balance_sheet_id")
      .notNull()
      .references(() => balanceSheets.id),
    /** Null for money with no project. The name is kept so a renamed site does not rewrite an old sheet. */
    siteId: uuid("site_id").references(() => sites.id),
    siteName: text("site_name").notNull(),
    income: numeric("income", { precision: 18, scale: 2 }).notNull(),
    billed: numeric("billed", { precision: 18, scale: 2 }).notNull(),
    paid: numeric("paid", { precision: 18, scale: 2 }).notNull(),
    lineNumber: integer("line_number").notNull(),
  },
  (table) => [index("balance_sheet_rows_sheet_id_idx").on(table.balanceSheetId)],
);
