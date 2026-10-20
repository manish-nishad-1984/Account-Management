import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AuditChange, AuditFacts } from "@accountmanagement/contracts";

/**
 * THE AUDIT TRAIL (client, 20 Oct 2026): who did what to a purchase invoice, a
 * payment or a payout list, when, and WHAT CHANGED - the old value and the new,
 * field by field. Until now only "created by" and "last changed by" survived, and
 * a deleted purchase invoice left nothing at all.
 *
 * One row per event, written in the same transaction as the change it records,
 * so a change that rolls back leaves no event and an event never describes a
 * change that did not happen.
 *
 * `facts` is the record as people read it - "Supplier: SHAH ENTERPRISE", not an
 * id - taken AFTER the event (BEFORE it, for a delete). An edit also keeps
 * `changes`, the fields whose text differs. Names are frozen at the time: renaming
 * a supplier later does not rewrite what the history says it was.
 *
 * NO FOREIGN KEY on `entity_id`: the point is to outlive the record. Nothing here
 * is ever updated or deleted by the application.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `purchase-invoice`, `payment`, `payout-list`. */
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    /** `created`, `updated`, `deleted`, `approved`, `unapproved`, `confirmed`, `reversed`, `imported`. */
    action: text("action").notNull(),
    /** What the record is called, at the time: "Bill BB/154 · SHAH ENTERPRISE". */
    label: text("label").notNull(),
    facts: jsonb("facts").$type<AuditFacts>().notNull(),
    changes: jsonb("changes").$type<AuditChange[]>(),
    actorId: uuid("actor_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_entity_idx").on(table.entity, table.entityId, table.at),
    index("audit_events_entity_action_idx").on(table.entity, table.action, table.at),
  ],
);
