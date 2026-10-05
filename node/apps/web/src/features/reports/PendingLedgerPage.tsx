import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { BalanceRow } from "@accountmanagement/contracts";
import { Alert, EmptyState } from "../../components/ui";
import { formatMoney } from "../../lib/format";
import { EMPTY_FILTERS, ReportFilters, toQuery, type FilterState } from "./ReportFilters";
import { describeLoadError } from "../../lib/load-error";
import { useBalances } from "./api";
import { DirectionSwitch, REPORT_PAGE, ReportGrid, ReportPager, ReportTabs, type ReportColumn } from "./ReportGrid";

/**
 * Pending Outstanding: what is still owed, per site and party.
 *
 * Began on 14 Sep 2026 as the "Pending Ledger", a copy of the Ledger & Balances
 * screen for the client to try out, with two tabs: the invoices still to be
 * paid, and a balance summary cut to Site, Supplier and Net.
 *
 * ONLY THE SUMMARY IS LEFT (client request, 1 Oct 2026). The pending-invoices
 * tab was removed and the summary renamed "Pending Outstanding", and the menu
 * item with it. The route stays `/reports/pending-ledger` so a bookmark still
 * opens it. The pending-invoices endpoint (`usePendingLedger`) is still served
 * by the API; nothing on screen calls it now.
 *
 * Settled rows are left out (client request, 14 Sep 2026): only a Net of exactly
 * zero is hidden, and an overpaid supplier still shows its negative Net.
 *
 * NO TITLE BLOCK (client request, 18 Sep 2026): the lone tab heads the page,
 * with the Purchases / Sales switch at the end of its row. Nothing loads before
 * Search, and nothing sits under the grid.
 *
 * No export buttons yet. The existing downloads are laid out for the full
 * summary, and the client may still change what this one shows.
 */

const balanceTone = (value: string) => (value.startsWith("-") ? "text-amber-700" : "text-slate-900");

const noSite = <span className="text-xs text-slate-400">No site</span>;

export function PendingLedgerPage() {
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  // NOTHING LOADS UNTIL SEARCH IS PRESSED (client request, 14 Sep 2026), and
  // Reset takes the page back to empty.
  const [searched, setSearched] = useState(false);

  const balances = useBalances(
    {
      ...toQuery(applied),
      direction,
      // The footer is computed over the rows shown, so it still adds up.
      show: "outstanding",
      limit: REPORT_PAGE,
      offset,
    },
    searched,
  );

  const partyLabel = direction === "out" ? "Supplier" : "Customer";

  const balanceColumns: Array<ReportColumn<BalanceRow>> = [
    { key: "site", header: "Site", cell: (row) => row.siteName ?? noSite },
    {
      key: "party",
      header: partyLabel,
      cell: (row) => <span className="font-medium text-slate-900">{row.partyName}</span>,
    },
    {
      key: "net",
      header: "Net",
      numeric: true,
      className: (row) => `font-medium ${balanceTone(row.netAmount)}`,
      cell: (row) => formatMoney(row.netAmount),
      footer: formatMoney(balances.data?.closingBalance ?? "0"),
    },
  ];

  return (
    <>
      <h1 className="sr-only">Pending outstanding</h1>

      <ReportTabs
        value="balances"
        onChange={() => {}}
        tabs={["balances"]}
        labels={{ balances: "Pending Outstanding" }}
        actions={
          <DirectionSwitch
            value={direction}
            onChange={(next) => {
              setDirection(next);
              setOffset(0);
            }}
          />
        }
        panel={() => (
          <>
            <ReportFilters
              maxWidth="64rem"
              idPrefix="summary"
              label="Pending outstanding filters"
              value={draft}
              onChange={setDraft}
              onApply={() => {
                setApplied(draft);
                setOffset(0);
                setSearched(true);
              }}
              onReset={() => {
                setDraft(EMPTY_FILTERS);
                setApplied(EMPTY_FILTERS);
                setOffset(0);
                setSearched(false);
              }}
              partyLabel={partyLabel}
            />

            {searched && balances.isError && (
              <Alert icon={AlertTriangle}>{describeLoadError(balances.error, "the pending outstanding")}</Alert>
            )}
            {searched && balances.isPending && (
              <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
                <Loader2 aria-hidden className="size-4 animate-spin" /> Loading balances
              </div>
            )}
            {searched && balances.data && balances.data.rows.length === 0 && (
              <EmptyState title="Nothing to show" description="Nothing is owed for these filters." />
            )}
            {searched && balances.data && balances.data.rows.length > 0 && (
              <>
                <ReportGrid
                  label="Pending outstanding"
                  columns={balanceColumns}
                  rows={balances.data.rows}
                  rowKey={(row) => row.id}
                  footerLabel="Total"
                  minWidth="36rem"
                  maxWidth="64rem"
                  fit
                />
                <ReportPager
                  offset={offset}
                  total={balances.data.total}
                  hasNext={balances.data.nextCursor !== null}
                  onPage={setOffset}
                />
              </>
            )}
          </>
        )}
      />
    </>
  );
}
