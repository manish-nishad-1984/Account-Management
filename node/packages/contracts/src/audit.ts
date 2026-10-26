import { z } from "zod";

/**
 * THE AUDIT TRAIL (client, 20 Oct 2026): what happened to a purchase invoice, a
 * payment or a payout list - who, when, and each field's old and new value.
 */
// "site": a site deleted with everything in it (client, 26 Oct 2026).
export const AUDIT_ENTITIES = ["purchase-invoice", "payment", "payout-list", "site"] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export const AUDIT_ACTIONS = [
  "created",
  "imported",
  "updated",
  "approved",
  "unapproved",
  "confirmed",
  "reversed",
  "deleted",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** The record as people read it, field by field, in display order: `[["Supplier", "SHAH ENTERPRISE"], ...]`. */
export const auditFactsSchema = z.array(z.tuple([z.string(), z.string()]));
export type AuditFacts = z.infer<typeof auditFactsSchema>;

/** One field that changed; `from` is null for a field that was not there before, `to` for one that went. */
export const auditChangeSchema = z.object({
  field: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type AuditChange = z.infer<typeof auditChangeSchema>;

export const auditEventSchema = z.object({
  id: z.string(),
  entity: z.enum(AUDIT_ENTITIES),
  entityId: z.string(),
  action: z.enum(AUDIT_ACTIONS),
  label: z.string(),
  facts: auditFactsSchema,
  changes: z.array(auditChangeSchema).nullable(),
  actorName: z.string().nullable(),
  at: z.string(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const auditListResponseSchema = z.object({
  rows: z.array(auditEventSchema),
});
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;

/** One record's history, newest first; or, with `action=deleted` and no id, what was deleted. */
export const auditQuerySchema = z.object({
  entity: z.enum(AUDIT_ENTITIES),
  entityId: z.string().uuid().optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/**
 * Old and new, field by field: every field whose text differs, in the order the
 * record lists them, then any that only the old record had.
 */
export function diffFacts(before: AuditFacts, after: AuditFacts): AuditChange[] {
  const old = new Map(before);
  const now = new Map(after);
  const changes: AuditChange[] = [];
  for (const [field, value] of after) {
    const was = old.get(field);
    if (was === undefined) changes.push({ field, from: null, to: value });
    else if (was !== value) changes.push({ field, from: was, to: value });
  }
  for (const [field, value] of before) {
    if (!now.has(field)) changes.push({ field, from: value, to: null });
  }
  return changes;
}
