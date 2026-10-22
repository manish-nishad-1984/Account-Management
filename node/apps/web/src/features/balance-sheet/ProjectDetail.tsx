import { Plus } from "lucide-react";
import { formatDate, formatMoney } from "../../lib/format";
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
  if (detail.isLoading) return <p className="px-4 py-3 text-sm text-slate-500">Loading…</p>;
  if (!detail.data) return <p className="px-4 py-3 text-sm text-rose-700">Could not load this project.</p>;
  const { incomes, suppliers } = detail.data;
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
                <th className="py-1 pr-3 text-left font-medium">Supplier</th>
                <th className="py-1 pr-3 text-left font-medium">Date</th>
                <th className="py-1 text-right font-medium">Paid amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {suppliers.map((one) => (
                <tr key={one.id}>
                  <td className="py-1 pr-3 text-slate-800">{one.partyName}</td>
                  <td className="tabular py-1 pr-3 text-slate-600">{one.paymentDate ? formatDate(one.paymentDate) : "—"}</td>
                  <td className="tabular py-1 text-right font-medium text-slate-900">{formatMoney(one.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
