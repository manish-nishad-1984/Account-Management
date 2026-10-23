import { useState } from "react";
import { Plus } from "lucide-react";
import { formatDate, formatMoney } from "../../lib/format";
import { sumAmounts } from "../payouts/decimal";
import { monthLabel } from "../payouts/message";
import { useBalanceSheetDetail, type BalanceSheetDetailFilters } from "./api";

/**
 * What is behind one project's row: the income entries and, beside them, each
 * payment made to a supplier: supplier, date and amount only (client, 22 Oct 2026).
 *
 * Shared by the Balance Sheet report and the saved Balance Sheets, so the two
 * open a project the same way (client, 22 Oct 2026: "all in one in balance
 * sheet"). `onAddIncome` puts "+ Add income" for THIS project above its income,
 * so an entry is recorded without leaving the sheet or losing the place on it.
 */
export function ProjectDetail({
  siteId,
  filters,
  onAddIncome,
}: {
  siteId: string;
  filters: BalanceSheetDetailFilters;
  onAddIncome?: () => void;
}) {
  const detail = useBalanceSheetDetail(siteId, filters);
  // The supplier picked in the payments' header; "" for every supplier.
  const [party, setParty] = useState("");
  if (detail.isLoading) return <p className="px-4 py-3 text-sm text-slate-500">Loading…</p>;
  if (!detail.data) return <p className="px-4 py-3 text-sm text-rose-700">Could not load this project.</p>;
  const { incomes, suppliers, salaries } = detail.data;
  const parties = [...new Map(suppliers.map((one) => [one.partyId, one.partyName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = party === "" ? suppliers : suppliers.filter((one) => one.partyId === party);
  // The total follows the filter (client, 22 Oct 2026).
  const shownTotal = sumAmounts(shown.map((one) => one.amount));
  return (
    <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Income received</h3>
          {onAddIncome && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAddIncome();
              }}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-600 hover:text-white"
            >
              <Plus aria-hidden className="size-3.5" />
              Add income
            </button>
          )}
        </div>
        {incomes.length === 0 ? (
          <p className="text-sm text-slate-500">No income recorded.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {incomes.map((one) => (
                <tr key={one.id}>
                  <td className="tabular py-1 pr-3 text-slate-600">{formatDate(one.incomeDate)}</td>
                  <td className="py-1 pr-3 text-slate-800">
                    {one.clientName} <span className="text-xs text-slate-500">· {one.companyName}</span>
                  </td>
                  <td className="tabular py-1 text-right font-medium text-slate-900">{formatMoney(one.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Suppliers</h3>
        {suppliers.length === 0 ? (
          <p className="text-sm text-slate-500">No payments to suppliers.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-1 pr-3 text-left font-medium">Date</th>
                <th className="py-1 pr-3 text-left font-medium">
                  {/* Filter by supplier, in the column's own header (client, 22 Oct 2026). */}
                  <select
                    aria-label="Filter by supplier"
                    value={party}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setParty(event.target.value)}
                    className="max-w-[16rem] rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-700"
                  >
                    <option value="">Supplier (all)</option>
                    {parties.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </th>
                <th className="py-1 text-right font-medium">Paid amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((one) => (
                <tr key={one.id}>
                  <td className="tabular py-1 pr-3 text-slate-600">{one.paymentDate ? formatDate(one.paymentDate) : "—"}</td>
                  <td className="py-1 pr-3 text-slate-800">{one.partyName}</td>
                  <td className="tabular py-1 text-right font-medium text-slate-900">{formatMoney(one.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-300">
                <td colSpan={2} className="py-1 pr-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Total ({shown.length} {shown.length === 1 ? "payment" : "payments"})
                </td>
                <td aria-label="Paid total" className="tabular py-1 text-right font-semibold text-slate-900">
                  {formatMoney(shownTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
        {salaries.length > 0 && (
          <>
            {/* Salaries paid for the project (client, 23 Oct 2026). */}
            <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Salaries</h3>
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-3 text-left font-medium">Date</th>
                  <th className="py-1 pr-3 text-left font-medium">Employee</th>
                  <th className="py-1 pr-3 text-left font-medium">Month</th>
                  <th className="py-1 text-right font-medium">Paid amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {salaries.map((one) => (
                  <tr key={one.id}>
                    <td className="tabular py-1 pr-3 text-slate-600">{formatDate(one.paymentDate)}</td>
                    <td className="py-1 pr-3 text-slate-800">{one.employeeName}</td>
                    <td className="py-1 pr-3 text-slate-600">{monthLabel(one.month)}</td>
                    <td className="tabular py-1 text-right font-medium text-slate-900">{formatMoney(one.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-300">
                  <td colSpan={3} className="py-1 pr-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Total salary
                  </td>
                  <td aria-label="Salary total" className="tabular py-1 text-right font-semibold text-slate-900">
                    {formatMoney(sumAmounts(salaries.map((one) => one.amount)))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
