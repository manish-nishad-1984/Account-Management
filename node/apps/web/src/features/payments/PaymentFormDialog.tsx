import { Fragment, useEffect, useState } from "react";
import { Building2, ListChecks, Plus, Trash2, Wallet } from "lucide-react";
import type { CreatePayment } from "@accountmanagement/contracts";
import {
  Alert,
  Button,
  CheckboxField,
  FormSection,
  IconButton,
  Modal,
  SelectField,
  SummaryStrip,
  TextField,
} from "../../components/ui";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { useCompanyOptions, useSupplierOptions } from "../purchase-orders/api";
import { useCreatePayments } from "./api";
import { todayInput } from "../../lib/dates";
import { formatDate, formatMoney } from "../../lib/format";
import { usePendingLedger } from "../reports/api";
import { AmountField } from "../payouts/AmountField";

/**
 * The Payment Actions repeater, from `/Report/ReportDetails` panel 3.
 *
 * The legacy screen adds a row at a time and posts them all on one click
 * (`InsertPayOutDetailsReport`), which is a real convenience: a month of site
 * deliveries is settled in one sitting. Kept.
 *
 * The party and the company are chosen ONCE, above the rows, because
 * `PayOutScript.js:682` reads both from hidden fields outside the repeater — one
 * payment run is to one supplier. Each row carries its own site, date, amount
 * and description, which is what the legacy row actually contains.
 */

interface Row {
  key: string;
  kind: "payment" | "opening_balance";
  siteId: string;
  paymentDate: string;
  amount: string;
  method: string;
  referenceNo: string;
  description: string;
  /** The bills this payment names, as "source:documentId" -> the amount put on that bill. */
  bills: Record<string, string>;
  billsOpen: boolean;
}

const METHODS = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Adjustment"];

const blankRow = (): Row => ({
  key: Math.random().toString(36).slice(2),
  kind: "payment",
  siteId: "",
  // `todayInput`, not `toISOString().slice(0, 10)`: that converts to UTC first,
  // so in India every payment entered after 18:30 was dated YESTERDAY.
  paymentDate: todayInput(),
  amount: "",
  method: "",
  referenceNo: "",
  description: "",
  bills: {},
  billsOpen: false,
});

const toPaise = (value: string) => Math.round((Number.parseFloat(value) || 0) * 100);
const sumBills = (bills: Record<string, string>) =>
  (Object.values(bills).reduce((sum, amount) => sum + toPaise(amount), 0) / 100).toFixed(2);

/**
 * Which bills a payment pays (8 Oct 2026). Optional: left alone, the payment
 * settles the oldest bills as it always did. Ticking a bill puts what is pending
 * on it in a box that can be lowered for a part payment, and the payment's
 * amount follows the total.
 */
