import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import type { GridColumnPreference } from "@accountmanagement/contracts";

/**
 * Each person's own column layout for each grid: which columns they show, and in
 * what order.
 *
 * WHY THE SERVER AND NOT THE BROWSER. The obvious place is `localStorage`, and it
 * costs nothing — but it is per browser. Someone who sets up their supplier grid
 * at a desk and then opens the same screen on a phone gets the default layout
 * back, and clearing site data loses the lot. Nobody would report that as a bug;
 * they would just stop bothering to customise anything.
 *
 * NO PERMISSION GUARDS THIS. A row here is the caller's own preference about
 * their own screen — it carries no business data — so the only rule is that you
 * read and write your own. The repository enforces that by never taking a user
 * id from the request.
 *
 * `on delete cascade` is deliberate and is the one place in this schema where a
 * hard delete is right: a preference has no meaning without its user, nothing
 * references it, and leaving orphans behind would grow a table nobody ever reads.
 */
export const userGridPreferences = pgTable(
  "user_grid_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** The screen's own slug — "suppliers", "purchase-invoices". */
    gridKey: text("grid_key").notNull(),

    /**
     * The layout, in display order: `[{ id, visible }, ...]`.
     *
     * ONE COLUMN RATHER THAN TWO. Order and visibility are edited together and
     * are meaningless apart — a column in the order but absent from a separate
     * visible list would have no defined behaviour, and someone would have to
     * invent one at read time. `resolveGridColumns` in the contracts package
     * reconciles whatever is stored here against the grid as it exists today.
     *
     * `jsonb`, not `json`: it is compared on write and never needs to preserve
     * key order or whitespace.
     */
    columns: jsonb("columns").$type<GridColumnPreference[]>().notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One layout per person per grid. The composite key IS the uniqueness rule,
    // so an upsert can target it directly rather than reading first.
    primaryKey({ columns: [table.userId, table.gridKey] }),
  ],
);
