import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";
import { optionalDate, optionalText, optionalUuidId, quantity, uuidId } from "./fields";

/**
 * Purchase requests — `PurchaseRequest` in SQL Server.
 *
 * The first transaction document in the migration, and deliberately the one with
 * no money on it: a request says what is wanted and how much, never what it
 * costs. Pricing enters at the purchase order. That is why Phase 3 of the
 * roadmap starts here — the team builds the transactional UI patterns before
 * touching the GST arithmetic that finding B-2 leaves unresolved.
 *
 * One request is ONE LINE: a single item, quantity and unit. Not a header with
 * details, unlike every document downstream.
 */
export const purchaseRequestRowSchema = z.object({
  id: z.string(),
  prNo: z.string(),

  siteId: z.string(),
  siteName: z.string(),

  /** Null when the request names free text instead of a catalogue item. */
  itemId: z.string().nullable(),
  /**
   * What to show in the Item column: the catalogue item's name when there is
   * one, otherwise the free text the request was raised with. Resolved on the
   * server so no client has to know that rule.
   */
  itemLabel: z.string(),
  itemDescription: z.string().nullable(),

  unitId: z.number().int(),
  unitName: z.string(),

  /** A decimal STRING. Never parse it to a number. */
  quantity: z.string(),

  /** ISO 8601, or null — the source column is nullable. */
  documentDate: z.string().nullable(),
  siteAddress: z.string().nullable(),

  isApproved: z.boolean(),
  createdAt: z.string(),

  capabilities: rowCapabilitiesSchema,
});
export type PurchaseRequestRow = z.infer<typeof purchaseRequestRowSchema>;

export const purchaseRequestDetailSchema = purchaseRequestRowSchema
  .omit({ capabilities: true, siteName: true, unitName: true, itemLabel: true })
  .extend({
    itemName: z.string().nullable(),
    siteAddressId: z.number().int().nullable(),
  });
export type PurchaseRequestDetail = z.infer<typeof purchaseRequestDetailSchema>;

/**
 * `prNo` is NOT in the create contract.
 *
 * The number is issued by the server from `document_counters`, inside the same
 * transaction as the insert. The .NET flow asked the API for the next number,
 * showed it in the form, and posted it back — so two people with the form open
 * submitted the same number, and nothing refused it.
 *
 * Either `itemId` or `itemName` must be present, matching the source's two ways
 * of naming what is wanted. Requiring both would refuse free-text requests the
 * business actually raises; requiring neither leaves a row nobody can read.
 */
export const createPurchaseRequestSchema = z
  .object({
    siteId: uuidId,
    // Same as the challan supplier: an unselected select submits "", which the
    // plain nullable form rejects as "Not a valid identifier". A free-text item
    // with no master row is the whole point of this field being nullable.
    itemId: optionalUuidId,
    itemName: optionalText(200),
    itemDescription: optionalText(500),
    unitId: z.coerce.number().int().positive("Choose a unit"),
    quantity: quantity("Quantity"),
    documentDate: optionalDate,
    siteAddressId: z.coerce
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    siteAddress: optionalText(500),
  })
  .superRefine((value, ctx) => {
    if (value.itemId === null && value.itemName === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itemId"],
        message: "Choose an item, or type a name for one that is not in the catalogue",
      });
    }
  });
export type CreatePurchaseRequest = z.infer<typeof createPurchaseRequestSchema>;

/**
 * Update carries no `prNo` either: a document's number is fixed once issued.
 * `UpdatePurchaseRequestDetails` in the source reassigns `PrNo` from the posted
 * body, so a client could renumber an existing request over another one.
 */
export const updatePurchaseRequestSchema = createPurchaseRequestSchema.innerType().partial();
export type UpdatePurchaseRequest = z.infer<typeof updatePurchaseRequestSchema>;

/**
 * Approve or unapprove, stated explicitly.
 *
 * `PurchaseRequestIsApproved` in the source TOGGLES: it reads the current value
 * and writes the opposite. Two approvers clicking at once leave it approved or
 * not depending on ordering, and the API cannot express "approve this" at all —
 * only "flip it". The caller says what it wants here.
 */
export const setApprovalSchema = z.object({ isApproved: z.boolean() });
export type SetApproval = z.infer<typeof setApprovalSchema>;

/** Bulk approval from the dashboard queue. */
export const bulkApprovalSchema = z.object({
  ids: z.array(uuidId).min(1, "Select at least one request").max(200),
  isApproved: z.boolean(),
});
export type BulkApproval = z.infer<typeof bulkApprovalSchema>;

export const bulkApprovalResultSchema = z.object({
  /** How many rows actually changed. Ids already in the target state count as 0. */
  updated: z.number().int().nonnegative(),
});
export type BulkApprovalResult = z.infer<typeof bulkApprovalResultSchema>;

/**
 * `prNo` sorts as text, which is correct for this format: the year is fixed
 * width and the sequence is zero-padded, so lexical order is document order.
 */
export const PURCHASE_REQUEST_SORT_FIELDS = ["prNo", "createdAt", "quantity"] as const;
export type PurchaseRequestSortField = (typeof PURCHASE_REQUEST_SORT_FIELDS)[number];
