import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies, sites } from "./users";
import { payoutLists } from "./payouts";

/**
 * The Employee Master (client request, 23 Oct 2026): who is on the payroll, for
 * which company and site, and what a month pays. See `contracts/employees.ts`.
 */
export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    mobile: text("mobile"),
    address: text("address"),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    siteId: uuid("site_id").references(() => sites.id),
    joinDate: date("join_date"),
    bankName: text("bank_name"),
    accountHolder: text("account_holder"),
    accountNo: text("account_no"),
    ifscCode: text("ifsc_code"),
    basicSalary: numeric("basic_salary", { precision: 18, scale: 2 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    note: text("note"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("employees_company_idx").on(table.companyId),
    check("employees_basic_not_negative", sql`${table.basicSalary} >= 0`),
  ],
);

/** The fixed additions and deductions of a month. Replaced whole on every save. */
export const employeeSalaryItems = pgTable(
  "employee_salary_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** `addition` or `deduction`. */
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    lineNumber: integer("line_number").notNull(),
  },
  (table) => [
    index("employee_salary_items_employee_idx").on(table.employeeId),
    check("employee_salary_items_amount_positive", sql`${table.amount} > 0`),
    check("employee_salary_items_kind", sql`${table.kind} in ('addition', 'deduction')`),
  ],
);

/**
 * A month's salary on a payout list. Replaced whole with the list's lines on
 * every save. `paid_amount` is set when the list is confirmed.
 */
export const payoutListSalaries = pgTable(
  "payout_list_salaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payoutListId: uuid("payout_list_id")
      .notNull()
      .references(() => payoutLists.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    /** The first day of the month the salary is for. */
    salaryMonth: date("salary_month").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    note: text("note"),
    paidAmount: numeric("paid_amount", { precision: 18, scale: 2 }),
    lineNumber: integer("line_number").notNull(),
  },
  (table) => [
    index("payout_list_salaries_list_idx").on(table.payoutListId),
    unique("payout_list_salaries_list_employee_month_key").on(table.payoutListId, table.employeeId, table.salaryMonth),
    check("payout_list_salaries_amount_positive", sql`${table.amount} > 0`),
  ],
);

/**
 * A salary PAID: made when a payout list is confirmed, removed (soft) when it is
 * reversed. The company and site are the employee's on the day, so a later move
 * does not shift an old salary to another project in the Balance Sheet. One live
 * payment per employee and month, so a month cannot be paid twice.
 */
export const salaryPayments = pgTable(
  "salary_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    salaryMonth: date("salary_month").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    siteId: uuid("site_id").references(() => sites.id),
    paymentDate: timestamp("payment_date", { withTimezone: true }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    method: text("method"),
    referenceNo: text("reference_no"),
    sourcePayoutListId: uuid("source_payout_list_id").references(() => payoutLists.id),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("salary_payments_employee_month_key")
      .on(table.employeeId, table.salaryMonth)
      .where(sql`${table.isDeleted} = false`),
    index("salary_payments_site_idx").on(table.siteId),
    check("salary_payments_amount_positive", sql`${table.amount} > 0`),
  ],
);
