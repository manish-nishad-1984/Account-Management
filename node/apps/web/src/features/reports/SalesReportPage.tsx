import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { BalanceRow } from "@accountmanagement/contracts";
import { Alert, EmptyState } from "../../components/ui";
import { formatMoney } from "../../lib/format";
import { EMPTY_FILTERS, ReportFilters, toQuery, type FilterState } from "./ReportFilters";
import { ExportButtons } from "./ExportButtons";
import { describeLoadError } from "../../lib/load-error";
import { useSalesReport } from "./api";
import { REPORT_PAGE, ReportGrid, ReportPager, type ReportColumn } from "./ReportGrid";

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
 *
 * LAID OUT LIKE THE OTHER REPORTS (client request, 18 Sep 2026): no title block,
 * the download buttons inside the filter card, on its date-shortcut line, a ruled grid that fills the page
 * so only the grid scrolls, and no footnote. It also pages now — it asked for 50
 * rows and had no way to see the 51st, under a total that included them all.
 * What Outstanding means is kept as that heading's tooltip.
 */

const outstandingTone = (value: string) => (value.startsWith("-") ? "text-emerald-700" : "text-slate-900");

export function SalesReportPage() {
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);

  const report = useSalesReport({ ...toQuery(applied), show: "all", limit: REPORT_PAGE, offset });

  const columns: Array<ReportColumn<BalanceRow>> = [
    {
      key: "site",
      header: "Site",
      cell: (row) => row.siteName ?? <span className="text-xs text-slate-400">No site</span>,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (row) => <span className="font-medium text-slate-900">{row.partyName}</span>,
    },
    {
      key: "invoiced",
      header: "Invoiced",
      numeric: true,
      className: () => "text-emerald-700",
      cell: (row) => formatMoney(row.credit),
      footer: <span className="text-emerald-700">{formatMoney(report.data?.totalCredit ?? "0")}</span>,
    },
    {
      key: "received",
      header: "Received",
      numeric: true,
      className: () => "text-rose-700",
      cell: (row) => formatMoney(row.debit),
      footer: <span className="text-rose-700">{formatMoney(report.data?.totalDebit ?? "0")}</span>,
    },
    {
      key: "outstanding",
      header: <span title="Invoiced less received. Sales returns and credit notes reduce it.">Outstanding</span>,
      numeric: true,
      className: (row) => `font-medium ${outstandingTone(row.netAmount)}`,
      cell: (row) => formatMoney(row.netAmount),
      footer: formatMoney(report.data?.closingBalance ?? "0"),
    },
  ];

  return (
    <>
      <h1 className="sr-only">Sales report</h1>

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
        actions={<ExportButtons kind="sales" query={{ ...toQuery(applied), show: "all" }} />}
      />

      {report.isError && <Alert icon={AlertTriangle}>{describeLoadError(report.error, "the sales report")}</Alert>}

      {report.isPending && (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Loading the sales report
        </div>
      )}

      {report.data && report.data.rows.length === 0 && (
        <EmptyState title="Nothing to show" description="No sales invoices or receipts match these filters." />
      )}

      {report.data && report.data.rows.length > 0 && (
        <>
          <ReportGrid
            label="Sales report"
            columns={columns}
            rows={report.data.rows}
            rowKey={(row) => row.id}
            footerLabel="Total"
            minWidth="44rem"
            fit
          />
          <ReportPager
            offset={offset}
            total={report.data.total}
            hasNext={report.data.nextCursor !== null}
            onPage={setOffset}
          />
        </>
      )}
    </>
  );
}
