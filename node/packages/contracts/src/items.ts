import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";
import { hsnCode, money, optionalMoney, optionalPercent, requiredText } from "./fields";

/**
 * Items — `ItemMaster` in SQL Server.
 *
 * Every amount is a decimal STRING. `numeric` goes into and comes out of Drizzle
 * as a string, and it stays one across the wire and through the form. Parsing to
 * a JavaScript number anywhere in that path puts a decimal quantity into binary
 * floating point, which is how a price of 1234.56 becomes 1234.5600000000001.
 */
export const itemRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  unitId: z.number().int(),
  unitName: z.string(),
  pricePerUnit: z.string(),
  gstPercent: z.string().nullable(),
  gstAmount: z.string().nullable(),
  hsnCode: z.string().nullable(),
  isApproved: z.boolean(),
  capabilities: rowCapabilitiesSchema,
});
export type ItemRow = z.infer<typeof itemRowSchema>;

export const itemDetailSchema = itemRowSchema.omit({ capabilities: true, unitName: true });
export type ItemDetail = z.infer<typeof itemDetailSchema>;

/**
 * An item name as it is stored and compared: trimmed, with any run of spaces
 * collapsed to one.
 *
 * The unique index is on `lower(name)`, so "OPC Cement" and "opc cement" were
 * already refused. "OPC  Cement", with two spaces, was not — it looks identical
 * in every list and dropdown, and it is the duplicate people actually create.
 * Normalising on the way in closes that without a migration.
 */
export const normalizeItemName = (name: string): string => name.trim().replace(/\s+/g, " ");

/**
 * GST is STORED, not computed.
 *
 * `gstAmount` is derivable from `pricePerUnit` and `gstPercent`, which means it
 * can disagree with them. It is computed in the browser today — by the three
 * different jQuery calculators of assessment finding B-2 — and which of them is
 * correct is still an open business question (`07-Business-Rule-Inventory.md`).
 *
 * So the server validates the shape and the internal consistency it can be sure
 * of, and does not arbitrate the arithmetic. Deriving `gstAmount` here would be
 * picking a winner among the three by implication, silently, in a master screen
 * — the wrong place and the wrong moment to decide it.
 *
 * THERE IS NO "GST-INCLUSIVE" FLAG. The business removed it on 17 Sep 2026.
 *
 * An item carries a GST percentage and a GST amount, or it does not. The
 * separate boolean saying whether it "is GST-inclusive" is gone, and with it the
 * two rules that only existed to keep the flag and the figures agreeing:
 * a flagged item needing a percentage, and an unflagged item having to have its
 * figures cleared.
 *
 * The flag was never carrying its weight. Production data contradicts it
 * directly — the row captured in `legacy-screens/05-item-master.md` has
 * `IsWithGST` off while holding 18% and ₹4.86 — and `item-sheet.service.ts` had
 * to derive the flag from the percentage on import precisely because the legacy
 * value could not be trusted. Two fields that must agree, where one is already
 * known to be wrong, is a worse record of the truth than the one field that was
 * always doing the work.
 *
 * The presence of `gstPercent` is now the whole answer.
 */
export const createItemSchema = z.object({
  name: requiredText("Item name", 200).transform(normalizeItemName),
  unitId: z.coerce.number().int().positive("Choose a unit"),
  pricePerUnit: money("Price per unit"),
  gstPercent: optionalPercent("GST percentage"),
  gstAmount: optionalMoney("GST amount"),
  hsnCode,
  /*
    NO `isApproved` HERE, and that is now the rule everywhere.

    Approval is decided by the writer's own approve right, on the server, from
    the access token — see `common/approval.ts`. A caller cannot state it, so
    a clerk with no approve right cannot self-approve by sending the field.
  */
});
export type CreateItem = z.infer<typeof createItemSchema>;

export const updateItemSchema = createItemSchema.partial();
export type UpdateItem = z.infer<typeof updateItemSchema>;

export const ITEM_SORT_FIELDS = ["name", "createdAt"] as const;
export type ItemSortField = (typeof ITEM_SORT_FIELDS)[number];

/**
 * Units of measure — `UnitMaster`. Two columns in the source and two here.
 *
 * There is no soft delete: a unit that items reference must not vanish, so the
 * delete endpoint refuses with the count instead. That is a clearer answer than
 * hiding the row and leaving items pointing at something the UI cannot show.
 */
export const unitRowSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  /** Live items using this unit. A unit in use cannot be deleted. */
  itemCount: z.number().int().nonnegative(),
  capabilities: rowCapabilitiesSchema,
});
export type UnitRow = z.infer<typeof unitRowSchema>;

export const createUnitSchema = z.object({ name: requiredText("Unit name", 50) });
export type CreateUnit = z.infer<typeof createUnitSchema>;

export const updateUnitSchema = createUnitSchema.partial();
export type UpdateUnit = z.infer<typeof updateUnitSchema>;

export const UNIT_SORT_FIELDS = ["name", "createdAt"] as const;

/**
 * THE NAME CHECK, run as the name is typed in the item form.
 *
 * Added 14 Sep 2026 at the client's request: show items with the same or a
 * similar name while typing, and refuse the same name outright.
 *
 * `exact` is an item whose name matches after `normalizeItemName` and ignoring
 * case — the one that blocks saving. `similar` holds items containing every
 * word typed, in any order, so "cement opc" finds "OPC Cement 53 Grade".
 * `excludeId` is the item being edited, which must not match itself.
 */
export const itemNameCheckQuerySchema = z.object({
  name: z.string().trim().min(1).max(200),
  excludeId: z.string().uuid().optional(),
});
export type ItemNameCheckQuery = z.infer<typeof itemNameCheckQuerySchema>;

export const ITEM_NAME_CHECK_LIMIT = 8;

const itemNameMatchSchema = z.object({ id: z.string(), name: z.string() });

export const itemNameCheckSchema = z.object({
  exact: itemNameMatchSchema.nullable(),
  similar: z.array(itemNameMatchSchema),
});
export type ItemNameCheck = z.infer<typeof itemNameCheckSchema>;

export const duplicateItemNameMessage = (existing: string) =>
  `An item named "${existing}" already exists`;
