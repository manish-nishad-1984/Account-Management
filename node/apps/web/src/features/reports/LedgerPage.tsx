import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { LedgerRow } from "@accountmanagement/contracts";
import { Alert, EmptyState } from "../../components/ui";
import { formatDate, formatMoney } from "../../lib/format";
import { EMPTY_FILTERS, ReportFilters, toQuery, type FilterState } from "./ReportFilters";
import { ExportButtons } from "./ExportButtons";
import { describeLoadError } from "../../lib/load-error";
import { useLedger } from "./api";
import { DocumentNo, REPORT_PAGE, ReportGrid, ReportPager, ReportTabs, TypeLabel, type ReportColumn } from "./ReportGrid";

/**
 * `/Report/ReportDetails` panels 1 and 2.
 *
 * The Payout Summary and the Payment Report share a filter row in the legacy
 * page and they share one here. What they do NOT share in the legacy page is
 * their arithmetic, which is the whole of finding D7: the summary's net adds
 * purchase returns while its own Debit column subtracts them, so the two panels
 * disagree by twice the value of any return. Both read one SQL expression here.
 *
 * THE LEDGER ONLY (client request, 1 Oct 2026). From 18 Sep 2026 this page was
 * "Ledger & Balances", with the ledger in one tab and the balance summary in
 * another. The client asked for the summary tab to go and the page to be called
 * just "Ledger". The summary's figures are still on Pending Outstanding (the old
 * Pending Ledger), which keeps only its own summary, so between the two pages the
 * ledger and the outstanding balances are each shown once.
 *
 * NO TITLE BLOCK, NO PAGE SCROLL (client request, 18 Sep 2026): the lone
 * "Ledger" tab heads the page with the Purchases / Sales switch at the end of
 * its row, and the grid fills the height left so only the grid scrolls.
 *
 * NO PROMPTS, NO FOOTNOTES, EXPORTS ON TOP (client request, 18 Sep 2026): before
 * a search the page shows only the filters, and the download buttons sit in the
 * tab row beside Purchases / Sales.
 */

const SOURCE_TONE: Record<LedgerRow["source"], "neutral" | "warning" | "info"> = {
  invoice: "neutral",
  return: "warning",
  payment: "info",
  opening_balance: "info",
};

/** Negative balances are the party owing us, which is worth seeing at a glance. */
const balanceTone = (value: string) => (value.startsWith("-") ? "text-emerald-700" : "text-slate-900");

const noSite = <span className="text-xs text-slate-400">No site</span>;

export function LedgerPage() {
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  /**
   * NOTHING LOADS UNTIL SEARCH IS PRESSED (client request, 14 Sep 2026).
   * Unfiltered, the ledger scans every document and payment in the system,
   * which is slow and is not what anyone opens the screen to read. Reset goes
   * back to that empty state.
   */
  const [searched, setSearched] = useState(false);

  const ledger = useLedger({ ...toQuery(applied), direction, limit: REPORT_PAGE, offset }, searched);

  const apply = () => {
    setApplied(draft);
    // A cursor carried across a filter change seeks into a set that no longer
    // exists — §5j found the same thing on inward challans.
    setOffset(0);
    setSearched(true);
  };

  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setOffset(0);
    setSearched(false);
  };

  const partyLabel = direction === "out" ? "Supplier" : "Customer";

  const ledgerColumns: Array<ReportColumn<LedgerRow>> = [
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
      cell: (row) => <TypeLabel tone={SOURCE_TONE[row.source]}>{row.label}</TypeLabel>,
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
            cell: (row) =>
        /*
          Sales invoices carry no location (formerly site group) at all — the legacy
          sales ledger renders this column bound to a property its own model does
          not have, so it has never shown anything. Said, rather than drawn empty.
        */
        row.siteLocationName ?? (
          <span className="text-xs text-slate-400">{direction === "in" ? "Not recorded on sales" : "—"}</span>
        ),
    },
    {
      key: "credit",
      header: "Credit",
      numeric: true,
      className: () => "text-emerald-700",
      cell: (row) => (row.effect === "credit" ? formatMoney(row.credit) : ""),
      footer: <span className="text-emerald-700">{formatMoney(ledger.data?.totalCredit ?? "0")}</span>,
    },
    {
      key: "debit",
      header: "Debit",
      numeric: true,
      className: () => "text-rose-700",
      cell: (row) => (row.effect === "debit" ? formatMoney(row.debit) : ""),
      footer: <span className="text-rose-700">{formatMoney(ledger.data?.totalDebit ?? "0")}</span>,
    },
    {
      key: "balance",
      header: "Balance",
      numeric: true,
      className: (row) => `font-medium ${balanceTone(row.balance)}`,
      cell: (row) => formatMoney(row.balance),
      footer: formatMoney(ledger.data?.closingBalance ?? "0"),
    },
  ];

  return (
    <>
      <h1 className="sr-only">Ledger</h1>

      <ReportTabs
        value="ledger"
        onChange={() => {}}
        tabs={["ledger"]}
        labels={{ ledger: "Ledger" }}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Hidden until a search, so a download is never of a set nobody asked for. */}
            {searched && <ExportButtons kind="ledger" withByParty query={{ ...toQuery(applied), direction }} />}
          <div className="flex rounded-md ring-1 ring-inset ring-slate-300">
            {(["out", "in"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={direction === value}
                onClick={() => {
                  setDirection(value);
                  setOffset(0);
                }}
                className={`px-3 py-1.5 text-sm font-medium first:rounded-l-md last:rounded-r-md ${
                  direction === value ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {value === "out" ? "Purchases" : "Sales"}
              </button>
            ))}
          </div>
          </div>
        }
        panel={() => (
            <>
              <ReportFilters value={draft} onChange={setDraft} onApply={apply} onReset={reset} partyLabel={partyLabel} />
              {searched && ledger.isError && (
                <Alert icon={AlertTriangle}>{describeLoadError(ledger.error, "the ledger")}</Alert>
              )}
              {searched && ledger.isPending && (
                <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
                  <Loader2 aria-hidden className="size-4 animate-spin" /> Loading ledger
                </div>
              )}
              {searched && ledger.data && ledger.data.rows.length === 0 && (
                <EmptyState title="No entries" description="No documents match these filters." />
              )}
              {searched && ledger.data && ledger.data.rows.length > 0 && (
                <>
                  <ReportGrid
                    label="Ledger"
                    columns={ledgerColumns}
                    rows={ledger.data.rows}
                    rowKey={(row) => row.id}
                    footerLabel="Total over every entry matching these filters"
                    minWidth="60rem"
                    fit
                  />
                  <ReportPager
                    offset={offset}
                    total={ledger.data.total}
                    hasNext={ledger.data.nextCursor !== null}
                    onPage={setOffset}
                    note="The balance runs across pages."
                  />
                </>
              )}
            </>
        )}
      />
    </>
  );
}
