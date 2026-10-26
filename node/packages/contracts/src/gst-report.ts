import { z } from "zod";

/**
 * INPUT GST, for the month's return (client, 22 Oct 2026: "the CA needs input
 * GST supplier by supplier every month, to match GSTR-2B").
 *
 * Read from the purchase invoices' own lines: the taxable value is each line's
 * net amount (after discount) and the tax its GST amount, both already stored —
 * on the live data every bill's lines add up to its subtotal and its GST.
 *
 * CGST + SGST OR IGST is not stored; it follows from the two GSTINs. The first
 * two characters are the state: the same state is CGST and SGST, half each; a
 * different state is IGST. A supplier or company without a valid GSTIN cannot be
 * placed, is counted as CGST + SGST, and is listed under `warnings` — a bill
 * like that will not match 2B however it is split.
 *
 * Credit notes and purchase returns count NEGATIVE.
 */
export const gstReportQuerySchema = z.object({
  companyId: z.string().uuid().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type GstReportQuery = z.infer<typeof gstReportQuerySchema>;

const taxes = {
  taxable: z.string(),
  cgst: z.string(),
  sgst: z.string(),
  igst: z.string(),
  totalGst: z.string(),
};

/** One bill at one GST rate: a bill with 18% and 5% lines is two rows, as 2B lists it. */
export const gstBillRowSchema = z.object({
  invoiceId: z.string(),
  billNo: z.string(),
  ourNo: z.string().nullable(),
  date: z.string().nullable(),
  invoiceType: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  supplierGstin: z.string().nullable(),
  companyName: z.string(),
  companyGstin: z.string().nullable(),
  gstPercent: z.string(),
  interState: z.boolean(),
  ...taxes,
});
export type GstBillRow = z.infer<typeof gstBillRowSchema>;

export const gstSupplierRowSchema = z.object({
  supplierId: z.string(),
  supplierName: z.string(),
  supplierGstin: z.string().nullable(),
  billCount: z.number().int(),
  ...taxes,
});
export type GstSupplierRow = z.infer<typeof gstSupplierRowSchema>;

export const gstRateRowSchema = z.object({ gstPercent: z.string(), ...taxes });
export type GstRateRow = z.infer<typeof gstRateRowSchema>;

export const GST_WARNINGS = ["supplier-gstin-missing", "supplier-gstin-invalid", "company-gstin-missing"] as const;

export const gstWarningSchema = z.object({
  problem: z.enum(GST_WARNINGS),
  name: z.string(),
  gstin: z.string().nullable(),
  billCount: z.number().int(),
});
export type GstWarning = z.infer<typeof gstWarningSchema>;

/**
 * PAID-WISE (client, 26 Oct 2026: "how much GST is in the payments made on
 * these dates"). One row per payment made in the dates, whatever the date of
 * the bills it paid. A payment pays the bills it names first and then the
 * oldest bills of the same supplier, site and company, as the Pending
 * Outstanding report reads it; returns and credit notes take off the oldest
 * bills in the same way. The GST in a payment is the GST of each bill it paid,
 * in proportion: half a bill paid is half its GST.
 *
 * `unsettled` is what was paid beyond the bills (an advance), which carries no
 * GST yet; an opening balance paid off carries none either.
 */
export const gstPaidRowSchema = z.object({
  paymentId: z.string(),
  date: z.string().nullable(),
  supplierId: z.string(),
  supplierName: z.string(),
  supplierGstin: z.string().nullable(),
  companyName: z.string(),
  siteName: z.string().nullable(),
  referenceNo: z.string().nullable(),
  amount: z.string(),
  /** The bills this payment paid, by their number. */
  billNos: z.array(z.string()),
  unsettled: z.string(),
  ...taxes,
});
export type GstPaidRow = z.infer<typeof gstPaidRowSchema>;

export const gstReportSchema = z.object({
  bills: z.array(gstBillRowSchema),
  suppliers: z.array(gstSupplierRowSchema),
  rates: z.array(gstRateRowSchema),
  totals: z.object({ billCount: z.number().int(), ...taxes }),
  warnings: z.array(gstWarningSchema),
  paid: z.array(gstPaidRowSchema),
  paidTotals: z.object({ paymentCount: z.number().int(), amount: z.string(), unsettled: z.string(), ...taxes }),
});
export type GstReport = z.infer<typeof gstReportSchema>;

/** The GSTIN's shape: 2-digit state, PAN, entity number, Z, check character. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

export const normaliseGstin = (value: string | null | undefined): string | null => {
  const clean = (value ?? "").replace(/\s+/g, "").toUpperCase();
  return clean === "" ? null : clean;
};
