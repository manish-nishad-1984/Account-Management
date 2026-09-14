import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { PendingLedgerRow } from "@accountmanagement/contracts";
import { Alert, Badge, Button, EmptyState, PageHeader } from "../../components/ui";
import { formatDate, formatMoney } from "../../lib/format";
import { EMPTY_FILTERS, ReportFilters, toQuery, type FilterState } from "./ReportFilters";
import { describeLoadError } from "../../lib/load-error";
import { useBalances, usePendingLedger } from "./api";

/**
 * A copy of the Ledger & Balances screen for the client to try out. Added 14 Sep
 * 2026, and deliberately a separate screen so the original is untouched while
 * they decide.
 *
 * Four things differ from `LedgerPage`, all at the client's request:
 *
 *   1. The balance summary shows only Site, Supplier and Net.
 *   2. The ledger lists nothing whose balance is zero.
 *   3. The ledger has its own filters, above it, apart from the summary's.
 *   4. The ledger lists only the invoices still to be paid. Payments settle the
 *      oldest invoices first, so a partly paid invoice shows what is left of it.
 *      `pendingLedgerRowSchema` has the rule.
 *
 * Points 2 and 4 are one rule. A site and supplier whose balance is zero have
 * no invoice left to pay, so nothing of theirs is listed.
 *
 * No export buttons yet. The existing downloads are laid out for the full
 * ledger, and the client may still change what this one shows.
 */

const PAGE = 50;

const balanceTone = (value: string) =>
  value.startsWith("-") ? "text-emerald-700" : "text-slate-900";

const SOURCE_TONE: Record<PendingLedgerRow["source"], "neutral" | "info"> = {
  invoice: "neutral",
  opening_balance: "info",
};

