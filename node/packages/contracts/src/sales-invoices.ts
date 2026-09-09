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
 * Sales invoices — `SalesInvoice` / `SalesInvoiceDetail`.
 *
 * THE PERMISSION SUBJECT IS `sales-invoice`, SINGULAR. Production's `forms` has
 * "Sales Invoice" at id 27, active, controller `Sales`. Read off the live table
 * before this file was written, same as the purchase invoice one.
 *
 * A grant worth knowing about: user `ac` holds `is_approved = true` on that row
 * with `is_view_allow = false` — an approve right with no view right. The guard
 * treats those independently, so `ac` can approve a sales invoice through the
 * dashboard queue without being able to open the list. That is what the data
 * says, and it is not this module's job to quietly widen it.
 *
 * DIRECTION IS THE ONLY REAL DIFFERENCE from the purchase invoice, exactly as
 * `13-create-sales-invoice.md` predicts: the counterparty is the CUSTOMER, the
 * number is OURS rather than theirs, and there is no purchase-order link. The
 * arithmetic is the same `invoiceTotal.corrected()`.
 */

export const salesInvoiceItemRowSchema = z.object({
  id: z.string(),

  itemId: z.string().nullable(),
  itemLabel: z.string(),
  itemDescription: z.string().nullable(),

  unitId: z.number().int(),
  unitName: z.string(),

  /** Decimal STRINGS, all of them. */
  quantity: z.string(),
  unitPrice: z.string(),
  discountPerUnit: z.string(),
  /** Derived from the two above, never stored. */
  discountPercent: z.string(),
  gstPercent: z.string().nullable(),
  gstAmount: z.string(),
  netAmount: z.string(),
  lineTotal: z.string(),

  lineNumber: z.number().int(),
});
export type SalesInvoiceItemRow = z.infer<typeof salesInvoiceItemRowSchema>;

export const salesInvoiceRowSchema = z.object({
  id: z.string(),

  /**
   * OURS, and NOT NULL — issued by the server. There is no `displayNo` fallback
   * here because there is nothing to fall back from: a sales invoice cannot
   * exist without the number we gave it.
   */
  salesInvoiceNo: z.string(),
  customerInvoiceNo: z.string().nullable(),

  invoiceType: z.string(),

  siteId: z.string().nullable(),
  siteName: z.string().nullable(),

  /**
   * The list column the legacy screen calls "Customer" while labelling its own
   * filter "Supplier". One party table, both sides of the trade.
   */
  customerId: z.string(),
  customerName: z.string(),
  companyId: z.string(),
  companyName: z.string(),

  documentDate: z.string().nullable(),

  subtotal: z.string(),
  totalGstAmount: z.string(),
  totalDiscount: z.string(),
  tds: z.string(),
  roundOff: z.string(),
  totalAmount: z.string(),

  lineCount: z.number().int(),

  paymentStatus: z.string().nullable(),
  isPaidIn: z.boolean(),

  isApproved: z.boolean(),
  createdAt: z.string(),

  capabilities: rowCapabilitiesSchema,
});
export type SalesInvoiceRow = z.infer<typeof salesInvoiceRowSchema>;

export const salesInvoiceDetailSchema = salesInvoiceRowSchema
  .omit({
    capabilities: true,
    siteName: true,
    customerName: true,
    companyName: true,
    lineCount: true,
  })
  .extend({
    challanNo: z.string().nullable(),
    lrNo: z.string().nullable(),
    vehicleNo: z.string().nullable(),
    dispatchBy: z.string().nullable(),
    paymentTerms: z.string().nullable(),
    description: z.string().nullable(),

    contactName: z.string().nullable(),
    contactNumber: z.string().nullable(),
    shippingAddress: z.string().nullable(),

    items: z.array(salesInvoiceItemRowSchema),
  });
export type SalesInvoiceDetail = z.infer<typeof salesInvoiceDetailSchema>;

/**
 * A line as it is written.
 *
 * ONE PRICE. The source carries a visible, editable price box AND a hidden
 * catalogue twin, and its calculator reads the hidden one for the line's GST
 * while the roll-up sums the visible one — so a typed price produces GST charged
 * on a different number. There is one price here and it is the price.
 */
export const salesInvoiceLineInputSchema = z
  .object({
    itemId: optionalUuidId,
    itemName: optionalText(200),
    itemDescription: optionalText(500),
    unitId: z.coerce.number().int().positive("Choose a unit"),
    quantity: quantity("Quantity"),
    unitPrice: money("Price"),
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
    if (value.discountPerUnit !== null && Number(value.discountPerUnit) > Number(value.unitPrice)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountPerUnit"],
        message: "The discount cannot be more than the price",
      });
    }
  });
export type SalesInvoiceLineInput = z.infer<typeof salesInvoiceLineInputSchema>;

/** `Sales`, `Sales Return`, `Credit Note`. Mirrors the purchase side. */
export const SALES_INVOICE_TYPES = ["Sales", "Sales Return", "Credit Note"] as const;
export type SalesInvoiceType = (typeof SALES_INVOICE_TYPES)[number];

/**
 * `salesInvoiceNo` is NOT in the create contract — the server issues it from
 * `document_counters`, per company and financial year, inside the transaction.
 *
 * `13-create-sales-invoice.md` records the legacy form's Invoice No as an
 * "empty, EDITABLE box", which is worse than the purchase order's disabled one:
 * the number is not merely reserved by opening a form, it can be typed over
 * before submit. Nothing here accepts one.
 */
export const createSalesInvoiceSchema = z.object({
  invoiceType: z.enum(SALES_INVOICE_TYPES).default("Sales"),

  /** The CUSTOMER. A row in the same party table suppliers come from. */
  customerId: uuidId,
  companyId: uuidId,
  siteId: optionalUuidId,

  /** Their reference for this invoice, if they gave one. Free text. */
  customerInvoiceNo: optionalText(100),

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

  /**
   * TDS, SUBTRACTED.
   *
   * The sales calculator reads this box with a bare `.val()` and no
   * `parseFloat` — `totalAmount = totalSubtotal + totalGst - Tds` on a STRING.
   * Coercion saves it for ordinary digits, but anything non-numeric makes the
   * entire total `NaN`, and the round-off beside it is parsed properly. It is
   * the only unparsed value in that function.
   */
  tds: optionalMoney("TDS"),

  /** The Adjustment box. ADDED, and signed. */
  roundOff: optionalMoney("Adjustment"),

  items: z
    .array(salesInvoiceLineInputSchema)
    .min(1, "Add at least one product")
    .max(200, "An invoice cannot carry more than 200 lines"),
});
export type CreateSalesInvoice = z.infer<typeof createSalesInvoiceSchema>;

/** Update carries no number: a document's number is fixed once issued. */
export const updateSalesInvoiceSchema = createSalesInvoiceSchema.partial();
export type UpdateSalesInvoice = z.infer<typeof updateSalesInvoiceSchema>;

/**
 * `salesInvoiceNo` IS sortable here, where the purchase side's supplier number
 * is not usefully so — it is ours, NOT NULL, and formatted, so it sorts as
 * document order within a company. Across companies it does not, for the same
 * reason `poNo` does not: the prefix leads it.
 *
 * `documentDate` is still absent: nullable, and a nullable keyset sort column
 * silently drops rows.
 */
export const SALES_INVOICE_SORT_FIELDS = [
  "createdAt",
  "salesInvoiceNo",
  "totalAmount",
] as const;
export type SalesInvoiceSortField = (typeof SALES_INVOICE_SORT_FIELDS)[number];
