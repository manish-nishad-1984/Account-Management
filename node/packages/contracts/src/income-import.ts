import { z } from "zod";

/**
 * "Import income" on the Balance Sheet (client, 26 Oct 2026): many income
 * entries, for many projects, clients and companies, from one spreadsheet.
 * ONE ROW PER ENTRY, with at most one addition and one deduction; an entry with
 * more is keyed in, or corrected after the import.
 *
 * As the payment import: nothing is saved until the preview has been looked at,
 * and the import is accepted only for a file that still comes to the count and
 * total that were verified. All or nothing. A row that repeats an entry already
 * recorded (same client, company, site, date, amount and reference) is refused,
 * so a file imported twice cannot count twice.
 */
export const INCOME_IMPORT_COLUMNS = [
  { key: "date", header: "Date", required: true, note: "dd-mm-yyyy" },
  { key: "client", header: "Client", required: true, note: "As in Clients" },
  { key: "company", header: "Company", required: true, note: "As in Companies" },
  { key: "site", header: "Site", required: true, note: "As in Sites (the project)" },
  { key: "amount", header: "Amount", required: true, note: "More than zero" },
  { key: "addition", header: "Addition", required: false, note: "Extra work, GST…" },
  { key: "additionRemark", header: "Addition remark", required: false, note: "" },
  { key: "deduction", header: "Deduction", required: false, note: "TDS, retention…" },
  { key: "deductionRemark", header: "Deduction remark", required: false, note: "" },
  { key: "method", header: "Method", required: false, note: "Cash, Cheque, NEFT, RTGS, UPI" },
  { key: "referenceNo", header: "Reference no", required: false, note: "Cheque or UTR number" },
  { key: "note", header: "Note", required: false, note: "" },
] as const;

export const INCOME_IMPORT_MAX_ROWS = 1_000;

const errorSchema = z.object({
  /** The spreadsheet row, as Excel's gutter shows it. 1 is the heading row. */
  row: z.number().int().nonnegative(),
  column: z.string().nullable(),
  message: z.string(),
});

export const incomeImportRowSchema = z.object({
  row: z.number().int().positive(),
  date: z.string().nullable(),
  client: z.string(),
  company: z.string(),
  site: z.string(),
  amount: z.string(),
  /** amount + addition - deduction; null while the row has a problem. */
  total: z.string().nullable(),
  method: z.string().nullable(),
  referenceNo: z.string().nullable(),
});
export type IncomeImportRow = z.infer<typeof incomeImportRowSchema>;

export const incomeImportPreviewSchema = z.object({
  rowCount: z.number().int().nonnegative(),
  incomeCount: z.number().int().nonnegative(),
  /** The Final Totals added up: what the balance sheet will count. */
  total: z.string(),
  incomes: z.array(incomeImportRowSchema),
  /** Any error means the file cannot be imported. */
  errors: z.array(errorSchema),
});
export type IncomeImportPreview = z.infer<typeof incomeImportPreviewSchema>;

export const incomeImportResultSchema = z.object({
  created: z.number().int().nonnegative(),
  total: z.string(),
});
export type IncomeImportResult = z.infer<typeof incomeImportResultSchema>;