function Pager({
  offset,
  total,
  hasNext,
  onPage,
  note,
}: {
  offset: number;
  total: number;
  hasNext: boolean;
  onPage: (offset: number) => void;
  note?: string;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
      <span>
        Showing {offset + 1} to {Math.min(offset + PAGE, total)} of {total}.{note ? ` ${note}` : ""}
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={offset === 0}
          onClick={() => onPage(Math.max(0, offset - PAGE))}
        >
          Previous
        </Button>
        <Button variant="secondary" disabled={!hasNext} onClick={() => onPage(offset + PAGE)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function PendingLedgerPage() {
  const [direction, setDirection] = useState<"out" | "in">("out");

  // Two independent filter rows: one for the summary, one for the ledger.
  const [summaryDraft, setSummaryDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [summaryApplied, setSummaryApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [summaryOffset, setSummaryOffset] = useState(0);

  const [ledgerDraft, setLedgerDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [ledgerApplied, setLedgerApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [ledgerOffset, setLedgerOffset] = useState(0);

  const balances = useBalances({
    ...toQuery(summaryApplied),
    direction,
    show: "all",
    limit: PAGE,
    offset: summaryOffset,
  });
  const ledger = usePendingLedger({
    ...toQuery(ledgerApplied),
    direction,
    limit: PAGE,
    offset: ledgerOffset,
  });

  const partyLabel = direction === "out" ? "Supplier" : "Customer";

  return (
    <>
      <PageHeader
        title="Pending ledger"
        description="What is owed, and only the invoices still to be paid"
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
                  direction === value
                    ? "bg-brand-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {value === "out" ? "Purchases" : "Sales"}
              </button>
            ))}
          </div>
        }
      />

      {/* The summary: site, party and net only. */}
      <section className="mb-8" aria-labelledby="pending-summary-heading">
        <h2 id="pending-summary-heading" className="heading mb-2 text-sm">
          Balance summary
        </h2>

        <ReportFilters
          idPrefix="summary"
          label="Balance summary filters"
          value={summaryDraft}
          onChange={setSummaryDraft}
          onApply={() => {
            setSummaryApplied(summaryDraft);
            setSummaryOffset(0);
          }}
          onReset={() => {
            setSummaryDraft(EMPTY_FILTERS);
            setSummaryApplied(EMPTY_FILTERS);
            setSummaryOffset(0);
          }}
          partyLabel={partyLabel}
        />

        {balances.isError && (
          <Alert icon={AlertTriangle}>
            {describeLoadError(balances.error, "the balance summary")}
          </Alert>
        )}
        {balances.isPending && (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 aria-hidden className="size-4 animate-spin" /> Loading balances
          </div>
        )}
        {balances.data && balances.data.rows.length === 0 && (
          <EmptyState title="Nothing to show" description="No documents match these filters." />
        )}
        {balances.data && balances.data.rows.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
              <table aria-label="Balance summary" className="w-full border-collapse text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Site</th>
                    <th className="px-3 py-2 text-left font-medium">{partyLabel}</th>
                    <th className="px-3 py-2 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {balances.data.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-600">
                        {row.siteName ?? <span className="text-xs text-slate-400">No site</span>}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">{row.partyName}</td>
                      <td
                        className={`tabular px-3 py-2 text-right font-medium ${balanceTone(row.netAmount)}`}
                      >
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
                    <td className="tabular px-3 py-2 text-right text-slate-900">
                      {formatMoney(balances.data.closingBalance)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <Pager
              offset={summaryOffset}
              total={balances.data.total}
              hasNext={balances.data.nextCursor !== null}
              onPage={setSummaryOffset}
            />
          </>
        )}
      </section>

      {/* The ledger: only what is still to be paid, with its own filters. */}
      <section aria-labelledby="pending-ledger-heading">
        <h2 id="pending-ledger-heading" className="heading mb-2 text-sm">
          Ledger — invoices pending payment
        </h2>

        <ReportFilters
          idPrefix="ledger"
          label="Ledger filters"
          value={ledgerDraft}
          onChange={setLedgerDraft}
          onApply={() => {
            setLedgerApplied(ledgerDraft);
            setLedgerOffset(0);
          }}
          onReset={() => {
            setLedgerDraft(EMPTY_FILTERS);
            setLedgerApplied(EMPTY_FILTERS);
            setLedgerOffset(0);
          }}
          partyLabel={partyLabel}
        />

        {ledger.isError && (
          <Alert icon={AlertTriangle}>{describeLoadError(ledger.error, "the ledger")}</Alert>
        )}
        {ledger.isPending && (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 aria-hidden className="size-4 animate-spin" /> Loading ledger
          </div>
        )}
        {ledger.data && ledger.data.rows.length === 0 && (
          <EmptyState
            title="Nothing pending"
            description="Every invoice matching these filters has been paid."
          />
        )}
        {ledger.data && ledger.data.rows.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
              <table aria-label="Pending invoices" className="w-full border-collapse text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Document</th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">{partyLabel}</th>
                    <th className="px-3 py-2 text-left font-medium">Site</th>
                    <th className="px-3 py-2 text-left font-medium">Group</th>
                    <th className="px-3 py-2 text-right font-medium">Invoice amount</th>
                    <th className="px-3 py-2 text-right font-medium">Pending</th>
                    <th className="px-3 py-2 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ledger.data.rows.map((row) => {
                    const partPaid = row.pending !== row.amount;
                    return (
                      <tr key={row.id} className="align-top hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{row.displayNo}</div>
                          <Badge tone={SOURCE_TONE[row.source]}>{row.label}</Badge>
                        </td>
                        <td className="tabular px-3 py-2 text-slate-600">
                          {row.documentDate ? formatDate(row.documentDate) : "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{row.partyName}</td>
                        <td className="px-3 py-2 text-slate-600">
                          {row.siteName ?? <span className="text-xs text-slate-400">No site</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {row.siteGroupName ?? <span className="text-xs text-slate-400">—</span>}
                        </td>
                        <td className="tabular px-3 py-2 text-right text-slate-600">
                          {formatMoney(row.amount)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="tabular font-medium text-rose-700">
                            {formatMoney(row.pending)}
                          </div>
                          {partPaid && (
                            <div className="text-[11px] text-slate-500">Part paid</div>
                          )}
                        </td>
                        <td className="tabular px-3 py-2 text-right font-medium text-slate-900">
                          {formatMoney(row.balance)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 text-sm font-medium">
                  <tr>
                    <td className="px-3 py-2 text-slate-500" colSpan={5}>
                      Total pending over every entry matching these filters
                    </td>
                    <td className="tabular px-3 py-2 text-right text-slate-600">
                      {formatMoney(ledger.data.totalAmount)}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-rose-700">
                      {formatMoney(ledger.data.totalPending)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <Pager
              offset={ledgerOffset}
              total={ledger.data.total}
              hasNext={ledger.data.nextCursor !== null}
              onPage={setLedgerOffset}
              note="The balance runs across pages."
            />
          </>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Payments and returns pay off the oldest invoices first. For each site and
          supplier, the Pending column adds up to what is still owed.
        </p>
      </section>
    </>
  );
}
