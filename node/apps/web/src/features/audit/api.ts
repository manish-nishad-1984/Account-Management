import { useQuery } from "@tanstack/react-query";
import { auditListResponseSchema, type AuditAction, type AuditEntity } from "@accountmanagement/contracts";
import { apiRequest } from "../../lib/api-client";

/**
 * One record's history, newest first; or, with `action` and no id, every record
 * that had that done to it (what was deleted). Fetched only while `enabled`.
 */
export const useAuditHistory = (
  entity: AuditEntity,
  entityId: string | null,
  { action, enabled = true }: { action?: AuditAction; enabled?: boolean } = {},
) =>
  useQuery({
    queryKey: ["audit", entity, entityId, action ?? null],
    enabled: enabled && (entityId !== null || action !== undefined),
    queryFn: ({ signal }) => {
      const search = new URLSearchParams({ entity });
      if (entityId) search.set("entityId", entityId);
      if (action) search.set("action", action);
      return apiRequest(`/audit?${search.toString()}`, { schema: auditListResponseSchema, signal });
    },
  });