function NamedBills({
  partyId,
  companyId,
  siteId,
  bills,
  onChange,
}: {
  partyId: string;
  companyId: string;
  siteId: string;
  bills: Record<string, string>;
  onChange: (bills: Record<string, string>) => void;
}) {
  const pending = usePendingLedger({ direction: "out", partyId, companyId, siteId, limit: 200 });
  const rows = pending.data?.rows ?? [];

  if (pending.isLoading) return <p className="text-xs text-slate-500">Loading this supplier's unpaid bills…</p>;
  if (rows.length === 0) {
    return <p className="text-xs text-slate-500">No unpaid bills for this supplier at this site and company.</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((bill) => {
        const key = `${bill.source}:${bill.documentId}`;
        const ticked = key in bills;
        return (
          <li key={key} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
            <CheckboxField
              label={`Pay bill ${bill.displayNo}`}
              checked={ticked}
              onChange={(event) => {
                const next = { ...bills };
                if (event.target.checked) next[key] = bill.pending;
                else delete next[key];
                onChange(next);
              }}
              className="min-w-40"
            />
            <span className="text-xs text-slate-500">
              {bill.documentDate ? formatDate(bill.documentDate) : "No date"} · {formatMoney(bill.pending)} pending
            </span>
            {ticked && (
              <AmountField
                label={`Paid on bill ${bill.displayNo}`}
                labelHidden
                inputMode="decimal"
                value={bills[key]!}
                onValue={(raw) => onChange({ ...bills, [key]: raw })}
                className="ml-auto w-36"
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function PaymentFormDialog({
  open,
  direction,
  onClose,
}: {
  open: boolean;
  direction: "out" | "in";
  onClose: () => void;
}) {
  const scope = useSiteScope();
  const suppliers = useSupplierOptions();
  const companies = useCompanyOptions();
  const create = useCreatePayments();

  const [partyId, setPartyId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [error, setError] = useState<string | null>(null);

  // A dialog that keeps the previous run's rows would post them again on the
  // next open, against whichever party is chosen then.
  useEffect(() => {
    if (open) {
      setPartyId("");
      setCompanyId("");
      setRows([blankRow()]);
      setError(null);
    }
  }, [open]);

  const patch = (key: string, change: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const submit = async () => {
    setError(null);

    if (!partyId || !companyId) {
      setError(direction === "out" ? "Choose a supplier and a company." : "Choose a customer and a company.");
      return;
    }

    const payload: CreatePayment[] = rows.map((row) => ({
      direction,
      kind: row.kind,
      partyId,
      companyId,
      // An opening balance carries no site — the server refuses one on a
      // payment and accepts its absence here, which is the source's own rule.
      siteId: row.kind === "opening_balance" ? null : row.siteId || null,
      siteLocationId: null,
      paymentDate: row.paymentDate || null,
      amount: row.amount,
      description: row.description || null,
      method: row.method || null,
      referenceNo: row.referenceNo || null,
      allocations:
        row.kind === "payment"
          ? Object.entries(row.bills)
              .filter(([, amount]) => toPaise(amount) > 0)
              .map(([key, amount]) => {
                const [source, documentId] = key.split(":") as ["invoice" | "opening_balance", string];
                return { source, documentId, amount };
              })
          : [],
    }));

    const missing = payload.findIndex(
      (row) => !row.amount || (row.kind === "payment" && !row.siteId),
    );
    if (missing >= 0) {
      setError(`Row ${missing + 1} needs an amount${payload[missing]!.kind === "payment" ? " and a site" : ""}.`);
      return;
    }

    try {
      await create.mutateAsync({ payments: payload });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The payments could not be saved.");
    }
  };

  /*
    Summed from the typed text, not from the server: this dialog posts rows that
    do not exist yet. A row left blank or half-typed counts as nothing rather
    than breaking the total.
  */
  const runTotal = rows
    .reduce((sum, row) => sum + (Number.parseFloat(row.amount) || 0), 0)
    .toFixed(2);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={direction === "out" ? "Record payments to a supplier" : "Record receipts from a customer"}
      size="xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            Save {rows.length} {rows.length === 1 ? "payment" : "payments"}
          </Button>
        </div>
      }
    >
      {error && <Alert className="mb-3">{error}</Alert>}

      <FormSection
        icon={Building2}
        title={direction === "out" ? "Who is being paid" : "Who is paying"}
        columns={2}
      >
        <SelectField
          label={direction === "out" ? "Supplier" : "Customer"}
          placeholder="Choose…"
          value={partyId}
          onChange={(event) => {
            setPartyId(event.target.value);
            setRows((current) => current.map((row) => ({ ...row, bills: {} })));
          }}
          options={(suppliers.data?.rows ?? []).map((supplier) => ({
            value: supplier.id,
            label: supplier.name,
          }))}
        />

        <SelectField
          label="Company"
          placeholder="Choose…"
          value={companyId}
          onChange={(event) => {
            setCompanyId(event.target.value);
            setRows((current) => current.map((row) => ({ ...row, bills: {} })));
          }}
          options={(companies.data?.rows ?? []).map((company) => ({
            value: company.id,
            label: company.name,
          }))}
        />
      </FormSection>

      <FormSection
        icon={Wallet}
        title="Payments"
        description="Several rows are saved together, as one payment run"
        columns={1}
        action={
          <Button
            variant="outline"
            size="sm"
            icon={Plus}
            onClick={() => setRows((current) => [...current, blankRow()])}
          >
            Add row
          </Button>
        }
      >
        <div className="relative overflow-x-auto rounded-lg ring-1 ring-slate-200">
        <table className="w-full min-w-[54rem] border-collapse text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="w-8 px-2 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">Type</th>
              <th className="px-2 py-2 text-left font-medium">Site</th>
              <th className="px-2 py-2 text-left font-medium">Date</th>
              <th className="px-2 py-2 text-left font-medium">Amount</th>
              <th className="px-2 py-2 text-left font-medium">Method</th>
              <th className="px-2 py-2 text-left font-medium">Reference</th>
              <th className="px-2 py-2 text-left font-medium">Description</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <Fragment key={row.key}>
              <tr className="align-top">
                <td className="px-2 py-2 text-xs text-slate-400">{index + 1}</td>
                <td className="px-2 py-2">
                  <SelectField
                    label={`Type on row ${index + 1}`}
                    labelHidden
                    value={row.kind}
                    onChange={(event) =>
                      patch(row.key, { kind: event.target.value as Row["kind"] })
                    }
                    options={[
                      { value: "payment", label: "Payment" },
                      { value: "opening_balance", label: "Opening balance" },
                    ]}
                  />
                </td>
                <td className="px-2 py-2">
                  {/*
                    An opening balance belongs to the party, not a site, so the
                    control says so rather than being silently ignored.
                  */}
                  <SelectField
                    label={`Site on row ${index + 1}`}
                    labelHidden
                    value={row.siteId}
                    disabled={row.kind === "opening_balance"}
                    placeholder={row.kind === "opening_balance" ? "Not applicable" : "Choose…"}
                    onChange={(event) => patch(row.key, { siteId: event.target.value, bills: {} })}
                    options={scope.sites.map((site) => ({ value: site.id, label: site.name }))}
                  />
                </td>
                <td className="px-2 py-2">
                  <TextField
                    label={`Date on row ${index + 1}`}
                    labelHidden
                    type="date"
                    value={row.paymentDate}
                    onChange={(event) => patch(row.key, { paymentDate: event.target.value })}
                  />
                </td>
                <td className="px-2 py-2">
                  {/*
                    `inputMode` and not `type="number"`, which returns a float and
                    would put every rupee in this system through a double. Money
                    is a decimal string end to end (§5b decision 3).
                  */}
                  <TextField
                    label={`Amount on row ${index + 1}`}
                    labelHidden
                    inputMode="decimal"
                    placeholder="0.00"
                    value={row.amount}
                    onChange={(event) => patch(row.key, { amount: event.target.value })}
                  />
                </td>
                <td className="px-2 py-2">
                  <SelectField
                    label={`Method on row ${index + 1}`}
                    labelHidden
                    placeholder="—"
                    value={row.method}
                    onChange={(event) => patch(row.key, { method: event.target.value })}
                    options={METHODS.map((method) => ({ value: method, label: method }))}
                  />
                </td>
                <td className="px-2 py-2">
                  <TextField
                    label={`Reference on row ${index + 1}`}
                    labelHidden
                    placeholder="Cheque no."
                    value={row.referenceNo}
                    onChange={(event) => patch(row.key, { referenceNo: event.target.value })}
                  />
                </td>
                <td className="px-2 py-2">
                  <TextField
                    label={`Description on row ${index + 1}`}
                    labelHidden
                    value={row.description}
                    onChange={(event) => patch(row.key, { description: event.target.value })}
                  />
                </td>
                <td className="whitespace-nowrap px-2 py-2">
                  {direction === "out" && row.kind === "payment" && (
                    <IconButton
                      label={`Choose bills on row ${index + 1}`}
                      icon={ListChecks}
                      size="sm"
                      disabled={!partyId || !companyId || !row.siteId}
                      title={
                        !partyId || !companyId || !row.siteId
                          ? "Choose the supplier, company and site first"
                          : "Say which bills this pays"
                      }
                      onClick={() => patch(row.key, { billsOpen: !row.billsOpen })}
                    />
                  )}
                  {rows.length > 1 && (
                    <IconButton
                      label={`Remove row ${index + 1}`}
                      icon={Trash2}
                      tone="destructive"
                      size="sm"
                      onClick={() =>
                        setRows((current) => current.filter((one) => one.key !== row.key))
                      }
                    />
                  )}
                </td>
              </tr>
              {row.billsOpen && partyId && companyId && row.siteId && (
                <tr className="bg-slate-50/60">
                  <td />
                  <td colSpan={8} className="px-2 py-2">
                    <p className="mb-1 text-xs font-medium text-slate-600">
                      Bills this payment pays (leave empty to settle the oldest first)
                    </p>
                    <NamedBills
                      partyId={partyId}
                      companyId={companyId}
                      siteId={row.siteId}
                      bills={row.bills}
                      onChange={(bills) =>
                        patch(row.key, {
                          bills,
                          amount: Object.keys(bills).length > 0 ? sumBills(bills) : row.amount,
                        })
                      }
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

        {/* What the run comes to, in the strip the invoices use. */}
        <SummaryStrip
          items={[
            { label: "Rows", value: String(rows.length) },
            { label: "Total", value: formatMoney(runTotal), strong: true },
          ]}
        />
      </FormSection>
    </Modal>
  );
}
