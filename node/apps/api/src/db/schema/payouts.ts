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
    lineNumber: integer("line_number").notNull(),
  },
  (table) => [
    index("payout_list_lines_payout_list_id_idx").on(table.payoutListId),
    unique("payout_list_lines_list_party_key").on(table.payoutListId, table.partyId),
    check("payout_list_lines_amount_positive", sql`${table.amount} > 0`),
  ],
);
