import { z } from "zod";
import { money, optionalDate, optionalText, optionalUuidId, uuidId } from "./fields";
import { rowCapabilitiesSchema } from "./pagination";

/**
 * Payments — `/Report/ReportDetails` panel 3, "Payment Actions".
 *
 * See `apps/api/src/db/schema/payments.ts` for why this is a table rather than
 * the sentinel rows the source keeps inside `SupplierInvoice`/`SalesInvoice`.
 */

/**
 * Money OUT to a supplier, or money IN from a customer.
 *
 * The source expresses this by which table the row lands in, so the same screen
 * is served by two near-identical repositories and the ledger runs two
 * near-identical queries. One column instead.
 */
export const PAYMENT_DIRECTIONS = ["out", "in"] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

/**
 * An opening balance is NOT a payment, and it moves the ledger the other way.
 *
 * `PayOutScript.js:687` picks between the two in the browser and posts the
 * literal string `"Opening Balance"` or `"PayOut"`; the server then stamps
 * `IsPayOut = true` on both. So the boolean and the string disagree on every
 * opening balance ever recorded, and every read believes the string.
 */
export const PAYMENT_KINDS = ["payment", "opening_balance"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const paymentRowSchema = z.object({
  id: z.string(),
  direction: z.enum(PAYMENT_DIRECTIONS),
  kind: z.enum(PAYMENT_KINDS),

  partyId: z.string(),
  partyName: z.string(),
  companyId: z.string(),
  companyName: z.string(),

  /** Null on an opening balance, which belongs to the party and not to a site. */
  siteId: z.string().nullable(),
  siteName: z.string().nullable(),
  siteGroupId: z.string().nullable(),
  siteGroupName: z.string().nullable(),

  paymentDate: z.string().nullable(),

  /** Always positive. The direction of the effect is `direction` and `kind`. */
  amount: z.string(),

  description: z.string().nullable(),
  method: z.string().nullable(),
  referenceNo: z.string().nullable(),

  createdAt: z.string(),
  capabilities: rowCapabilitiesSchema,
});
export type PaymentRow = z.infer<typeof paymentRowSchema>;

export const paymentDetailSchema = paymentRowSchema.omit({
  partyName: true,
  companyName: true,
  siteName: true,
  siteGroupName: true,
  capabilities: true,
});
export type PaymentDetail = z.infer<typeof paymentDetailSchema>;

/**
 * One payment.
 *
 * The legacy screen posts an ARRAY — `InsertPayOutDetailsReport` collects every
 * row of a repeater and `AddSupplierInvoice` loops it — so several payments to
 * one supplier are recorded in a single click. That is a real convenience for
 * settling a month of site deliveries at once and it is kept, as
 * `createPaymentBatchSchema` below. This is one element of it.
 */
export const createPaymentSchema = z
  .object({
    direction: z.enum(PAYMENT_DIRECTIONS).default("out"),
    kind: z.enum(PAYMENT_KINDS).default("payment"),

    partyId: uuidId,
    companyId: uuidId,
    siteId: optionalUuidId,
    siteGroupId: optionalUuidId,

    paymentDate: optionalDate,

    /**
     * POSITIVE, and refused otherwise.
     *
     * The source validates only that the box is not empty
     * (`PayOutScript.js:714`), so a negative amount posts and lands in
     * `TotalAmount` — where the ledger then subtracts it, turning a payment into
     * a charge. Nothing on the screen would show that had happened.
     */
    amount: money("Amount"),

    description: optionalText(500),
    method: optionalText(100),
    referenceNo: optionalText(100),
  })
  .superRefine((value, ctx) => {
    // The source's own rule, read off the two branches of its validation: a
    // payment needs a site and an opening balance does not. Reproduced, because
    // it is a real distinction rather than an oversight — a brought-forward
    // balance belongs to the party.
    if (value.kind === "payment" && value.siteId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["siteId"],
        message: "Choose the site this payment is for",
      });
    }
    if (Number.parseFloat(value.amount) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: "The amount must be more than zero",
      });
    }
  });
export type CreatePayment = z.infer<typeof createPaymentSchema>;

/**
 * The repeater, posted as one request.
 *
 * Capped at 50. The source has no cap and builds one entity per row in a single
 * `SaveChangesAsync`, so a runaway client could write unboundedly; 50 is well
 * past what a person keys in one sitting.
 */
export const createPaymentBatchSchema = z.object({
  payments: z.array(createPaymentSchema).min(1, "Add at least one payment").max(50),
});
export type CreatePaymentBatch = z.infer<typeof createPaymentBatchSchema>;

export const updatePaymentSchema = z.object({
  siteId: optionalUuidId.optional(),
  siteGroupId: optionalUuidId.optional(),
  paymentDate: optionalDate.optional(),
  amount: money("Amount").optional(),
  description: optionalText(500).optional(),
  method: optionalText(100).optional(),
  referenceNo: optionalText(100).optional(),
});
export type UpdatePayment = z.infer<typeof updatePaymentSchema>;

/**
 * `direction` and `kind` are ABSENT from the update contract, deliberately.
 *
 * Turning a payment into an opening balance, or an outgoing payment into an
 * incoming one, moves a supplier balance by twice the amount with nothing on
 * screen to say it happened. The source cannot express the change either — its
 * update path writes neither column — so this is the source's behaviour, made
 * explicit rather than incidental.
 */
export const PAYMENT_SORT_FIELDS = ["paymentDate", "amount", "createdAt"] as const;
export type PaymentSortField = (typeof PAYMENT_SORT_FIELDS)[number];

export const paymentBatchResultSchema = z.object({
  created: z.number().int().nonnegative(),
});
export type PaymentBatchResult = z.infer<typeof paymentBatchResultSchema>;
