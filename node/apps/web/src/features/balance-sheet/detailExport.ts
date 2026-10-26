import {
  balanceSheetDetailSchema,
  formatExportDate,
  type BalanceSheetDetail,
  type BalanceSheetRow,
  type GridWorkbookSheet,
} from "@accountmanagement/contracts";
import { apiRequest } from "../../lib/api-client";
import { downloadWorkbook } from "../../lib/grid-export";
import { monthLabel } from "../payouts/message";
import type { BalanceSheetDetailFilters } from "./api";

/**
 * THE BALANCE SHEET IN EXCEL, WITH ITS DETAIL (client, 27 Oct 2026). For each
 * project, top to bottom:
 *
 *   INCOME          every entry, company by company, with its date; each company's
 *                   total, then the income total
 *   SUPPLIER PAYMENTS  every payment with its date, and their total
 *   SALARY          month by month, each employee with the day paid; each month's
 *                   total, then the salary total
 *   BALANCE         income - supplier payments - salary
 *
 * The balance is the sheet's Cash balance, worked out the same way. A Summary
 * sheet of every project comes first. One sheet per project; past what one file
 * may hold, the projects stack in one Details sheet instead.
 */

/** Excel's limit is 30 sheets a file here; one goes to the Summary. */
const MAX_PROJECT_SHEETS = 29;

const COLUMNS: GridWorkbookSheet["columns"] = [
  { header: "Date / Month", width: 16, align: "left" },
  { header: "Client / Supplier / Employee", width: 36, align: "left" },
  { header: "Company / Paid on", width: 26, align: "left" },
  { header: "Amount", width: 18, align: "right" },
];

/** Exact money on whole paise; a detail amount may be negative after deductions. */
const paise = (value: string): bigint => {
  const text = value.trim();
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = text.replace("-", "").split(".");
  return (negative ? -1n : 1n) * (BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2)));
};
const rupees = (value: bigint): string => {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  return `${negative ? "-" : ""}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;
};
const sum = (values: string[]) => values.reduce((total, value) => total + paise(value), 0n);
const byDate = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "");

/** One project's rows, as the sheet reads top to bottom. */
export function projectBlock(projectName: string, detail: BalanceSheetDetail, heading: string[]): string[][] {
  const rows: string[][] = [];
  const blank = () => rows.push(["", "", "", ""]);
  rows.push([projectName.toUpperCase(), "", "", ""]);
  for (const line of heading) rows.push([line, "", "", ""]);
  blank();

  // ---- income, company by company ----
  rows.push(["INCOME", "", "", ""]);
  const companies = [...new Set(detail.incomes.map((one) => one.companyName))].sort((a, b) => a.localeCompare(b));
  for (const company of companies) {
    const entries = detail.incomes.filter((one) => one.companyName === company).sort((a, b) => byDate(a.incomeDate, b.incomeDate));
    for (const one of entries) rows.push([formatExportDate(one.incomeDate), one.clientName, company, one.total]);
    rows.push(["", `Total ${company}`, "", rupees(sum(entries.map((one) => one.total)))]);
  }
  if (companies.length === 0) rows.push(["", "No income", "", ""]);
  const income = sum(detail.incomes.map((one) => one.total));
  rows.push(["", "TOTAL INCOME", "", rupees(income)]);
  blank();

  // ---- supplier payments ----
  rows.push(["SUPPLIER PAYMENTS", "", "", ""]);
  const payments = [...detail.suppliers].sort((a, b) => byDate(a.paymentDate, b.paymentDate));
  for (const one of payments) rows.push([formatExportDate(one.paymentDate), one.partyName, "", one.amount]);
  if (payments.length === 0) rows.push(["", "No payments", "", ""]);
  const paid = sum(payments.map((one) => one.amount));
  rows.push(["", "TOTAL SUPPLIER PAYMENTS", "", rupees(paid)]);
  blank();

  // ---- salary, month by month ----
  rows.push(["SALARY", "", "", ""]);
  const months = [...new Set(detail.salaries.map((one) => one.month))].sort();
  for (const month of months) {
    const entries = detail.salaries.filter((one) => one.month === month).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    for (const one of entries) rows.push([monthLabel(month), one.employeeName, `Paid ${formatExportDate(one.paymentDate)}`, one.amount]);
    rows.push(["", `Total ${monthLabel(month)}`, "", rupees(sum(entries.map((one) => one.amount)))]);
  }
  if (months.length === 0) rows.push(["", "No salary", "", ""]);
  const salary = sum(detail.salaries.map((one) => one.amount));
  rows.push(["", "TOTAL SALARY", "", rupees(salary)]);
  blank();

  // ---- balance ----
  rows.push(["BALANCE", "", "", ""]);
  rows.push(["", "Income", "", rupees(income)]);
  rows.push(["", "Less: supplier payments", "", rupees(-paid)]);
  rows.push(["", "Less: salary", "", rupees(-salary)]);
  rows.push(["", "BALANCE (income - payments - salary)", "", rupees(income - paid - salary)]);
  return rows;
}

/** Fetches each project's detail and writes the workbook. */
export async function exportBalanceSheetDetails({
  rows,
  summary,
  filters,
  heading,
  fileName,
}: {
  rows: BalanceSheetRow[];
  /** The Summary sheet, as the plain export writes it. */
  summary: GridWorkbookSheet;
  filters: BalanceSheetDetailFilters;
  /** What the sheet covers: company and dates, one line each. */
  heading: string[];
  fileName: string;
}): Promise<void> {
  const projects = rows.filter((row): row is BalanceSheetRow & { siteId: string } => row.siteId !== null);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) search.set(key, value);
  const query = search.toString() ? `?${search.toString()}` : "";

  // A few at a time, so a long list does not open fifty requests at once.
  const details: BalanceSheetDetail[] = [];
  for (let i = 0; i < projects.length; i += 5) {
    const batch = projects.slice(i, i + 5);
    details.push(
      ...(await Promise.all(
        batch.map((row) => apiRequest<BalanceSheetDetail>(`/balance-sheet/site/${row.siteId}${query}`, { schema: balanceSheetDetailSchema })),
      )),
    );
  }
  const blocks = projects.map((row, i) => ({ name: row.siteName, rows: projectBlock(row.siteName, details[i]!, heading) }));

  const sheets: GridWorkbookSheet[] = [summary];
  if (blocks.length <= MAX_PROJECT_SHEETS) {
    const used = new Set<string>();
    for (const block of blocks) {
      // Excel: at most 31 characters, none of : \ / ? * [ ], and no two alike.
      const base = block.name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 28) || "Project";
      let name = base;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 25)} (${n})`;
      used.add(name.toLowerCase());
      sheets.push({ sheetName: name, columns: COLUMNS, rows: block.rows });
    }
  } else {
    const stacked = blocks.flatMap((block, i) => (i === 0 ? block.rows : [["", "", "", ""], ["", "", "", ""], ...block.rows]));
    sheets.push({ sheetName: "Details", columns: COLUMNS, rows: stacked });
  }
  await downloadWorkbook(sheets, fileName);
}
