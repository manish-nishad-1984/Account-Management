import { z } from "zod";
import { uuidId } from "./fields";

/**
 * Approval, shared by every module that has an Approve column.
 *
 * These schemas lived in `purchase-requests.ts` while purchase requests were
 * the only screen with a queue. The dashboard is six queues over five different
 * tables, so they belong here — one shape for approving, one for approving many,
 * one for the result. A per-module copy is how "approve" ends up meaning a
 * slightly different thing on each screen.
 */

/**
 * Approve or unapprove, STATED rather than toggled.
 *
 * The source's approval methods — `PurchaseRequestIsApproved`,
 * `ApproveInventoryDetails` and their siblings — read the current value and
 * write the opposite. Two approvers clicking at once leave the row wherever
 * ordering puts it, and the API cannot express "approve this" at all, only
 * "flip it". Every approval endpoint here takes the value it wants.
 */
export const setApprovalSchema = z.object({ isApproved: z.boolean() });
export type SetApproval = z.infer<typeof setApprovalSchema>;

/**
 * Bulk approval from a dashboard queue.
 *
 * Capped at 200 ids. The dashboard's select-all covers one page, so this is far
 * above any real click — it is here so that a hand-built request cannot turn one
 * statement into an unbounded `IN` list.
 */
export const bulkApprovalSchema = z.object({
  ids: z.array(uuidId).min(1, "Select at least one row").max(200),
  isApproved: z.boolean(),
});
export type BulkApproval = z.infer<typeof bulkApprovalSchema>;

export const bulkApprovalResultSchema = z.object({
  /**
   * How many rows actually changed.
   *
   * Ids already in the target state count 0, which is what makes a select-all
   * spanning already-approved rows safe: the statement's WHERE excludes them
   * rather than flipping them off, and the count tells the truth about what
   * happened rather than echoing back how many boxes were ticked.
   */
  updated: z.number().int().nonnegative(),
});
export type BulkApprovalResult = z.infer<typeof bulkApprovalResultSchema>;

/** The cap above, for the screens that need to page their select-all against it. */
export const APPROVAL_MAX_IDS = 200;

/**
 * How many rows a dashboard queue shows before "view all" takes over.
 *
 * The legacy panels are unbounded — `/Home/Index` loads every pending row of
 * every one of the six queues on page load, which is six unpaginated table
 * scans before anyone has clicked anything. Five is what fits the panel.
 */
export const APPROVAL_QUEUE_SIZE = 5;
