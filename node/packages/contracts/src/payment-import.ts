import { z } from "zod";

/**
 * "Import payments" on Payments (client, 23 Oct 2026): many payments, on many
 * dates, for many suppliers and companies, keyed into one spreadsheet and
 * recorded together. ONE ROW PER PAYMENT.
 *
 * As the invoice import: nothing is saved until the preview has been looked at,
 * and the import is accepted only for a file that still comes to the count and
 * total that were verified. All or nothing. A row that repeats a payment already
 * recorded (same party, company, site, date, amount and reference) is refused, so
 * a file imported twice cannot pay twice.
 */
export const PAYMENT_IMPORT_COLUMNS = [
  { key: "date", header: "Date", required: true, note: "dd-mm-yyyy" },
  { key: "party", header: "Supplier", required: true, note: "As in Suppliers (the customer, for money received)" },
  { key: "company", header: "Company", required: true, note: "As in Companies" },
  { key: "site", header: "Site", required: true, note: "As in Sites" },
  { key: "siteLocation", header: "Site location", required: false, note: "A location of that site" },
  { key: "amount", header: "Amount", required: true, note: "More than zero" },
  { key: "method", header: "Method", required: false, note: "Cash, Cheque, NEFT, RTGS, UPI" },
  { key: "referenceNo", header: "Reference no", required: false, note: "Cheque or UTR number" },
  { key: "description", header: "Description", required: false, note: "" },
] as const;

export const PAYMENT_IMPORT_MAX_ROWS = 1_000;

const errorSchema = z.object({
  /** The spreadsheet row, as Excel's gutter shows it. 1 is the heading row. */
  row: z.number().int().nonnegative(),
  column: z.string().nullable(),
  message: z.string(),
});

export const paymentImportRowSchema = z.object({
  row: z.number().int().positive(),
  date: z.string().nullable(),
  party: z.string(),
  company: z.string(),
  site: z.string(),
  amount: z.string(),
  method: z.string().nullable(),
  referenceNo: z.string().nullable(),
});
export type PaymentImportRow = z.infer<typeof paymentImportRowSchema>;

export const paymentImportPreviewSchema = z.object({
  rowCount: z.number().int().nonnegative(),
  paymentCount: z.number().int().nonnegative(),
  total: z.string(),
  payments: z.array(paymentImportRowSchema),
  /** Any error means the file cannot be imported. */
  errors: z.array(errorSchema),
});
export type PaymentImportPreview = z.infer<typeof paymentImportPreviewSchema>;

export const paymentImportResultSchema = z.object({
  created: z.number().int().nonnegative(),
  total: z.string(),
});
export type PaymentImportResult = z.infer<typeof paymentImportResultSchema>;

/**
 * DELETE SEVERAL PAYMENTS AT ONCE (client, 23 Oct 2026), for whoever may delete
 * a payment, after a confirmation. A payment made by a confirmed payout list is
 * refused: reversing the list is what takes it back with its bills.
 */
export const PAYMENT_DELETE_MAX = 500;
export const deletePaymentsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Tick at least one payment").max(PAYMENT_DELETE_MAX),
});
export type DeletePayments = z.infer<typeof deletePaymentsSchema>;
export const deletePaymentsResultSchema = z.object({ deleted: z.number().int().nonnegative() });
export type DeletePaymentsResult = z.infer<typeof deletePaymentsResultSchema>;
