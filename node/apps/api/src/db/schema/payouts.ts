import { sql } from "drizzle-orm";
import { boolean, check, index, integer, numeric, pgTable, date, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { suppliers } from "./masters";

/**
 * Payout lists (client request, 5 Oct 2026): the plan of which suppliers to pay
 * and how much of each, kept so it can be asked for again and sent on WhatsApp.
 *
 * A PLAN, NOT A PAYMENT. Nothing here references `payments` or writes to it;
 * the payment is still keyed on the Payments screen. Keeping the two apart is
 * the point — a list that quietly became a payment would be a way to pay a
 * supplier without the payment ever being entered.
 */
export const payoutLists = pgTable(
  "payout_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The day the list is for, not the day it was typed. */
    listDate: date("list_date").notNull(),
    title: text("title"),
    /** What the owner said he can spend. Informational; the lines are not capped by it. */
    budget: numeric("budget", { precision: 18, scale: 2 }),
    note: text("note"),
    /**
     * `draft` is a plan and touches nothing. `confirmed` means the owner has paid
     * it and a user with the right has recorded that: its payments exist, its
     * bills are settled, and it is locked. Reversing a confirmation returns it to
     * `draft` and removes those payments (7 Oct 2026).
     */
    status: text("status").notNull().default("draft"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: uuid("confirmed_by"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    // The list screen is "newest first" and nothing else.
    index("payout_lists_list_date_idx")
      .on(sql`${table.listDate} desc`)
      .where(sql`${table.isDeleted} = false`),
  ],
);

/**
 * One line per party. Replaced as a whole on every save, like agency contacts:
 * nothing references a line, so ids need not survive an edit.
 */
export const payoutListLines = pgTable(
  "payout_list_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payoutListId: uuid("payout_list_id")
      .notNull()
      .references(() => payoutLists.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => suppliers.id),
    /** What was chosen to pay. May be less than the outstanding (a part payment); never zero. */
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    /** What the party was owed when the line was saved, so an old list still reads as it did. */
    outstandingAtSave: numeric("outstanding_at_save", { precision: 18, scale: 2 }),
    /** Paid ABOVE the bills ticked (an advance), set when the list is confirmed. */
    extraPaid: numeric("extra_paid", { precision: 18, scale: 2 }),
    lineNumber: integer("line_number").notNull(),
  },
  (table) => [
    index("payout_list_lines_payout_list_id_idx").on(table.payoutListId),
    unique("payout_list_lines_list_party_key").on(table.payoutListId, table.partyId),
    check("payout_list_lines_amount_positive", sql`${table.amount} > 0`),
  ],
);

/**
 * The bills a line was built from (client request, 6 Oct 2026): the owner ticks
 * the invoices he is paying, not only the party. A line with bills has an amount
 * equal to their sum.
 *
 * SNAPSHOT COLUMNS, NO FOREIGN KEY. The bill number, date and site are copied in
 * at save, so an old list reads as it did on the day and a document that is later
 * cancelled does not make the list unreadable. `document_id` is only the key that
 * lets the form tick the same bill again on an edit.
 */
export const payoutListInvoices = pgTable(
  "payout_list_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payoutLineId: uuid("payout_line_id")
      .notNull()
      .references(() => payoutListLines.id, { onDelete: "cascade" }),
    /** `invoice` or `opening_balance`, as the Pending Outstanding report names them. */
    source: text("source").notNull(),
    documentId: text("document_id").notNull(),
    displayNo: text("display_no").notNull(),
    documentDate: date("document_date"),
    siteName: text("site_name"),
    /** What is to be paid of this bill. May be less than what is pending (a part payment). */
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    /** What was ACTUALLY paid of this bill, set when the list is confirmed; may differ from `amount`. */
    paidAmount: numeric("paid_amount", { precision: 18, scale: 2 }),
    pendingAtSave: numeric("pending_at_save", { precision: 18, scale: 2 }),
    lineNumber: integer("line_number").notNull(),
  },
  (table) => [
    index("payout_list_invoices_line_idx").on(table.payoutLineId),
    unique("payout_list_invoices_line_doc_key").on(table.payoutLineId, table.source, table.documentId),
    check("payout_list_invoices_amount_positive", sql`${table.amount} > 0`),
  ],
);
