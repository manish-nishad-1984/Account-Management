import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  bulkApprovalResultSchema,
  type BulkApprovalResult,
} from "@accountmanagement/contracts";
import { apiRequest } from "../../lib/api-client";

/**
 * Bulk approve, for any resource that has an `/approvals` endpoint.
 *
 * One hook rather than one per module: the request and the cache invalidation
 * are identical for all five queues, and the only thing that varies is the
 * resource segment. A per-module copy is how the dashboard ends up with five
 * subtly different ideas of what approving does.
 */
export const useBulkApproval = (resource: string) => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ ids, isApproved }: { ids: string[]; isApproved: boolean }) =>
      apiRequest<BulkApprovalResult>(`/${resource}/approvals`, {
        method: "POST",
        body: { ids, isApproved },
        schema: bulkApprovalResultSchema,
      }),
    onSuccess: () => {
      // The queue AND the module's own list screen both read this key, and both
      // are now wrong: the approved rows have left the pending queue and their
      // Approved badge has changed on the list.
      client.invalidateQueries({ queryKey: [resource] });
    },
  });
};

/**
 * "3 approved", "1 approved", "nothing to approve".
 *
 * `updated` is what actually CHANGED, not how many boxes were ticked — the
 * statement excludes rows already in the target state. Reporting the tick count
 * instead would tell someone who select-alled a half-approved queue that it
 * approved more than it did.
 */
export const describeApproved = (result: BulkApprovalResult): string => {
  if (result.updated === 0) {
    return "Nothing changed — those rows were already approved.";
  }
  return `${result.updated} ${result.updated === 1 ? "row" : "rows"} approved.`;
};
