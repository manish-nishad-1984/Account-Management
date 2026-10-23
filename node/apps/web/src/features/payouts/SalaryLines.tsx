import type { PayoutListDetail, SalaryDue } from "@accountmanagement/contracts";
import { formatMoney } from "../../lib/format";
import { AmountField } from "./AmountField";
import { sumAmounts } from "./decimal";

import { monthLabel } from "./message";

export { monthLabel };

/** One salary the list can carry: due now, or saved on the list before. */
export interface SalaryRow {
  key: string;
  employeeId: string;
  employeeName: string;
  siteName: string | null;
  month: string;
  /** What the master says the month pays; for a saved salary no longer due, what was saved. */
  netSalary: string;
}

/** What is ticked: the amount and note typed for each salary. Presence = ticked. */
export type SalaryPicks = Record<string, { amount: string; note: string }>;

export const salaryKey = (row: { employeeId: string; month: string }) => `${row.employeeId}|${row.month}`;

/** The salaries due, then any saved on the list that are no longer due, so an edit never drops one unseen. */
export function salaryRows(due: readonly SalaryDue[], saved: PayoutListDetail["salaries"]): SalaryRow[] {
  const rows: SalaryRow[] = due.map((row) => ({
    key: salaryKey(row),
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    siteName: row.siteName,
    month: row.month,
    netSalary: row.netSalary,
  }));
  const have = new Set(rows.map((row) => row.key));
  for (const one of saved) {
    const key = salaryKey(one);
    if (!have.has(key)) {
      rows.push({ key, employeeId: one.employeeId, employeeName: one.employeeName, siteName: one.siteName, month: one.month, netSalary: one.amount });
    }
  }
  return rows;
}

export const salaryTotal = (picks: SalaryPicks): string => sumAmounts(Object.values(picks).map((pick) => pick.amount));

/**
 * SALARIES ON THE PAYOUT LIST (client request, 23 Oct 2026): every active
 * employee's month still to be paid, under the parties. Ticking one puts the
 * master's net salary in; the amount and a note can be changed for this month
 * (leave, an advance) before the list is saved.
 */
export function SalaryLines({
  rows,
  picks,
  onPicks,
  loading,
  errors,
}: {
  rows: SalaryRow[];
  picks: SalaryPicks;
  onPicks: (next: SalaryPicks) => void;
  loading: boolean;
  errors: Record<string, string>;
}) {
  if (loading) return <p className="py-3 text-center text-sm text-slate-500">Loading salaries…</p>;
  if (rows.length === 0) {
    return <p className="py-3 text-center text-sm text-slate-500">No salary is due. Last month's salaries are all paid.</p>;
  }
  const toggle = (row: SalaryRow) => {
    if (row.key in picks) {
      const { [row.key]: _dropped, ...rest } = picks;
      onPicks(rest);
    } else {
      onPicks({ ...picks, [row.key]: { amount: row.netSalary, note: "" } });
    }
  };
  const allTicked = rows.every((row) => row.key in picks);
  return (
    <div className="rounded-lg ring-1 ring-inset ring-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr>
            <th className="w-10 px-3 py-1.5">
              <input
                type="checkbox"
                aria-label="Pay every salary shown"
                className="size-4 rounded border-slate-300 text-brand-600"
                checked={allTicked}
                onChange={() =>
                  onPicks(allTicked ? {} : Object.fromEntries(rows.map((row) => [row.key, picks[row.key] ?? { amount: row.netSalary, note: "" }])))
                }
              />
            </th>
            <th className="px-2 py-1.5 text-left font-medium">Employee</th>
            <th className="px-2 py-1.5 text-left font-medium">Month</th>
            <th className="px-2 py-1.5 text-right font-medium">Net salary</th>
            <th className="w-44 px-2 py-1.5 text-right font-medium">Amount to pay</th>
            <th className="w-48 px-2 py-1.5 text-left font-medium">Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const pick = picks[row.key];
            const label = `${row.employeeName} for ${monthLabel(row.month)}`;
            return (
              <tr key={row.key} className={pick ? "bg-brand-50/40" : undefined}>
                <td className="px-3 py-1.5">
                  <input
                    type="checkbox"
                    aria-label={`Pay salary of ${label}`}
                    className="size-4 rounded border-slate-300 text-brand-600"
                    checked={Boolean(pick)}
                    onChange={() => toggle(row)}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <span className="font-medium text-slate-900">{row.employeeName}</span>
                  {row.siteName && <span className="ml-1 text-xs text-slate-500">· {row.siteName}</span>}
                </td>
                <td className="px-2 py-1.5 text-slate-700">{monthLabel(row.month)}</td>
                <td className="tabular px-2 py-1.5 text-right text-slate-600">{formatMoney(row.netSalary)}</td>
                <td className="px-2 py-1">
                  {pick && (
                    <AmountField
                      label={`Salary amount for ${label}`}
                      labelHidden
                      inputMode="decimal"
                      className="text-right"
                      value={pick.amount}
                      onValue={(raw) => onPicks({ ...picks, [row.key]: { ...pick, amount: raw } })}
                      error={errors[row.key]}
                    />
                  )}
                </td>
                <td className="px-2 py-1">
                  {pick && (
                    <input
                      aria-label={`Note for ${label}`}
                      maxLength={200}
                      placeholder="e.g. 2 days leave"
                      className="h-8 w-full rounded-md border-0 px-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
                      value={pick.note}
                      onChange={(event) => onPicks({ ...picks, [row.key]: { ...pick, note: event.target.value } })}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
