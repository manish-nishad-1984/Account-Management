import { diffFacts, type AuditAction, type AuditEntity, type AuditFacts } from "@accountmanagement/contracts";
import type { Database } from "../db/database";
import { auditEvents } from "../db/schema";

/**
 * Writes the audit trail (client, 20 Oct 2026). Each module says how its record
 * reads - a label and its facts - and calls `recordAudit` inside the transaction
 * that makes the change.
 */

/** A record as people read it: what it is called, and its fields in order. */
export interface AuditView {
  label: string;
  facts: AuditFacts;
}

/**
 * One event. An edit is written only when some field reads differently, so
 * saving a form unchanged leaves no noise; every other action is always written.
 * For a delete, `view` is the record as it was.
 */
export async function recordAudit(
  db: Database,
  event: {
    entity: AuditEntity;
    entityId: string;
    action: AuditAction;
    actorId: string | null | undefined;
    view: AuditView;
    before?: AuditView | null;
  },
): Promise<void> {
  const changes = event.before ? diffFacts(event.before.facts, event.view.facts) : null;
  if (event.action === "updated" && changes !== null && changes.length === 0) return;
  await db.insert(auditEvents).values({
    entity: event.entity,
    entityId: event.entityId,
    action: event.action,
    label: event.view.label,
    facts: event.view.facts,
    changes,
    actorId: event.actorId || null,
  });
}

/** A date as `dd-mm-yyyy`, the way every screen in this system writes it. */
export const auditDate = (value: Date | string | null | undefined): string => {
  if (!value) return "";
  const iso = value instanceof Date ? value.toISOString() : String(value);
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
};

/** A stored figure as text, `""` for none. */
export const auditText = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim();

export const auditYesNo = (value: boolean | null | undefined): string => (value ? "Yes" : "No");
