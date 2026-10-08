import { useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { ConfirmPayoutList, PayoutListDetail } from "@accountmanagement/contracts";
import { Alert, Button, Modal, SelectField, TextField } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { todayInput } from "../../lib/dates";
import { formatMoney } from "../../lib/format";
import { AmountField } from "./AmountField";
import { useConfirmPayoutList } from "./api";
import { fromPaise, sumAmounts, toPaise } from "./decimal";
import { formatListDate } from "./message";

const METHODS = ["Cash", "Cheque", "NEFT", "RTGS", "UPI"];

const billKey = (bill: { source: string; documentId: string }) => `${bill.source}:${bill.documentId}`;

/**
 * CONFIRM A PAYOUT LIST (7 Oct 2026): the owner has paid, and the person who holds
 * the right to confirm records it here.
 *
 * Every bill is filled in with what the list PLANNED to pay. The person confirming
 * changes only what the owner said was different: a bill paid less stays open for
 * the rest, a bill not paid is set to 0, and an amount paid above the bills goes in
 * the party's "Extra" box and is kept as an advance.
 *
 * What it does on the server is in `PayoutsRepository.confirm`: one payment for each
 * party and each site its bills belong to, tied to those bills, in one transaction.
 */
export function ConfirmPayoutDialog({
  open,
  list,
  onClose,
}: {
  open: boolean;
  list: PayoutListDetail;
  onClose: () => void;
}) {
  const confirm = useConfirmPayoutList();
  const [paymentDate, setPaymentDate] = useState(todayInput());
  const [method, setMethod] = useState("NEFT");
  const [referenceNo, setReferenceNo] = useState("");
  const [paid, setPaid] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  /** By bill key, so a message sits on its row. */
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  // Seeded once per opening from the list, never again: typing must not be undone by a refetch.
  useEffect(() => {
    if (!open) return;
    setPaymentDate(todayInput());
    setMethod("NEFT");
    setReferenceNo("");
    setPaid(Object.fromEntries(list.lines.flatMap((line) => line.invoices.map((bill) => [billKey(bill), bill.amount]))));
    setExtra({});
    setBanner(null);
    setRowErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, list.id]);

  const withoutBills = list.lines.filter((line) => line.invoices.length === 0);

  const totals = useMemo(() => {
    const planned = sumAmounts(list.lines.map((line) => line.amount));
    const billsPaid = sumAmounts(list.lines.flatMap((line) => line.invoices.map((bill) => paid[billKey(bill)] ?? "")));
    const extras = sumAmounts(Object.values(extra));
    const all = sumAmounts([billsPaid, extras]);
    const difference = (toPaise(all) ?? 0n) - (toPaise(planned) ?? 0n);
    return { planned, all, difference };
  }, [list.lines, paid, extra]);

  const submit = async () => {
    setBanner(null);
    setRowErrors({});
    const body: ConfirmPayoutList = {
      paymentDate,
      method: method || null,
      referenceNo: referenceNo.trim() === "" ? null : referenceNo.trim(),
      lines: list.lines
        .filter((line) => line.invoices.length > 0)
        .map((line) => ({
          partyId: line.partyId,
          bills: line.invoices.map((bill) => ({
            source: bill.source,
            documentId: bill.documentId,
            paid: (paid[billKey(bill)] ?? "").trim() === "" ? "0" : (paid[billKey(bill)] ?? "0").trim(),
          })),
          extra: (extra[line.partyId] ?? "").trim() === "" ? null : (extra[line.partyId] ?? "").trim(),
        })),
    };
    try {
      await confirm.mutateAsync({ id: list.id, body });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.issues && error.issues.length > 0) {
        // "lines.0.bills.1.paid": the message goes on that bill's row.
        const placed: Record<string, string> = {};
        for (const issue of error.issues) {
          const match = /^lines\.(\d+)\.bills\.(\d+)\.paid$/.exec(issue.path);
          const line = match ? list.lines.filter((l) => l.invoices.length > 0)[Number(match[1])] : undefined;
          const bill = line?.invoices[Number(match?.[2])];
          if (bill) placed[billKey(bill)] = issue.message;
        }
        setRowErrors(placed);
        setBanner(error.message);
      } else {
        setBanner(error instanceof ApiError ? error.message : "Could not confirm this list. Please try again.");
      }
    }
  };

  const differenceText =
    totals.difference === 0n
      ? "Same as planned"
      : totals.difference < 0n
        ? `${formatMoney(fromPaise(-totals.difference))} less than planned`
        : `${formatMoney(fromPaise(totals.difference))} more than planned`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Confirm payout"
      description="Record what was actually paid. The bills are marked paid and the payments are made."
      size="xl"
      footer={
        <>
          <div aria-live="polite" className="mr-auto text-sm text-slate-700">
            Paid <span className="tabular ml-1 text-base font-semibold text-slate-900">{formatMoney(totals.all)}</span>
            <span className={totals.difference === 0n ? "ml-3 text-slate-500" : "ml-3 font-medium text-amber-700"}>
              {differenceText}
            </span>
          </div>
          <Button variant="secondary" onClick={onClose} disabled={confirm.isPending}>
            Cancel
          </Button>
          <Button
            icon={CheckCircle2}
            onClick={() => void submit()}
            loading={confirm.isPending}
            disabled={withoutBills.length > 0}
          >
            Confirm payout
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {banner && <Alert tone="danger">{banner}</Alert>}
        {withoutBills.length > 0 && (
          <Alert tone="warning">
            {withoutBills.map((line) => line.partyName).join(", ")}{" "}
            {withoutBills.length === 1 ? "has" : "have"} no bills ticked, so there is nothing to settle. Close this, open
            the list, tick the bills paid, save it, and confirm again.
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="Payment date"
            type="date"
            required
            value={paymentDate}
            onChange={(event) => setPaymentDate(event.target.value)}
          />
          <SelectField
            label="Paid by"
            options={METHODS.map((value) => ({ value, label: value }))}
            value={method}
            onChange={(event) => setMethod(event.target.value)}
          />
          <TextField
            label="Cheque / reference no."
            maxLength={120}
            value={referenceNo}
            onChange={(event) => setReferenceNo(event.target.value)}
          />
        </div>

        <div className="rounded-lg ring-1 ring-inset ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Party and bills</th>
                <th className="px-2 py-1.5 text-right font-medium">Planned</th>
                <th className="w-44 px-2 py-1.5 text-right font-medium">Actually paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.lines.map((line) => {
                const partyPaid = sumAmounts(line.invoices.map((bill) => paid[billKey(bill)] ?? ""));
                return (
                  <PartyRows key={line.id} line={line} partyPaid={partyPaid}>
                    {line.invoices.map((bill) => (
                      <tr key={billKey(bill)}>
                        <td className="py-1.5 pl-8 pr-2 align-top text-slate-700">
                          <span className="font-medium">{bill.displayNo}</span>
                          <span className="ml-2 text-xs text-slate-400">
                            {[bill.documentDate ? formatListDate(bill.documentDate) : null, bill.siteName]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          {rowErrors[billKey(bill)] && (
                            <div className="text-xs font-medium text-rose-600">{rowErrors[billKey(bill)]}</div>
                          )}
                        </td>
                        <td className="tabular px-2 py-1.5 text-right align-top text-slate-600">{formatMoney(bill.amount)}</td>
                        <td className="px-2 py-1 align-top">
                          <AmountField
                            label={`Paid for bill ${bill.displayNo}`}
                            labelHidden
                            compact
                            inputMode="decimal"
                            placeholder="0.00"
                            className="[&_input]:text-right"
                            value={paid[billKey(bill)] ?? ""}
                            onValue={(raw) => setPaid((current) => ({ ...current, [billKey(bill)]: raw }))}
                          />
                        </td>
                      </tr>
                    ))}
                    {line.invoices.length > 0 && (
                      <tr>
                        <td className="py-1.5 pl-8 pr-2 text-xs text-slate-500">
                          Paid more than these bills? Put the extra here. It is kept as an advance.
                        </td>
                        <td />
                        <td className="px-2 py-1">
                          <AmountField
                            label={`Extra paid to ${line.partyName}`}
                            labelHidden
                            compact
                            inputMode="decimal"
                            placeholder="Extra"
                            className="[&_input]:text-right"
                            value={extra[line.partyId] ?? ""}
                            onValue={(raw) => setExtra((current) => ({ ...current, [line.partyId]: raw }))}
                          />
                        </td>
                      </tr>
                    )}
                  </PartyRows>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

/** A party's heading row, with what is planned and what is paid of it, then its bills. */
function PartyRows({
  line,
  partyPaid,
  children,
}: {
  line: PayoutListDetail["lines"][number];
  partyPaid: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr className="bg-slate-50/60">
        <td className="px-3 py-1.5 font-medium text-slate-900">{line.partyName}</td>
        <td className="tabular px-2 py-1.5 text-right font-medium text-slate-700">{formatMoney(line.amount)}</td>
        <td className="tabular px-2 py-1.5 text-right font-medium text-slate-900">
          {line.invoices.length > 0 ? formatMoney(partyPaid) : "—"}
        </td>
      </tr>
      {children}
    </>
  );
}
