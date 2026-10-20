import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import type { AuditEvent, AuditQuery } from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { auditEvents, users } from "../../db/schema";
import { BaseRepository } from "../../common/base.repository";

/** Reads the audit trail; it is written by each module, in its own transaction. */
@Injectable()
export class AuditRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /** Newest first: one record's history, or every event of one action (what was deleted). */
  async list(query: AuditQuery): Promise<AuditEvent[]> {
    const rows = await this.db
      .select({
        id: auditEvents.id,
        entity: auditEvents.entity,
        entityId: auditEvents.entityId,
        action: auditEvents.action,
        label: auditEvents.label,
        facts: auditEvents.facts,
        changes: auditEvents.changes,
        actorName: users.userName,
        at: auditEvents.at,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(
        and(
          eq(auditEvents.entity, query.entity),
          query.entityId ? eq(auditEvents.entityId, query.entityId) : undefined,
          query.action ? eq(auditEvents.action, query.action) : undefined,
        ),
      )
      .orderBy(desc(auditEvents.at), desc(auditEvents.id))
      .limit(query.limit);

    return rows.map((row) => ({
      ...row,
      entity: row.entity as AuditEvent["entity"],
      action: row.action as AuditEvent["action"],
      at: row.at instanceof Date ? row.at.toISOString() : String(row.at),
    }));
  }
}
