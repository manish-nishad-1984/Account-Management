import { z } from "zod";
import { ifscCode, mobileNo, money, optionalDate, optionalText, requiredText, uuidId } from "./fields";
import { rowCapabilitiesSchema } from "./pagination";

/**
 * THE EMPLOYEE MASTER (client request, 23 Oct 2026): the people on the payroll,
 * with what each is paid a month.
 *
 * An employee works for ONE COMPANY, and for a site (project) when there is one,
 * so the salary lands in that company's Balance Sheet under the project. The
 * month's salary is BASIC + ADDITIONS - DEDUCTIONS, the additions and deductions
 * being the fixed ones kept here; a month that differs (leave, an advance, a
 * bonus) is changed on the payout list before it is confirmed.
 *
 * Only an ACTIVE employee is offered for salary. Bank details are in the detail,
 * not in the list rows, as with companies.
 */
export const SALARY_ITEM_KINDS = ["addition", "deduction"] as const;
export type SalaryItemKind = (typeof SALARY_ITEM_KINDS)[number];

const positiveMoney = (label: string) =>
  money(label).refine((value) => Number.parseFloat(value) > 0, { message: `${label} must be more than zero` });
const nonNegativeMoney = (label: string) =>
  money(label).refine((value) => Number.parseFloat(value) >= 0, { message: `${label} cannot be negative` });

export const salaryItemSchema = z.object({
  kind: z.enum(SALARY_ITEM_KINDS),
  label: requiredText("Name", 80),
  amount: positiveMoney("Amount"),
});
export type SalaryItem = z.infer<typeof salaryItemSchema>;

export const employeeRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  mobile: z.string().nullable(),
  companyId: z.string(),
  companyName: z.string(),
  siteId: z.string().nullable(),
  siteName: z.string().nullable(),
  joinDate: z.string().nullable(),
  basicSalary: z.string(),
  additions: z.string(),
  deductions: z.string(),
  /** Basic + additions - deductions: what a month is paid unless changed on the list. */
  netSalary: z.string(),
  isActive: z.boolean(),
  capabilities: rowCapabilitiesSchema,
});
export type EmployeeRow = z.infer<typeof employeeRowSchema>;

export const employeeDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  mobile: z.string().nullable(),
  address: z.string().nullable(),
  companyId: z.string(),
  siteId: z.string().nullable(),
  joinDate: z.string().nullable(),
  bankName: z.string().nullable(),
  accountHolder: z.string().nullable(),
  accountNo: z.string().nullable(),
  ifscCode: z.string().nullable(),
  basicSalary: z.string(),
  items: z.array(salaryItemSchema),
  isActive: z.boolean(),
  note: z.string().nullable(),
});
export type EmployeeDetail = z.infer<typeof employeeDetailSchema>;

export const createEmployeeSchema = z.object({
  name: requiredText("Employee name", 200),
  mobile: mobileNo,
  address: optionalText(500),
  companyId: uuidId,
  siteId: z.string().uuid().nullable().optional().transform((value) => value ?? null),
  joinDate: optionalDate,
  bankName: optionalText(120),
  accountHolder: optionalText(120),
  accountNo: optionalText(40),
  ifscCode,
  basicSalary: nonNegativeMoney("Basic salary"),
  items: z.array(salaryItemSchema).max(30).default([]),
  isActive: z.boolean().default(true),
  note: optionalText(1000),
});
export type CreateEmployee = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = createEmployeeSchema;
export type UpdateEmployee = CreateEmployee;

export const EMPLOYEE_SORT_FIELDS = ["name", "createdAt"] as const;

/** `YYYY-MM`, the month a salary is for. */
export const SALARY_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const salaryMonth = z.string().trim().regex(SALARY_MONTH_PATTERN, "Choose the month");

/**
 * A month's salary still to be paid, offered on the payout list (client, 23 Oct
 * 2026: "we pay on the 7th"). A list dated in a month offers the months BEFORE
 * it, from the employee's first month, that have no salary paid yet: in
 * November, October's salary; once it is paid, nothing until December, when
 * November's comes up. A month skipped stays offered until it is paid.
 */
export const salaryDueSchema = z.object({
  employeeId: z.string(),
  employeeName: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  siteName: z.string().nullable(),
  month: z.string(),
  basicSalary: z.string(),
  additions: z.string(),
  deductions: z.string(),
  netSalary: z.string(),
});
export type SalaryDue = z.infer<typeof salaryDueSchema>;
export const salaryDueResponseSchema = z.object({ rows: z.array(salaryDueSchema) });
export type SalaryDueResponse = z.infer<typeof salaryDueResponseSchema>;
