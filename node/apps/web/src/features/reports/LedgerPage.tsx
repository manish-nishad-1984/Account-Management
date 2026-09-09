import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { LedgerRow } from "@accountmanagement/contracts";
import { Alert, Badge, Button, EmptyState, PageHeader } from "../../components/ui";
import { formatDate, formatMoney } from "../../lib/format";
import { EMPTY_FILTERS, ReportFilters, toQuery, type FilterState } from "./ReportFilters";
import { ExportButtons } from "./ExportButtons";
import { useBalances, useLedger } from "./api";

/**
 * `/Report/ReportDetails` panels 1 and 2, on one screen as they are today.
 *
 * The Payout Summary and the Payment Report share a filter row in the legacy
 * page and they share one here. What they do NOT share in the legacy page is
 * their arithmetic, which is the whole of finding D7: the summary's net adds
 * purchase returns while its own Debit column subtracts them, so the two panels
 * disagree by twice the value of any return. Both read one SQL expression here.
 */

const PAGE = 50;

const SOURCE_TONE: Record<LedgerRow["source"], "neutral" | "warning" | "info"> = {
  invoice: "neutral",
  return: "warning",
  payment: "info",
  opening_balance: "info",
};

/** Negative balances are the party owing us, which is worth seeing at a glance. */
const balanceTone = (value: string) =>
  value.startsWith("-") ? "text-emerald-700" : "text-slate-900";

export function LedgerPage() {
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);

  const query = { ...toQuery(applied), direction, limit: PAGE, offset };
  const ledger = useLedger(query);
  const balances = useBalances({ ...toQuery(applied), direction, show: "all", limit: PAGE });

  const apply = () => {
    setApplied(draft);
    // A cursor carried across a filter change seeks into a set that no longer
    // exists — §5j found the same thing on inward challans.
    setOffset(0);
  };

  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setOffset(0);
  };

  const partyLabel = direction === "out" ? "Supplier" : "Customer";

  return (
    <>
      <PageHeader
        title="Ledger and balances"
        description="What is owed, and every document behind it"
        actions={
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

      <ReportFilters
        value={draft}
        onChange={setDraft}
        onApply={apply}
        onReset={reset}
        partyLabel={partyLabel}
      />

      {/* Panel 1 — the summary, one row per site and party. */}
      <section className="mb-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="heading text-sm">Balance summary</h2>
          <ExportButtons
            kind="balances"
            query={{ ...toQuery(applied), direction, show: "all" }}
          />
        </div>
        {balances.isError && (
          <Alert icon={AlertTriangle}>The balance summary could not be loaded.</Alert>
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
          <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Site</th>
                  <th className="px-3 py-2 text-left font-medium">{partyLabel}</th>
                  <th className="px-3 py-2 text-right font-medium">Credit</th>
                  <th className="px-3 py-2 text-right font-medium">Debit</th>
                  <th className="px-3 py-2 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {balances.data.rows.map((row) => (
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
                  <td className="tabular px-3 py-2 text-right text-emerald-700">
                    {formatMoney(balances.data.totalCredit)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-rose-700">
                    {formatMoney(balances.data.totalDebit)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-slate-900">
                    {formatMoney(balances.data.closingBalance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Net is credit less debit. Purchase returns and credit notes reduce the
          balance, which is what the Debit column already says they do.
        </p>
      </section>

      {/* Panel 2 — the ledger, with the running balance. */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="heading text-sm">Ledger</h2>
          <ExportButtons kind="ledger" withByParty query={{ ...toQuery(applied), direction }} />
        </div>
        {ledger.isError && <Alert icon={AlertTriangle}>The ledger could not be loaded.</Alert>}
        {ledger.isPending && (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 aria-hidden className="size-4 animate-spin" /> Loading ledger
          </div>
        )}
        {ledger.data && ledger.data.rows.length === 0 && (
          <EmptyState title="No entries" description="No documents match these filters." />
        )}
        {ledger.data && ledger.data.rows.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
              <table className="w-full min-w-[56rem] border-collapse text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Document</th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">{partyLabel}</th>
                    <th className="px-3 py-2 text-left font-medium">Site</th>
                    <th className="px-3 py-2 text-left font-medium">Group</th>
                    <th className="px-3 py-2 text-right font-medium">Credit</th>
                    <th className="px-3 py-2 text-right font-medium">Debit</th>
                    <th className="px-3 py-2 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ledger.data.rows.map((row) => (
                    <tr key={row.id} className="align-top hover:bg-slate-50/70">
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
                        {/*
                          Sales invoices carry no site group at all — the legacy
                          sales ledger renders this column bound to a property
                          its own model does not have, so it has never shown
                          anything. Said, rather than drawn empty.
                        */}
                        {row.siteGroupName ?? (
                          <span className="text-xs text-slate-400">
                            {direction === "in" ? "Not recorded on sales" : "—"}
                          </span>
                        )}
                      </td>
                      <td className="tabular px-3 py-2 text-right text-emerald-700">
                        {row.effect === "credit" ? formatMoney(row.credit) : ""}
                      </td>
                      <td className="tabular px-3 py-2 text-right text-rose-700">
                        {row.effect === "debit" ? formatMoney(row.debit) : ""}
                      </td>
                      <td
                        className={`tabular px-3 py-2 text-right font-medium ${balanceTone(row.balance)}`}
                      >
                        {formatMoney(row.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 text-sm font-medium">
                  <tr>
                    <td className="px-3 py-2 text-slate-500" colSpan={5}>
                      Total over every entry matching these filters
                    </td>
                    <td className="tabular px-3 py-2 text-right text-emerald-700">
                      {formatMoney(ledger.data.totalCredit)}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-rose-700">
                      {formatMoney(ledger.data.totalDebit)}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-slate-900">
                      {formatMoney(ledger.data.closingBalance)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>
                Showing {offset + 1} to {Math.min(offset + PAGE, ledger.data.total)} of{" "}
                {ledger.data.total}. The balance runs across pages.
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={ledger.data.nextCursor === null}
                  onClick={() => setOffset(offset + PAGE)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}
