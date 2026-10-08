import type { PayoutListDetail } from "@accountmanagement/contracts";
import { CheckCircle2 } from "lucide-react";
import { formatDateTime, formatMoney } from "../../lib/format";
import { sumAmounts } from "./decimal";
import { formatListDate } from "./message";

/**
 * A confirmed list, read-only: what was planned and what was actually paid, bill by
 * bill (7 Oct 2026). It replaces the builder, which has nothing to build once the
 * payments exist; the list is changed only by reversing the confirmation.
 */
export function ConfirmedView({ list }: { list: PayoutListDetail }) {
  const paidOf = (line: PayoutListDetail["lines"][number]) =>
    sumAmounts([...line.invoices.map((bill) => bill.paidAmount ?? "0"), line.extraPaid ?? "0"]);
  const totalPaid = sumAmounts(list.lines.map(paidOf));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200">
        <span className="flex items-center gap-1.5 font-medium">
          <CheckCircle2 aria-hidden className="size-4" />
          Confirmed
        </span>
        {list.confirmedAt && <span>{formatDateTime(list.confirmedAt)}</span>}
        {list.confirmedByName && <span>by {list.confirmedByName}</span>}
        <span>
          Paid <span className="tabular font-semibold">{formatMoney(totalPaid)}</span>
        </span>
        <span className="text-emerald-800">
          The payments are recorded. To change this list, reverse the confirmation first.
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">List date</dt>
          <dd className="text-slate-900">{formatListDate(list.listDate)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Title</dt>
          <dd className="text-slate-900">{list.title ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Budget</dt>
          <dd className="tabular text-slate-900">{list.budget ? formatMoney(list.budget) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Note</dt>
          <dd className="text-slate-900">{list.note ?? "—"}</dd>
        </div>
      </dl>

      <div className="rounded-lg ring-1 ring-inset ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Party and bills</th>
              <th className="px-2 py-1.5 text-right font-medium">Planned</th>
              <th className="px-2 py-1.5 text-right font-medium">Paid</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.lines.map((line) => (
              <PartyBlock key={line.id} line={line} paid={paidOf(line)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PartyBlock({ line, paid }: { line: PayoutListDetail["lines"][number]; paid: string }) {
  return (
    <>
      <tr className="bg-slate-50/60">
        <td className="px-3 py-1.5 font-medium text-slate-900">{line.partyName}</td>
        <td className="tabular px-2 py-1.5 text-right text-slate-700">{formatMoney(line.amount)}</td>
        <td className="tabular px-2 py-1.5 text-right font-semibold text-slate-900">{formatMoney(paid)}</td>
      </tr>
      {line.invoices.map((bill) => {
        const less = bill.paidAmount !== null && Number(bill.paidAmount) < Number(bill.amount);
        return (
          <tr key={`${bill.source}:${bill.documentId}`}>
            <td className="py-1 pl-8 pr-2 text-slate-700">
              <span className="font-medium">{bill.displayNo}</span>
              <span className="ml-2 text-xs text-slate-400">
                {[bill.documentDate ? formatListDate(bill.documentDate) : null, bill.siteName].filter(Boolean).join(" · ")}
              </span>
            </td>
            <td className="tabular px-2 py-1 text-right text-slate-600">{formatMoney(bill.amount)}</td>
            <td className={less ? "tabular px-2 py-1 text-right font-medium text-amber-700" : "tabular px-2 py-1 text-right text-slate-700"}>
              {formatMoney(bill.paidAmount ?? "0")}
            </td>
          </tr>
        );
      })}
      {line.extraPaid && (
        <tr>
          <td className="py-1 pl-8 pr-2 text-slate-600">Extra, kept as an advance</td>
          <td />
          <td className="tabular px-2 py-1 text-right text-slate-700">{formatMoney(line.extraPaid)}</td>
        </tr>
      )}
    </>
  );
}
