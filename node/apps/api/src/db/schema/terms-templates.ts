import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Terms and conditions people save under a name of their own, to load into a
 * purchase order (client, 22 Oct 2026). The three original templates stay in
 * code (`contracts/purchase-order-terms.ts`); these sit beside them.
 *
 * The HTML is sanitised on the way in, as an order's terms are, because it is
 * loaded into the order and printed from there.
 */
export const termsTemplates = pgTable(
  "terms_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    html: text("html").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("terms_templates_name_lower_key").on(sql`lower(${table.name})`)],
);
