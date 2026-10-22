import { z } from "zod";

/**
 * The site-wise Balance Sheet (client request, 9 Oct 2026): for each project, what
 * came in and what went out.
 *
 *   INCOME       the Final Totals of the Income entries (money the client paid us)
 *   BILLED       what suppliers have billed for the project: purchase invoices
 *                less returns and credit notes. Opening balances are not a
 *                project's cost and are left out.
 *   PAID         payments made to suppliers for the project
 *   STILL TO PAY billed - paid
 *
 *   CASH BALANCE   income - paid     what is actually in hand for the project
 *   PROJECT RESULT income - billed   where the project stands once the dues are met
 *
 * Both balances are given because "expense" can mean either, and which the boss
 * wants first is his to say; showing both loses nothing.
 */
export const balanceSheetQuerySchema = z.object({
  siteId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});
export type BalanceSheetQuery = z.infer<typeof balanceSheetQuerySchema>;

/**
 * One project's detail. A saved Balance Sheet counts income over one range of
 * dates and bills and payments over another, so its detail may say both; when
 * it does not, `fromDate`/`toDate` serve for both, as on the report.
 */
export const balanceSheetDetailQuerySchema = balanceSheetQuerySchema.omit({ siteId: true }).extend({
  incomeFrom: z.string().optional(),
  incomeTo: z.string().optional(),
  invoiceFrom: z.string().optional(),
  invoiceTo: z.string().optional(),
});
export type BalanceSheetDetailQuery = z.infer<typeof balanceSheetDetailQuerySchema>;

const figures = {
  income: z.string(),
  billed: z.string(),
  paid: z.string(),
  stillToPay: z.string(),
  cashBalance: z.string(),
  projectResult: z.string(),
};

export const balanceSheetRowSchema = z.object({
  /** Null for money with no project (an invoice saved without a site). */
  siteId: z.string().nullable(),
  siteName: z.string(),
  ...figures,
});
export type BalanceSheetRow = z.infer<typeof balanceSheetRowSchema>;

export const balanceSheetResponseSchema = z.object({
  rows: z.array(balanceSheetRowSchema),
  totals: z.object(figures),
});
export type BalanceSheetResponse = z.infer<typeof balanceSheetResponseSchema>;

/**
 * What lies behind one project's row: its income entries and, beside them, the
 * payments made to suppliers for it, one row each with its date (client,
 * 22 Oct 2026: "sirf supplier, date, paid amount").
 */
export const balanceSheetDetailSchema = z.object({
  incomes: z.array(
    z.object({
      id: z.string(),
      incomeDate: z.string(),
      clientName: z.string(),
      companyName: z.string(),
      total: z.string(),
    }),
  ),
  suppliers: z.array(
    z.object({
      id: z.string(),
      partyId: z.string(),
      partyName: z.string(),
      paymentDate: z.string().nullable(),
      amount: z.string(),
    }),
  ),
});
export type BalanceSheetDetail = z.infer<typeof balanceSheetDetailSchema>;
