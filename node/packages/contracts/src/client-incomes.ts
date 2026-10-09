import { z } from "zod";
import { money, optionalText, uuidId } from "./fields";
import { rowCapabilitiesSchema } from "./pagination";

/**
 * Income (client request, 9 Oct 2026): money a project's client has paid us.
 *
 * The client pays the boss, part by part, for a project; each payment is one
 * entry here, for a SITE (the project), the COMPANY it was received in, and the
 * CLIENT who paid. The site and the company are independent - the application has
 * never tied a company to a site - so both are chosen.
 *
 *   FINAL TOTAL = amount + additions - deductions
 *
 * Additions (extra work, GST...) and deductions (TDS, retention, discount...) are
 * any number of lines, each with an amount and a remark. The server works the
 * total out; the one the screen shows is only a preview. The FINAL TOTAL is what
 * counts as the project's income in the balance sheet.
 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const positive = (label: string) =>
  money(label).refine((value) => Number.parseFloat(value) > 0, {
    message: "The amount must be more than zero",
  });

export const incomeAdjustmentSchema = z.object({
  amount: positive("Amount"),
  remark: optionalText(200),
});
export type IncomeAdjustment = z.infer<typeof incomeAdjustmentSchema>;

export const createClientIncomeSchema = z.object({
  incomeDate: z.string().trim().regex(DATE_PATTERN, "Enter the date received"),
  siteId: uuidId,
  companyId: uuidId,
  clientId: uuidId,
  amount: positive("Amount"),
  additions: z.array(incomeAdjustmentSchema).max(50).default([]),
  deductions: z.array(incomeAdjustmentSchema).max(50).default([]),
  method: optionalText(100),
  referenceNo: optionalText(100),
  note: optionalText(1000),
});
export type CreateClientIncome = z.infer<typeof createClientIncomeSchema>;
export const updateClientIncomeSchema = createClientIncomeSchema;
export type UpdateClientIncome = CreateClientIncome;

export const clientIncomeRowSchema = z.object({
  id: z.string(),
  incomeDate: z.string(),
  siteId: z.string(),
  siteName: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  amount: z.string(),
  additionalTotal: z.string(),
  deductionTotal: z.string(),
  /** amount + additions - deductions, worked out on the server. */
  total: z.string(),
  method: z.string().nullable(),
  referenceNo: z.string().nullable(),
  createdAt: z.string(),
  capabilities: rowCapabilitiesSchema,
});
export type ClientIncomeRow = z.infer<typeof clientIncomeRowSchema>;

const adjustmentOutSchema = z.object({ amount: z.string(), remark: z.string().nullable() });

export const clientIncomeDetailSchema = clientIncomeRowSchema
  .omit({ capabilities: true, siteName: true, companyName: true, clientName: true })
  .extend({
    note: z.string().nullable(),
    additions: z.array(adjustmentOutSchema),
    deductions: z.array(adjustmentOutSchema),
  });
export type ClientIncomeDetail = z.infer<typeof clientIncomeDetailSchema>;

export const CLIENT_INCOME_SORT_FIELDS = ["incomeDate", "total", "createdAt"] as const;

/** The filters the Income list takes besides the common list query. */
export const clientIncomeFilterSchema = z.object({
  siteId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
});
export type ClientIncomeFilter = z.infer<typeof clientIncomeFilterSchema>;
