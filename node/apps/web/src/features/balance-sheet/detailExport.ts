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
 *   INCOME             company by company, every entry with its date; each
 *                      company's total, then the income total
 *   SUPPLIER PAYMENTS  the same, company by company (client, 27 Oct 2026)
 *   SALARY             company by company, month by month, each employee with the
 *                      day paid; each month's and company's total, then the total
 *   BALANCE            income - supplier payments - salary
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
  { header: "Company", width: 26, align: "left" },
  { header: "Paid on", width: 14, align: "left" },
  { header: "Amount", width: 18, align: "right" },
];
const WIDTH = COLUMNS.length;

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
/** The companies among the entries, by name. */
const companiesOf = (entries: { companyName: string }[]) => [...new Set(entries.map((one) => one.companyName))].sort((a, b) => a.localeCompare(b));

/** One project's rows, as the sheet reads top to bottom. */
export function projectBlock(projectName: string, detail: BalanceSheetDetail, heading: string[]): string[][] {
  const rows: string[][] = [];
  const line = (first: string, label = "", company = "", paidOn = "", amount = "") => rows.push([first, label, company, paidOn, amount]);
  const total = (label: string, amount: bigint) => line("", label, "", "", rupees(amount));
  line(projectName.toUpperCase());
  for (const text of heading) line(text);
  line("");

  // ---- income, company by company ----
  line("INCOME");
  for (const company of companiesOf(detail.incomes)) {
    const entries = detail.incomes.filter((one) => one.companyName === company).sort((a, b) => byDate(a.incomeDate, b.incomeDate));
    for (const one of entries) line(formatExportDate(one.incomeDate), one.clientName, company, "", one.total);
    total(`Total ${company}`, sum(entries.map((one) => one.total)));
  }
  if (detail.incomes.length === 0) line("", "No income");
  const income = sum(detail.incomes.map((one) => one.total));
  total("TOTAL INCOME", income);
  line("");

  // ---- supplier payments, company by company ----
  line("SUPPLIER PAYMENTS");
  for (const company of companiesOf(detail.suppliers)) {
    const entries = detail.suppliers.filter((one) => one.companyName === company).sort((a, b) => byDate(a.paymentDate, b.paymentDate));
    for (const one of entries) line(formatExportDate(one.paymentDate), one.partyName, company, "", one.amount);
    total(`Total ${company}`, sum(entries.map((one) => one.amount)));
  }
  if (detail.suppliers.length === 0) line("", "No payments");
  const paid = sum(detail.suppliers.map((one) => one.amount));
  total("TOTAL SUPPLIER PAYMENTS", paid);
  line("");

  // ---- salary, company by company, month by month ----
  line("SALARY");
  for (const company of companiesOf(detail.salaries)) {
    const ofCompany = detail.salaries.filter((one) => one.companyName === company);
    for (const month of [...new Set(ofCompany.map((one) => one.month))].sort()) {
      const entries = ofCompany.filter((one) => one.month === month).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
      for (const one of entries) line(monthLabel(month), one.employeeName, company, formatExportDate(one.paymentDate), one.amount);
      total(`Total ${monthLabel(month)}`, sum(entries.map((one) => one.amount)));
    }
    total(`Total ${company}`, sum(ofCompany.map((one) => one.amount)));
  }
  if (detail.salaries.length === 0) line("", "No salary");
  const salary = sum(detail.salaries.map((one) => one.amount));
  total("TOTAL SALARY", salary);
  line("");

  // ---- balance ----
  line("BALANCE");
  total("Income", income);
  total("Less: supplier payments", -paid);
  total("Less: salary", -salary);
  total("BALANCE (income - payments - salary)", income - paid - salary);
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
    const stacked = blocks.flatMap((block, i) => (i === 0 ? block.rows : [Array<string>(WIDTH).fill(""), Array<string>(WIDTH).fill(""), ...block.rows]));
    sheets.push({ sheetName: "Details", columns: COLUMNS, rows: stacked });
  }
  await downloadWorkbook(sheets, fileName);
}
