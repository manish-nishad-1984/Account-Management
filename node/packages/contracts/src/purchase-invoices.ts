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
 * Purchase invoices — `SupplierInvoice` / `SupplierInvoiceDetail`.
 *
 * THE PERMISSION SUBJECT IS `purchase-invoice`, SINGULAR — and it is singular
 * for a reason that has already cost one production 403.
 *
 * The subject is the slug of the ACTIVE `forms` row's name. Production holds
 * three rows for invoicing and only one is active:
 *
 *     id  6  "Create Invoice"     is_active = f
 *     id  9  "Purchase  Invoice"  is_active = t   <- note the DOUBLE SPACE
 *     id 27  "Sales Invoice"      is_active = t
 *
 * `slug()` collapses runs of non-alphanumerics, so the double space is harmless
 * and id 9 gives `purchase-invoice`. But purchase ORDERS are `purchase-orders`,
 * PLURAL, because their active row is named "Purchase Orders" — so copying the
 * neighbouring module's convention here produces `purchase-invoices` and a 403
 * on every request. §5f's rule earned this the expensive way; the addition is
 * that the row must be read with `is_active = true`, because the retired rows
 * are granted to every user and grant counts therefore distinguish nothing.
 *
 * Checked against the live `forms` table on 8 Sep 2026, before this file was
 * written rather than after the deploy failed.
 *
 * TOTALS ARE NOT IN ANY WRITE CONTRACT, for the same reason as purchase orders:
 * the server computes them with `invoiceTotal.corrected()` and stores them. The
 * source posts browser-computed totals and stores them unchecked — which is how
 * an invoice can be saved whose total ignores its own TDS.
 */

export const purchaseInvoiceItemRowSchema = z.object({
  id: z.string(),

  /** Null when the line names free text instead of a catalogue item. */
  itemId: z.string().nullable(),
  itemLabel: z.string(),
  itemDescription: z.string().nullable(),

  unitId: z.number().int(),
  unitName: z.string(),

  /** Decimal STRINGS, all of them. Never parse one to a number. */
  quantity: z.string(),
  /** Before discount. */
  unitPrice: z.string(),
  discountPerUnit: z.string(),
  /**
   * DERIVED from `unitPrice` and `discountPerUnit`, not stored — see the column
   * comment on `purchase_invoice_items.discount_per_unit`. The source keeps both
   * and its two handlers each overwrite the other, so they are one fact in two
   * boxes; storing both would let them drift.
   */
  discountPercent: z.string(),
  gstPercent: z.string().nullable(),
  gstAmount: z.string(),
  netAmount: z.string(),
  lineTotal: z.string(),

  lineNumber: z.number().int(),
});
export type PurchaseInvoiceItemRow = z.infer<typeof purchaseInvoiceItemRowSchema>;

export const purchaseInvoiceRowSchema = z.object({
  id: z.string(),

  /**
   * What the list shows in the InvoiceNo column: the supplier's number, falling
   * back to ours when there is none.
   *
   * The source's partial does this with `@if (item.SupplierInvoiceNo == "")`,
   * which a NULL fails — so a null supplier number renders an EMPTY link and the
   * row cannot be identified or opened. Computed here, where null and empty mean
   * the same thing.
   */
  displayNo: z.string(),
  supplierInvoiceNo: z.string().nullable(),
  invoiceNo: z.string().nullable(),

  /** `Purchase`, `Purchase Return` or `Credit Note`. */
  invoiceType: z.string(),

  siteId: z.string().nullable(),
  siteName: z.string().nullable(),
  supplierId: z.string(),
  supplierName: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  siteGroupId: z.string().nullable(),
  siteGroupName: z.string().nullable(),

  documentDate: z.string().nullable(),

  /** Server-computed. See the note at the top of this file. */
  subtotal: z.string(),
  totalGstAmount: z.string(),
  totalDiscount: z.string(),
  tds: z.string(),
  roundOff: z.string(),
  totalAmount: z.string(),

  lineCount: z.number().int(),

  /** Carried from the payments screens, never written here. */
  paymentStatus: z.string().nullable(),
  isPaidOut: z.boolean(),

  isApproved: z.boolean(),
  createdAt: z.string(),

  capabilities: rowCapabilitiesSchema,
});
export type PurchaseInvoiceRow = z.infer<typeof purchaseInvoiceRowSchema>;

export const purchaseInvoiceDetailSchema = purchaseInvoiceRowSchema
  .omit({
    capabilities: true,
    siteName: true,
    supplierName: true,
    companyName: true,
    siteGroupName: true,
    lineCount: true,
  })
  .extend({
    /** A REAL foreign key, where the source matches the order's number as text. */
    purchaseOrderId: z.string().nullable(),
    purchaseOrderNo: z.string().nullable(),

    challanNo: z.string().nullable(),
    lrNo: z.string().nullable(),
    vehicleNo: z.string().nullable(),
    dispatchBy: z.string().nullable(),
    paymentTerms: z.string().nullable(),
    description: z.string().nullable(),

    contactName: z.string().nullable(),
    contactNumber: z.string().nullable(),
    shippingAddress: z.string().nullable(),
    groupAddress: z.string().nullable(),

    items: z.array(purchaseInvoiceItemRowSchema),
  });
