import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Alert, EmptyState, PageHeader } from "../../components/ui";
import { formatMoney } from "../../lib/format";
import { EMPTY_FILTERS, ReportFilters, toQuery, type FilterState } from "./ReportFilters";
import { ExportButtons } from "./ExportButtons";
import { useSalesReport } from "./api";

/**
 * `/Sales/SalesReport` — screen 30 of the module inventory.
 *
 * The same aggregate as the ledger screen's summary panel, on the incoming
 * direction, with its own permission. Two screens rather than one because
 * `PermissionsGuard` requires EVERY permission a route lists, so one route
 * guarded by both rights would lock out anyone holding exactly one of them —
 * see the note on `reports.controller.ts`.
 *
 * The legacy action carries no `[FormPermissionAttribute]` at all (doc 11,
 * screen 30). `sales-report.view` here, which is the fourth screen where a
 * missing authorization check was closed rather than reproduced.
 */

const PAGE = 50;

export function SalesReportPage() {
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);

  const report = useSalesReport({ ...toQuery(applied), show: "all", limit: PAGE, offset });

  return (
    <>
      <PageHeader
        title="Sales report"
        description="What each customer owes, by site"
        actions={<ExportButtons kind="sales" query={{ ...toQuery(applied), show: "all" }} />}
      />

      <ReportFilters
        value={draft}
        onChange={setDraft}
        onApply={() => {
          setApplied(draft);
          setOffset(0);
        }}
        onReset={() => {
          setDraft(EMPTY_FILTERS);
          setApplied(EMPTY_FILTERS);
          setOffset(0);
        }}
        partyLabel="Customer"
      />

      {report.isError && <Alert icon={AlertTriangle}>The sales report could not be loaded.</Alert>}

      {report.isPending && (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Loading the sales report
        </div>
      )}

      {report.data && report.data.rows.length === 0 && (
        <EmptyState
          title="Nothing to show"
          description="No sales invoices or receipts match these filters."
        />
      )}

      {report.data && report.data.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Site</th>
                <th className="px-3 py-2 text-left font-medium">Customer</th>
                <th className="px-3 py-2 text-right font-medium">Invoiced</th>
                <th className="px-3 py-2 text-right font-medium">Received</th>
                <th className="px-3 py-2 text-right font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.data.rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/70">
                  <td className="px-3 py-2 text-slate-600">
                    {row.siteName ?? <span className="text-xs text-slate-400">No site</span>}
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-900">{row.partyName}</td>
                  <td className="tabular px-3 py-2 text-right text-emerald-700">
                    {formatMoney(row.credit)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-rose-700">
                    {formatMoney(row.debit)}
                  </td>
                  <td className="tabular px-3 py-2 text-right font-medium text-slate-900">
                    {formatMoney(row.netAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 text-sm font-medium">
              <tr>
                <td className="px-3 py-2 text-slate-500" colSpan={2}>
                  Total
                </td>
                <td className="tabular px-3 py-2 text-right text-emerald-700">
                  {formatMoney(report.data.totalCredit)}
                </td>
                <td className="tabular px-3 py-2 text-right text-rose-700">
                  {formatMoney(report.data.totalDebit)}
                </td>
                <td className="tabular px-3 py-2 text-right text-slate-900">
                  {formatMoney(report.data.closingBalance)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mt-2 text-xs text-slate-500">
        Sales returns and credit notes reduce what is outstanding. The total row
        is the sum of the rows shown, which the old report&apos;s footer was not.
      </p>
    </>
  );
}
