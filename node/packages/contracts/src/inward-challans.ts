import { z } from "zod";
import { listResponseSchema, rowCapabilitiesSchema, type ListResponse } from "./pagination";
import { optionalDate, optionalText, optionalUuidId, quantity, uuidId } from "./fields";
import { attachmentSchema, type Attachment } from "./attachments";

/**
 * Inward challans — `ItemInword` in SQL Server, `/ItemInWord/ItemInWord`.
 *
 * Goods arriving from a supplier against their invoice. No money on the
 * document, which is what makes it a safe Phase 3 companion to purchase
 * requests: the GST question of finding B-2 does not touch it.
 *
 * The source spells this three ways — `ItemInWord`, `ItemInword`, `InwardId`.
 * Everything here says `inward`; the ETL maps at the boundary.
 */

/**
 * An attachment on a challan, in the shape every module with files now uses.
 *
 * `storageKey` used to be on this schema and is gone: it is a server-side
 * location and the browser never needed it. What it needed was `isDownloadable`,
 * which is what "there are bytes to fetch" actually means — the ETL brings over
 * rows recording a file NAME and nothing else, because the source's own table
 * records nothing else.
 */
export const inwardChallanDocumentSchema = attachmentSchema;
export type InwardChallanDocument = Attachment;

export const inwardChallanRowSchema = z.object({
  id: z.string(),

  siteId: z.string(),
  siteName: z.string(),

  itemId: z.string(),
  /** The item's CURRENT name, from the master — as `GetItemInWordList` reads it. */
  itemName: z.string(),

  /** Null when the challan records no supplier, which the source's live create path guarantees. */
  supplierId: z.string().nullable(),
  supplierName: z.string().nullable(),

  unitId: z.number().int(),
  unitName: z.string(),

  /** A decimal STRING. The captures show 4000.0 and 29.62 side by side. */
  quantity: z.string(),

  /** FREE TEXT: `922`, `1`, `253-1` are all real values. */
  invoiceNo: z.string().nullable(),

  documentDate: z.string().nullable(),
  vehicleNumber: z.string().nullable(),
  receiverName: z.string().nullable(),

  /** How many files are attached. The names are on the detail. */
  documentCount: z.number().int().nonnegative(),

  isApproved: z.boolean(),
  createdAt: z.string(),

  capabilities: rowCapabilitiesSchema,
});
export type InwardChallanRow = z.infer<typeof inwardChallanRowSchema>;

export const inwardChallanDetailSchema = inwardChallanRowSchema
  .omit({
    capabilities: true,
    siteName: true,
    unitName: true,
    itemName: true,
    supplierName: true,
    documentCount: true,
  })
  .extend({
    documents: z.array(inwardChallanDocumentSchema),
  });
export type InwardChallanDetail = z.infer<typeof inwardChallanDetailSchema>;

/**
 * `siteId` is REQUIRED — the column is NOT NULL and the list inner-joins it.
 *
 * The form has no site control: the shell's site scope supplies it, exactly as
 * the legacy screen's own Site dropdown was fed by the header. A challan raised
 * with no site in scope is refused rather than written with a guess.
 *
 * `isApproved` is absent, as everywhere else: a new challan is unapproved and
 * approving is a separate action needing the approve right.
 */
export const createInwardChallanSchema = z.object({
  siteId: uuidId,
  itemId: uuidId,
  /**
   * `optionalUuidId`, not `uuidId.nullable().optional()`. An unselected select
   * submits "", which the latter rejects as "Not a valid identifier" — and a
   * challan with no supplier is the COMMON case here, because the source's live
   * create path never records one.
   */
  supplierId: optionalUuidId,
  unitId: z.coerce.number().int().positive("Choose a unit"),
  quantity: quantity("Quantity"),
  invoiceNo: optionalText(100),
  documentDate: optionalDate,
  vehicleNumber: optionalText(50),
  receiverName: optionalText(200),
});
export type CreateInwardChallan = z.infer<typeof createInwardChallanSchema>;

export const updateInwardChallanSchema = createInwardChallanSchema.partial();
export type UpdateInwardChallan = z.infer<typeof updateInwardChallanSchema>;

/**
 * The filters this screen has and no other does.
 *
 * The legacy screen is the only one with EXPLICIT filtering: two dropdowns
 * (Supplier, Item), a Search By selector, a magnifier and a Reset. Its filters
 * are ids, not text — `Guid.Parse(request.supplier)` — despite the boxes looking
 * like free text, so a typed name matches nothing at all.
 *
 * A date range is accepted too. `GetItemInWordList` supports `startDate` and
 * `enddate` and the screen never sends them, so the capability exists and is
 * unreachable; it is reachable here.
 */
export const inwardChallanFilterSchema = z.object({
  siteId: uuidId.optional(),
  supplierId: uuidId.optional(),
  itemId: uuidId.optional(),
  isApproved: z.boolean().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});
export type InwardChallanFilters = z.infer<typeof inwardChallanFilterSchema>;

/**
 * The list response carries the QUANTITY TOTAL for the whole filtered set.
 *
 * The legacy grid shows a purple footer row totalling the Quantity column —
 * `70013.25` in the capture — and it is the only grid in the system with an
 * aggregate. The source computes it correctly, over the filtered set rather than
 * the page, and then delivers it by writing `TotalRows` and `TotalQuantity` onto
 * `list[0]`: the totals ride on the first row and VANISH when the list is empty,
 * which is exactly when a "0.00" would be most reassuring.
 *
 * It is a field on the response here, and it is a decimal STRING like every
 * other quantity — a sum of decimals is still a decimal.
 */
export const inwardChallanListResponseSchema = listResponseSchema(inwardChallanRowSchema).extend({
  totalQuantity: z.string(),
});
export type InwardChallanListResponse = ListResponse<InwardChallanRow> & {
  totalQuantity: string;
};

/**
 * NOT sortable by `documentDate`, though it is the column a user would reach
 * for. It is NULLABLE, and keyset paging needs a NOT NULL sort column: in
 * PostgreSQL every comparison against NULL is itself NULL, so the seek predicate
 * excludes undated rows entirely while ORDER BY still places them last. Paging
 * by it drops every undated challan and the count never adds up. See the note in
 * `common/keyset.ts`.
 *
 * `createdAt` is the source's own ordering (`OrderByDescending(x => x.CreatedOn)`)
 * and is NOT NULL, so it is the default here.
 */
export const INWARD_CHALLAN_SORT_FIELDS = ["createdAt", "quantity"] as const;
export type InwardChallanSortField = (typeof INWARD_CHALLAN_SORT_FIELDS)[number];
