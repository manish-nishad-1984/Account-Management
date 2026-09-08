import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";
import {
  money,
  optionalDate,
  optionalMoney,
  optionalPercent,
  optionalText,
  optionalUuidId,
  quantity,
  uuidId,
} from "./fields";

/**
 * Purchase orders — `PurchaseOrder` / `PurchaseOrderDetail` in SQL Server.
 *
 * The first header-with-lines document in the migration, and the first that
 * carries money.
 *
 * ON B-2. `08-create-purchase-order.md` marks this screen as gated on the GST
 * calculator question. It is not, and the reasoning is recorded in full in
 * `packages/domain/src/purchase-order-total.ts`: the Create Purchase Order view
 * loads ONE calculator script and contains zero occurrences of discount, TDS or
 * round-off, which are the three things the three calculators disagree about.
 * The question stays open for purchase and sales invoices, which is where it
 * bites.
 *
 * TOTALS ARE NOT IN ANY WRITE CONTRACT. The server computes them from the lines
 * and stores them. The source posts browser-computed totals and saves them
 * unchecked, so a crafted request could book an order at any value it liked.
 */

export const purchaseOrderItemRowSchema = z.object({
  id: z.string(),

  /** Null when the line names free text instead of a catalogue item. */
  itemId: z.string().nullable(),
  /** The catalogue name when there is one, else the line's own text. */
  itemLabel: z.string(),
  itemDescription: z.string().nullable(),
  hsnCode: z.string().nullable(),

  unitId: z.number().int(),
  unitName: z.string(),

  /** Decimal STRINGS, all of them. Never parse one to a number. */
  quantity: z.string(),
  unitPrice: z.string(),
  gstPercent: z.string().nullable(),
  gstAmount: z.string(),
  lineTotal: z.string(),

  lineNumber: z.number().int(),
});
export type PurchaseOrderItemRow = z.infer<typeof purchaseOrderItemRowSchema>;

export const purchaseOrderRowSchema = z.object({
  id: z.string(),
  poNo: z.string(),

  siteId: z.string(),
  siteName: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  companyId: z.string(),
  companyName: z.string(),

  documentDate: z.string().nullable(),

  /**
   * The legacy list renders `@item.Poid - @item.BuyersPurchaseNo` in one cell,
   * which is where `07-purchase-orders.md` got the idea that the number carries a
   * free-text suffix. It does not — this is a separate field and it is returned
   * separately, so the number stays a number.
   */
  buyersPurchaseNo: z.string().nullable(),

  /** Server-computed. See the note at the top of this file. */
  subtotal: z.string(),
  totalGstAmount: z.string(),
  totalAmount: z.string(),

  /** How many lines the order has, so the list can say so without fetching them. */
  lineCount: z.number().int(),

  isActive: z.boolean(),
  isApproved: z.boolean(),
  createdAt: z.string(),

  capabilities: rowCapabilitiesSchema,
});
export type PurchaseOrderRow = z.infer<typeof purchaseOrderRowSchema>;

export const purchaseOrderDetailSchema = purchaseOrderRowSchema
  .omit({ capabilities: true, siteName: true, supplierName: true, companyName: true, lineCount: true })
  .extend({
    siteGroupId: z.string().nullable(),

    deliveryDate: z.string().nullable(),
    deliveryImmediate: z.boolean(),

    terms: z.string().nullable(),
    description: z.string().nullable(),
    billingAddress: z.string().nullable(),
    groupAddress: z.string().nullable(),

    contactName: z.string().nullable(),
    contactNumber: z.string().nullable(),
    otherContactName: z.string().nullable(),
    otherContactNumber: z.string().nullable(),
    dispatchBy: z.string().nullable(),
    paymentTerms: z.string().nullable(),

    /** Carried from the source and never applied to the totals. */
    totalDiscount: z.string().nullable(),

    items: z.array(purchaseOrderItemRowSchema),
  });
export type PurchaseOrderDetail = z.infer<typeof purchaseOrderDetailSchema>;

/**
 * A line as it is written.
 *
 * `gstAmount` and `lineTotal` are absent by construction — they are derived. The
 * source sends them from the browser and stores them without checking, which is
 * what makes its stored totals unverifiable after the fact.
 */
export const purchaseOrderLineInputSchema = z
  .object({
    // An unselected <select> submits "", which a plain nullable uuid rejects as
    // "Not a valid identifier". Same field, same reason, as the challan supplier.
    itemId: optionalUuidId,
    itemName: optionalText(200),
    itemDescription: optionalText(500),
    unitId: z.coerce.number().int().positive("Choose a unit"),
    quantity: quantity("Quantity"),
    unitPrice: money("Price"),
    gstPercent: optionalPercent("GST %"),
    /** Accepted, stored, and deliberately not used in the arithmetic. */
    discount: optionalMoney("Discount"),
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
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInputSchema>;

/**
 * `poNo` is NOT in the create contract — the server issues it from
 * `document_counters`, per company and financial year, inside the insert's own
 * transaction.
 *
 * The source fetches the number when the form OPENS and posts it back on save,
 * so two open forms submit the same number and nothing refuses it. Worse, its
 * generator returns the string "Error generating Purchase Order number." on any
 * failure, and that sentence would be written to the column.
 */
export const createPurchaseOrderSchema = z.object({
  siteId: uuidId,
  supplierId: uuidId,
  companyId: uuidId,
  siteGroupId: optionalUuidId,

  documentDate: optionalDate,

  /**
   * Delivery: a date, or "immediate". One legacy string column held both.
   *
   * Both may be absent — that is "nobody said", which the source cannot express
   * because its single column conflates it with immediate.
   */
  deliveryDate: optionalDate,
  deliveryImmediate: z.coerce.boolean().default(false),

  buyersPurchaseNo: optionalText(100),
  contactName: optionalText(200),
  contactNumber: optionalText(20),
  otherContactName: optionalText(200),
  otherContactNumber: optionalText(20),
  dispatchBy: optionalText(200),
  paymentTerms: optionalText(500),

  billingAddress: optionalText(500),
  groupAddress: optionalText(500),

  /**
   * PLAIN TEXT, not HTML, in this pass — see the column comment on
   * `purchase_orders.terms`. The source stores rich-text HTML from a full
   * toolbar; storing that without a sanitiser would be stored XSS on the app's
   * own origin.
   */
  terms: optionalText(20000),
  description: optionalText(2000),

  items: z
    .array(purchaseOrderLineInputSchema)
    .min(1, "Add at least one product")
    .max(200, "An order cannot carry more than 200 lines"),
});
export type CreatePurchaseOrder = z.infer<typeof createPurchaseOrderSchema>;

/**
 * Update carries no `poNo`: a document's number is fixed once issued.
 *
 * `items` is all-or-nothing — send the whole set or none of it. A partial line
 * update would need stable client-side line identity, and the grid does not have
 * it; the source solves this by deleting every detail row and re-inserting,
 * which is what this does inside one transaction.
 */
export const updatePurchaseOrderSchema = createPurchaseOrderSchema.partial();
export type UpdatePurchaseOrder = z.infer<typeof updatePurchaseOrderSchema>;

/**
 * `poNo` sorts as text. Unlike `prNo` that is NOT document order across
 * companies — `DEMO/PO/24-25/002` sorts before `DHP/PO/24-25/001` — but it is
 * document order within one company, which is how the list is read.
 */
export const PURCHASE_ORDER_SORT_FIELDS = ["poNo", "createdAt", "totalAmount"] as const;
export type PurchaseOrderSortField = (typeof PURCHASE_ORDER_SORT_FIELDS)[number];
