import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { BalanceRow, PendingLedgerRow } from "@accountmanagement/contracts";
import { Alert, EmptyState } from "../../components/ui";
import { formatDate, formatMoney } from "../../lib/format";
import { EMPTY_FILTERS, ReportFilters, toQuery, type FilterState } from "./ReportFilters";
import { describeLoadError } from "../../lib/load-error";
import { useBalances, usePendingLedger } from "./api";
import {
  DocumentNo,
  REPORT_PAGE,
  ReportGrid,
  ReportPager,
  ReportTabs,
  TypeLabel,
  type ReportColumn,
  type ReportTab,
} from "./ReportGrid";

/**
 * A copy of the Ledger & Balances screen for the client to try out. Added 14 Sep
 * 2026, and deliberately a separate screen so the original is untouched while
 * they decide.
 *
 * Four things differ from `LedgerPage`, all at the client's request:
 *
 *   1. The balance summary shows only Site, Supplier and Net, and hides any
 *      row whose Net is zero.
 *   2. The ledger lists nothing whose balance is zero.
 *   3. The ledger has its own filters, apart from the summary's.
 *   4. The ledger lists only the invoices still to be paid. Payments settle the
 *      oldest invoices first, so a partly paid invoice shows what is left of it.
 *      `pendingLedgerRowSchema` has the rule.
 *
 * Points 2 and 4 are one rule. A site and supplier whose balance is zero have
 * no invoice left to pay, so nothing of theirs is listed.
 *
 * TWO TABS, like `LedgerPage` (client request, 18 Sep 2026): the ledger in one
 * and the balance summary in the other, each with its own filters still, each
 * in a ruled grid. Both tabs stay mounted in state, so switching does not throw
 * away a search.
 *
 * NO TITLE BLOCK (client request, 18 Sep 2026): the tabs head the page, with the
 * Purchases / Sales switch at the end of their row. The name stays as a heading
 * for screen readers, which announce a page by it.
 *
 * Neither tab says anything before its Search, and neither carries a footnote
 * under the grid (client request, 18 Sep 2026): the filters and the Search button are
 * the whole of what an empty tab needs to show.
 *
 * No export buttons yet. The existing downloads are laid out for the full
 * ledger, and the client may still change what this one shows.
 */

const balanceTone = (value: string) => (value.startsWith("-") ? "text-emerald-700" : "text-slate-900");

const SOURCE_TONE: Record<PendingLedgerRow["source"], "neutral" | "info"> = {
  invoice: "neutral",
  opening_balance: "info",
};

const noSite = <span className="text-xs text-slate-400">No site</span>;

