import { useState } from "react";
import clsx from "clsx";
import { Alert, Button, Modal } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { formatDate, formatMoney } from "../../lib/format";
import { useLedger } from "../reports/api";

const PAGE = 200;

/**
 * A supplier's ledger in a popup, opened from the eye beside the party on the
 * payout builder (client request, 13 Oct 2026), so the office can check what was
 * billed and paid without leaving the list.
 *
 * It is the Ledger report for ONE supplier, in the same site and company scope
 * the builder is showing, so its closing balance is the party's outstanding on
 * the row.
 */
export function PartyLedgerDialog({
  partyId,
  partyName,
  companyId,
  siteId,
  onClose,
}: {
  partyId: string | null;
  partyName: string;
  companyId: string | null;
  siteId: string | null;
  onClose: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const ledger = useLedger(
    {
      direction: "out",
      partyId: partyId ?? undefined,
      companyId: companyId ?? undefined,
      siteId: siteId ?? undefined,
      limit: PAGE,
      offset,
    },
    partyId !== null,
  );

  const close = () => {
    setOffset(0);
    onClose();
  };
  const data = ledger.data;

  return (
    <Modal
      open={partyId !== null}
      onClose={close}
      title={`Ledger · ${partyName}`}
      size="xl"
      footer={<Button onClick={close}>Close</Button>}
    >
      {ledger.error ? (
        <Alert tone="danger">
          {ledger.error instanceof ApiError ? ledger.error.message : "Could not load the ledger"}
        </Alert>
      ) : !data ? (
        <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-3">
          <div className="max-h-[60vh] overflow-auto rounded-lg ring-1 ring-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Document</th>
                  <th className="px-3 py-2 font-medium">Site</th>
                  <th className="px-3 py-2 text-right font-medium">Credit</th>
                  <th className="px-3 py-2 text-right font-medium">Debit</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                      Nothing recorded for this supplier
                    </td>
                  </tr>
                )}
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="tabular whitespace-nowrap px-3 py-1.5 text-slate-700">
                      {row.documentDate ? formatDate(row.documentDate) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{row.label}</td>
                    <td className="px-3 py-1.5 font-medium text-slate-900">{row.displayNo}</td>
                    <td className="px-3 py-1.5 text-slate-600">{row.siteName ?? "—"}</td>
                    <td className="tabular px-3 py-1.5 text-right text-emerald-700">
                      {row.effect === "credit" ? formatMoney(row.credit) : ""}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right text-rose-700">
                      {row.effect === "debit" ? formatMoney(row.debit) : ""}
                    </td>
                    <td
                      className={clsx(
                        "tabular px-3 py-1.5 text-right font-medium",
                        row.balance.startsWith("-") ? "text-amber-700" : "text-slate-900",
                      )}
                    >
                      {formatMoney(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-slate-50 font-medium text-slate-900">
                <tr>
                  <td colSpan={4} className="px-3 py-2">
                    Total
                  </td>
                  <td className="tabular px-3 py-2 text-right text-emerald-700">{formatMoney(data.totalCredit)}</td>
                  <td className="tabular px-3 py-2 text-right text-rose-700">{formatMoney(data.totalDebit)}</td>
                  <td className="tabular px-3 py-2 text-right">{formatMoney(data.closingBalance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {data.total > PAGE && (
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>
                {offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}
              </span>
              <span className="flex gap-2">
                <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                  Previous
                </Button>
                <Button variant="secondary" disabled={data.nextCursor === null && offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
                  Next
                </Button>
              </span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
