import { z } from "zod";
import { listResponseSchema, rowCapabilitiesSchema, type ListResponse } from "./pagination";
import { optionalDate, optionalText, quantity, uuidId } from "./fields";

/**
 * Inventory inward — `InventoryInward` in SQL Server, served from `SalesRepo`.
 *
 * Stock arriving at a site: an item, a quantity, a unit, a date and free text.
 * Six fields, no money, no document number, no attachments — the smallest
 * transaction in the system, and the first one built against the shell's site
 * scope.
 */
export const inventoryInwardRowSchema = z.object({
  id: z.string(),

  /**
   * NULL on every row imported from production.
   *
   * The column exists on the source table and nothing writes it — the create
   * form has no site field. Rows created here carry the caller's scoped site, so
   * the two are distinguishable and the backfill is visible: count the nulls.
   */
  siteId: z.string().nullable(),
  siteName: z.string().nullable(),

  itemId: z.string(),
  /**
   * The item's CURRENT name, from the master.
   *
   * The source projects `i.ItemName` in the list and `a.Item` — a snapshot taken
   * when the row was keyed — in the edit form, so renaming an item makes the two
   * screens disagree. One name, from one place.
   */
  itemName: z.string(),

  unitId: z.number().int(),
  unitName: z.string(),

  /** A decimal STRING. Never parse it to a number. */
  quantity: z.string(),

  /** ISO 8601, or null — the source column is nullable. */
  documentDate: z.string().nullable(),

  /** Free text. "TO RAJAOUL" in the captured row — a destination, not a description. */
  details: z.string().nullable(),

  isApproved: z.boolean(),
  createdAt: z.string(),

  capabilities: rowCapabilitiesSchema,
});
export type InventoryInwardRow = z.infer<typeof inventoryInwardRowSchema>;

export const inventoryInwardDetailSchema = inventoryInwardRowSchema.omit({
  capabilities: true,
  siteName: true,
  unitName: true,
  itemName: true,
});
export type InventoryInwardDetail = z.infer<typeof inventoryInwardDetailSchema>;

/**
 * `itemId` is REQUIRED, unlike on a purchase request.
 *
 * The source column is `Guid` rather than `Guid?` and the create form offers no
 * free-text alternative, so there is no legitimate off-catalogue arrival.
 *
 * `siteId` is optional. The form has no site field — the server fills it from
 * the caller's scope — but it is accepted so a caller who genuinely knows the
 * site can say so.
 *
 * `isApproved` is ABSENT on purpose. `InsertInventoryDetails` hard-codes
 * `IsApproved = true`, so every arrival in production posted pre-approved and
 * the Approve column has never gated anything. New rows here are created
 * unapproved, as everywhere else, and approving is a separate action needing the
 * approve right. Flagged for sign-off — if arrivals should post pre-approved,
 * that is a decision to state rather than a constant inside an insert.
 */
export const createInventoryInwardSchema = z.object({
  siteId: uuidId
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  itemId: uuidId,
  unitId: z.coerce.number().int().positive("Choose a unit"),
  quantity: quantity("Quantity"),
  documentDate: optionalDate,
  details: optionalText(500),
});
export type CreateInventoryInward = z.infer<typeof createInventoryInwardSchema>;

export const updateInventoryInwardSchema = createInventoryInwardSchema.partial();
export type UpdateInventoryInward = z.infer<typeof updateInventoryInwardSchema>;

/**
 * Sorting. `createdAt` is the source's own default ordering
 * (`OrderByDescending(u => u.CreatedOn)`), so it is the default here too.
 *
 * NOT sortable by item name: that lives on the joined master, and keyset paging
 * needs a NOT NULL column on the table being paged. The source sorts by it and
 * pages in memory, which it can afford at three rows and could not at three
 * thousand.
 */
export const INVENTORY_INWARD_SORT_FIELDS = ["createdAt", "quantity"] as const;
export type InventoryInwardSortField = (typeof INVENTORY_INWARD_SORT_FIELDS)[number];

/**
 * The list response carries one extra figure: how many live rows have no site.
 *
 * Every row imported from production has `site_id IS NULL`, because the .NET
 * form never set it. A site-scoped list therefore has to admit unallocated rows
 * or show nothing at all, and the screen has to be able to SAY so — otherwise
 * the site filter looks broken. The count reaches zero when the history is
 * backfilled, and the notice goes with it.
 */
export const inventoryInwardListResponseSchema = listResponseSchema(
  inventoryInwardRowSchema,
).extend({
  unallocated: z.number().int().nonnegative(),
});
export type InventoryInwardListResponse = ListResponse<InventoryInwardRow> & {
  unallocated: number;
};