export function PendingLedgerPage() {
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [tab, setTab] = useState<ReportTab>("ledger");

  // Two independent filter rows: one for the summary, one for the ledger.
  const [summaryDraft, setSummaryDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [summaryApplied, setSummaryApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [summaryOffset, setSummaryOffset] = useState(0);

  const [ledgerDraft, setLedgerDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [ledgerApplied, setLedgerApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [ledgerOffset, setLedgerOffset] = useState(0);

  // NOTHING LOADS UNTIL SEARCH IS PRESSED (client request, 14 Sep 2026). Each
  // tab waits for its own Search, and its Reset takes it back to empty.
  const [summarySearched, setSummarySearched] = useState(false);
  const [ledgerSearched, setLedgerSearched] = useState(false);

  const balances = useBalances(
    {
      ...toQuery(summaryApplied),
      direction,
      // The client asked (14 Sep 2026) for settled rows to be left out. Only a Net of
      // exactly zero is hidden; an overpaid supplier still shows its negative Net.
      // The footer is computed over the rows shown, so it still adds up.
      show: "outstanding",
      limit: REPORT_PAGE,
      offset: summaryOffset,
    },
    summarySearched,
  );
  const ledger = usePendingLedger(
    { ...toQuery(ledgerApplied), direction, limit: REPORT_PAGE, offset: ledgerOffset },
    ledgerSearched,
  );

  const partyLabel = direction === "out" ? "Supplier" : "Customer";

  const ledgerColumns: Array<ReportColumn<PendingLedgerRow>> = [
    {
      key: "document",
      header: "Document",
      // Wraps: a payment's reference can be a sentence ("Against running account").
      width: "8rem",
      cell: (row) => <DocumentNo value={row.displayNo} />,
    },
    {
      key: "type",
      header: "Type",
      nowrap: true,
      cell: (row) => (
        // "Part paid" beside the type, not under the amount: under the amount it
        // made the row two lines tall and pushed the figure off its line.
        <span className="flex items-center gap-1">
          <TypeLabel tone={SOURCE_TONE[row.source]}>{row.label}</TypeLabel>
          {row.pending !== row.amount && <TypeLabel tone="warning">Part paid</TypeLabel>}
        </span>
      ),
    },
    {
      key: "date",
      header: "Date",
      nowrap: true,
      cell: (row) => <span className="tabular">{row.documentDate ? formatDate(row.documentDate) : "—"}</span>,
    },
    { key: "party", header: partyLabel, cell: (row) => row.partyName },
    { key: "site", header: "Site", cell: (row) => row.siteName ?? noSite },
    {
      key: "location",
      header: "Location",
            cell: (row) => row.siteLocationName ?? <span className="text-xs text-slate-400">—</span>,
    },
    {
      key: "amount",
      header: "Invoice amount",
      numeric: true,
      className: () => "text-slate-600",
      cell: (row) => formatMoney(row.amount),
      footer: <span className="text-slate-700">{formatMoney(ledger.data?.totalAmount ?? "0")}</span>,
    },
    {
      key: "pending",
      header: "Pending",
      numeric: true,
      className: () => "font-medium text-rose-700",
      cell: (row) => formatMoney(row.pending),
      footer: <span className="text-rose-700">{formatMoney(ledger.data?.totalPending ?? "0")}</span>,
    },
    {
      key: "balance",
      header: "Balance",
      numeric: true,
      className: () => "font-medium text-slate-900",
      cell: (row) => formatMoney(row.balance),
      // A running balance has no total; the cell is kept so the rule runs on.
      footer: "",
    },
  ];

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
      <h1 className="sr-only">Pending ledger</h1>

      <ReportTabs
        value={tab}
        onChange={setTab}
        labels={{ ledger: "Ledger — pending invoices", balances: "Balance summary" }}
        actions={
          <div className="flex rounded-md ring-1 ring-inset ring-slate-300">
            {(["out", "in"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={direction === value}
                onClick={() => {
                  setDirection(value);
                  setSummaryOffset(0);
                  setLedgerOffset(0);
                }}
                className={`px-3 py-1.5 text-sm font-medium first:rounded-l-md last:rounded-r-md ${
                  direction === value ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {value === "out" ? "Purchases" : "Sales"}
              </button>
            ))}
          </div>
        }
        panel={(current) =>
          current === "ledger" ? (
            <>
              <ReportFilters
                idPrefix="ledger"
                label="Ledger filters"
                value={ledgerDraft}
                onChange={setLedgerDraft}
                onApply={() => {
                  setLedgerApplied(ledgerDraft);
                  setLedgerOffset(0);
                  setLedgerSearched(true);
                }}
                onReset={() => {
                  setLedgerDraft(EMPTY_FILTERS);
                  setLedgerApplied(EMPTY_FILTERS);
                  setLedgerOffset(0);
                  setLedgerSearched(false);
                }}
                partyLabel={partyLabel}
              />

              {ledgerSearched && ledger.isError && (
                <Alert icon={AlertTriangle}>{describeLoadError(ledger.error, "the ledger")}</Alert>
              )}
              {ledgerSearched && ledger.isPending && (
                <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
                  <Loader2 aria-hidden className="size-4 animate-spin" /> Loading ledger
                </div>
              )}
              {ledgerSearched && ledger.data && ledger.data.rows.length === 0 && (
                <EmptyState title="Nothing pending" description="Every invoice matching these filters has been paid." />
              )}
              {ledgerSearched && ledger.data && ledger.data.rows.length > 0 && (
                <>
                  <ReportGrid
                    label="Pending invoices"
                    columns={ledgerColumns}
                    rows={ledger.data.rows}
                    rowKey={(row) => row.id}
                    footerLabel="Total pending over every entry matching these filters"
                    minWidth="60rem"
                    fit
                  />
                  <ReportPager
                    offset={ledgerOffset}
                    total={ledger.data.total}
                    hasNext={ledger.data.nextCursor !== null}
                    onPage={setLedgerOffset}
                    note="The balance runs across pages."
                  />
                </>
              )}
            </>
          ) : (
            <>
              <ReportFilters
                idPrefix="summary"
                label="Balance summary filters"
                value={summaryDraft}
                onChange={setSummaryDraft}
                onApply={() => {
                  setSummaryApplied(summaryDraft);
                  setSummaryOffset(0);
                  setSummarySearched(true);
                }}
                onReset={() => {
                  setSummaryDraft(EMPTY_FILTERS);
                  setSummaryApplied(EMPTY_FILTERS);
                  setSummaryOffset(0);
                  setSummarySearched(false);
                }}
                partyLabel={partyLabel}
              />

              {summarySearched && balances.isError && (
                <Alert icon={AlertTriangle}>{describeLoadError(balances.error, "the balance summary")}</Alert>
              )}
              {summarySearched && balances.isPending && (
                <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
                  <Loader2 aria-hidden className="size-4 animate-spin" /> Loading balances
                </div>
              )}
              {summarySearched && balances.data && balances.data.rows.length === 0 && (
                <EmptyState title="Nothing to show" description="Nothing is owed for these filters." />
              )}
              {summarySearched && balances.data && balances.data.rows.length > 0 && (
                <>
                  <ReportGrid
                    label="Balance summary"
                    columns={balanceColumns}
                    rows={balances.data.rows}
                    rowKey={(row) => row.id}
                    footerLabel="Total"
                    minWidth="36rem"
                    fit
                  />
                  <ReportPager
                    offset={summaryOffset}
                    total={balances.data.total}
                    hasNext={balances.data.nextCursor !== null}
                    onPage={setSummaryOffset}
                  />
                </>
              )}
            </>
          )
        }
      />
    </>
  );
}
