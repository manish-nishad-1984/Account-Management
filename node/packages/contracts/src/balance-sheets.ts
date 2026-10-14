import { z } from "zod";
import { optionalText, optionalUuidId } from "./fields";
import { rowCapabilitiesSchema } from "./pagination";
import { balanceSheetRowSchema } from "./balance-sheet";

/**
 * Saved Balance Sheets (client request, 14 Oct 2026): the person chooses a
 * company, the dates of the INCOME to count and the dates of the INVOICES to
 * count, the sheet is worked out project by project, and it is kept.
 *
 * Like a payout list, a sheet is KEPT AS IT WAS WORKED OUT: the figures are
 * stored with it, so a sheet made in October still reads the same in December
 * when more invoices have been entered. Editing one works it out afresh.
 *
 * "Invoice dates" bound the expense side: both the bills raised AND the payments
 * made in that period, by their own dates, the way the report's single date range
 * already did.
 */

const dateOnly = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
    .nullable()
    .optional()
    .transform((value) => value ?? null),
);

/** What a person fills in; the server works the figures out and never takes them from here. */
export const createBalanceSheetSchema = z
  .object({
    title: optionalText(120),
    /** None means every company. */
    companyId: optionalUuidId,
    /** None means every site. */
    siteId: optionalUuidId,
    incomeFrom: dateOnly,
    incomeTo: dateOnly,
    invoiceFrom: dateOnly,
    invoiceTo: dateOnly,
    note: optionalText(1000),
  })
  .superRefine((value, ctx) => {
    for (const [from, to, label] of [
      ["incomeFrom", "incomeTo", "Income"],
      ["invoiceFrom", "invoiceTo", "Invoice"],
    ] as const) {
      if (value[from] && value[to] && value[from]! > value[to]!) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [to],
          message: `${label} "to" date is before its "from" date`,
        });
      }
    }
  });
export type CreateBalanceSheet = z.infer<typeof createBalanceSheetSchema>;

export const updateBalanceSheetSchema = createBalanceSheetSchema;
export type UpdateBalanceSheet = CreateBalanceSheet;

export const balanceSheetFiguresSchema = z.object({
  income: z.string(),
  billed: z.string(),
  paid: z.string(),
  stillToPay: z.string(),
  cashBalance: z.string(),
  projectResult: z.string(),
});

export const savedBalanceSheetRowSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  companyId: z.string().nullable(),
  /** Null for a sheet across every company. */
  companyName: z.string().nullable(),
  siteId: z.string().nullable(),
  /** Null for a sheet across every site. */
  siteName: z.string().nullable(),
  incomeFrom: z.string().nullable(),
  incomeTo: z.string().nullable(),
  invoiceFrom: z.string().nullable(),
  invoiceTo: z.string().nullable(),
  /** How many projects the sheet has a row for. */
  projectCount: z.number().int().nonnegative(),
  figures: balanceSheetFiguresSchema,
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  updatedByName: z.string().nullable(),
  capabilities: rowCapabilitiesSchema,
});
export type SavedBalanceSheetRow = z.infer<typeof savedBalanceSheetRowSchema>;

export const savedBalanceSheetDetailSchema = savedBalanceSheetRowSchema.omit({ capabilities: true }).extend({
  note: z.string().nullable(),
  rows: z.array(balanceSheetRowSchema),
});
export type SavedBalanceSheetDetail = z.infer<typeof savedBalanceSheetDetailSchema>;

/** The sheet as it WOULD be, for the form's "Generate": nothing is saved. */
export const balanceSheetPreviewSchema = z.object({
  rows: z.array(balanceSheetRowSchema),
  totals: balanceSheetFiguresSchema,
});
export type BalanceSheetPreview = z.infer<typeof balanceSheetPreviewSchema>;
