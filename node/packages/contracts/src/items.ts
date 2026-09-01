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
  isWithGst: z.boolean(),
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
 */
export const createItemSchema = z
  .object({
    name: requiredText("Item name", 200),
    unitId: z.coerce.number().int().positive("Choose a unit"),
    pricePerUnit: money("Price per unit"),
    isWithGst: z.boolean().default(false),
    gstPercent: optionalPercent("GST percentage"),
    gstAmount: optionalMoney("GST amount"),
    hsnCode,
    isApproved: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.isWithGst && value.gstPercent === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gstPercent"],
        message: "A GST-inclusive item needs a GST percentage",
      });
    }
    // The reverse is the more dangerous case: GST figures left behind on an item
    // that was switched to non-GST would still be picked up by anything reading
    // the columns rather than the flag.
    if (!value.isWithGst && (value.gstPercent !== null || value.gstAmount !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gstPercent"],
        message: "Clear the GST figures, or mark the item as GST-inclusive",
      });
    }
  });
export type CreateItem = z.infer<typeof createItemSchema>;

export const updateItemSchema = createItemSchema.innerType().partial();
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
