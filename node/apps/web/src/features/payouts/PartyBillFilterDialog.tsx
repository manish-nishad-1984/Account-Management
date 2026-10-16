import { useEffect, useMemo, useState } from "react";
import { Button, Modal, TextField } from "../../components/ui";
import { formatMoney } from "../../lib/format";
import { fromPaise, toPaise } from "./decimal";
import { formatListDate } from "./message";
import { AgeBadge } from "./AgeBadge";

export interface FilterableBill {
  key: string;
  displayNo: string;
  documentDate: string | null;
  siteName: string | null;
  pending: string;
}

/** The date part of an ISO date or timestamp, to compare as text. */
const dayOf = (value: string | null): string => (value ?? "").slice(0, 10);

/**
 * "Filter" beside a party on the payout builder (client request, 17 Oct 2026):
 * the same bills the party's sub-list shows, narrowed by a From and To date.
 *
 * The bills inside the dates start ticked; the person can untick any, then OK
 * ticks exactly those on the party in the builder (and unticks the party's others).
 * Cancel changes nothing.
 */
export function PartyBillFilterDialog({
  partyName,
  bills,
  onApply,
  onClose,
}: {
  /** Null keeps it closed. */
  partyName: string | null;
  /** The party's bills that can still be paid. */
  bills: FilterableBill[];
  onApply: (keys: string[]) => void;
  onClose: () => void;
}) {
  const open = partyName !== null;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [off, setOff] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setFrom("");
      setTo("");
      setOff(new Set());
    }
  }, [open]);

  const inRange = useMemo(
    () =>
      bills.filter((bill) => {
        const day = dayOf(bill.documentDate);
        if (from && (!day || day < from)) return false;
        if (to && (!day || day > to)) return false;
        return true;
      }),
    [bills, from, to],
  );
  const chosen = inRange.filter((bill) => !off.has(bill.key));
  const total = fromPaise(chosen.reduce((sum, bill) => sum + (toPaise(bill.pending) ?? 0n), 0n));
  const badRange = from !== "" && to !== "" && to < from;

  const toggle = (key: string) =>
    setOff((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Filter bills · ${partyName ?? ""}`}
      description="Choose a date range; the bills inside it are ticked for this party when you press OK"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={badRange} onClick={() => onApply(chosen.map((bill) => bill.key))}>
            OK
          </Button>
        </>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-3">
        <TextField label="From date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <TextField label="To date" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>
      {badRange && (
        <p role="alert" className="mb-2 text-xs text-red-600">
          The To date is before the From date.
        </p>
      )}

      <div className="max-h-72 overflow-auto rounded-lg ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-slate-100">
            {inRange.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-slate-500">No bill of this party falls in these dates</td>
              </tr>
            )}
            {inRange.map((bill) => (
              <tr key={bill.key} className="hover:bg-slate-50">
                <td className="px-3 py-1.5">
                  <input
                    type="checkbox"
                    aria-label={`Pay bill ${bill.displayNo}`}
                    className="size-4 rounded border-slate-300 text-brand-600"
                    checked={!off.has(bill.key)}
                    onChange={() => toggle(bill.key)}
                  />
                </td>
                <td className="px-2 py-1.5 text-slate-700">
                  <span className="font-medium">{bill.displayNo}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {[bill.documentDate ? formatListDate(bill.documentDate) : null, bill.siteName].filter(Boolean).join(" · ")}
                  </span>
                  <AgeBadge documentDate={bill.documentDate} />
                </td>
                <td className="tabular px-3 py-1.5 text-right text-slate-700">{formatMoney(bill.pending)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-slate-600" aria-live="polite">
        {chosen.length} of {bills.length} {bills.length === 1 ? "bill" : "bills"} will be ticked, totalling{" "}
        <span className="tabular font-medium text-slate-900">{formatMoney(total)}</span>
      </p>
    </Modal>
  );
}