export type PurchaseInvoiceDetail = z.infer<typeof purchaseInvoiceDetailSchema>;

/**
 * A line as it is written.
 *
 * `gstAmount`, `netAmount` and `lineTotal` are absent by construction — they are
 * derived. `discountPercent` is absent too, and that is the interesting one: the
 * form offers both boxes, as the legacy screen does, but only the rupee figure
 * is ever SENT. The percent is a convenience for typing and is converted before
 * submit, so the two can never arrive disagreeing.
 */
export const purchaseInvoiceLineInputSchema = z
  .object({
    itemId: optionalUuidId,
    itemName: optionalText(200),
    itemDescription: optionalText(500),
    unitId: z.coerce.number().int().positive("Choose a unit"),
    quantity: quantity("Quantity"),
    unitPrice: money("Price"),
    /** Rupees PER UNIT, as the legacy screen holds it — not per line. */
    discountPerUnit: optionalMoney("Discount"),
    gstPercent: optionalPercent("GST %"),
  })
  .superRefine((value, ctx) => {
    if (value.itemId === null && value.itemName === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itemId"],
        message: "Choose an item, or type a name for one that is not in the catalogue",
      });
    }
    // A discount larger than the price would make the line negative, and the
    // legacy screen has no guard at all — it writes the negative straight into
    // the price box and carries on.
    if (value.discountPerUnit !== null && Number(value.discountPerUnit) > Number(value.unitPrice)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountPerUnit"],
        message: "The discount cannot be more than the price",
      });
    }
  });
export type PurchaseInvoiceLineInput = z.infer<typeof purchaseInvoiceLineInputSchema>;

/**
 * INVOICE_TYPES — the three values the source's reads compare against.
 *
 * Not a database check constraint: the column is an unconstrained nvarchar in
 * SQL Server and the census has not yet said what is actually in it, so the ETL
 * must be able to load a value this list does not have. The FORM offers only
 * these three.
 */
export const INVOICE_TYPES = ["Purchase", "Purchase Return", "Credit Note"] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const createPurchaseInvoiceSchema = z.object({
  /**
   * REQUIRED, and it is the supplier's number, not ours.
   *
   * Free text: `BB/154`, `016`, `BE-2026-27-4756`. No uniqueness is enforced —
   * not across suppliers and not within one, because two suppliers reusing `016`
   * is ordinary and refusing the second would be refusing a real document.
   */
  supplierInvoiceNo: z
    .string()
    .trim()
    .min(1, "The supplier's invoice number is required")
    .max(100, "That is too long for an invoice number"),

  invoiceType: z.enum(INVOICE_TYPES).default("Purchase"),

  siteId: optionalUuidId,
  supplierId: uuidId,
  companyId: uuidId,
  siteGroupId: optionalUuidId,
  purchaseOrderId: optionalUuidId,

  documentDate: optionalDate,

  challanNo: optionalText(100),
  lrNo: optionalText(100),
  vehicleNo: optionalText(50),
  dispatchBy: optionalText(200),
  paymentTerms: optionalText(500),
  description: optionalText(2000),

  contactName: optionalText(200),
  contactNumber: optionalText(20),
  shippingAddress: optionalText(500),
  groupAddress: optionalText(500),

  /**
   * Tax deducted at source, SUBTRACTED from the total.
   *
   * On the live screen this box is read by a calculator that has been
   * overwritten, so the amount typed here does not reach the total at all —
   * B-2(a). Here it does.
   */
  tds: optionalMoney("TDS"),

  /**
   * The Adjustment box. ADDED to the total, and SIGNED — nudging a total down to
   * match a supplier's paperwork is the common case, so a negative is normal and
   * `optionalMoney` allows the leading minus.
   */
  roundOff: optionalMoney("Adjustment"),

  items: z
    .array(purchaseInvoiceLineInputSchema)
    .min(1, "Add at least one product")
    .max(200, "An invoice cannot carry more than 200 lines"),
});
export type CreatePurchaseInvoice = z.infer<typeof createPurchaseInvoiceSchema>;

/** `items` is all-or-nothing, for the reason given on purchase orders. */
export const updatePurchaseInvoiceSchema = createPurchaseInvoiceSchema.partial();
export type UpdatePurchaseInvoice = z.infer<typeof updatePurchaseInvoiceSchema>;

/**
 * `documentDate` is NULLABLE, so it cannot be the keyset sort column — a NULL
 * sorts unpredictably against a cursor and the page silently loses rows. The
 * list therefore sorts on `createdAt`, which is NOT NULL, and offers the others
 * as secondary orderings that fall back to it.
 */
export const PURCHASE_INVOICE_SORT_FIELDS = [
  "createdAt",
  "supplierInvoiceNo",
  "totalAmount",
] as const;
export type PurchaseInvoiceSortField = (typeof PURCHASE_INVOICE_SORT_FIELDS)[number];
