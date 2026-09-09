import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CreatePayment } from "@accountmanagement/contracts";
import { Alert, Button, Modal, SelectField, TextField } from "../../components/ui";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { useCompanyOptions, useSupplierOptions } from "../purchase-orders/api";
import { useCreatePayments } from "./api";

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
}

const METHODS = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Adjustment"];

const blankRow = (): Row => ({
  key: Math.random().toString(36).slice(2),
  kind: "payment",
  siteId: "",
  paymentDate: new Date().toISOString().slice(0, 10),
  amount: "",
  method: "",
  referenceNo: "",
  description: "",
});

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
      siteGroupId: null,
      paymentDate: row.paymentDate || null,
      amount: row.amount,
      description: row.description || null,
      method: row.method || null,
      referenceNo: row.referenceNo || null,
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={direction === "out" ? "Record payments to a supplier" : "Record receipts from a customer"}
      description="Several rows are saved together, as one payment run"
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

      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <SelectField
          label={direction === "out" ? "Supplier" : "Customer"}
          placeholder="Choose…"
          value={partyId}
          onChange={(event) => setPartyId(event.target.value)}
          options={(suppliers.data?.rows ?? []).map((supplier) => ({
            value: supplier.id,
            label: supplier.name,
          }))}
        />

        <SelectField
          label="Company"
          placeholder="Choose…"
          value={companyId}
          onChange={(event) => setCompanyId(event.target.value)}
          options={(companies.data?.rows ?? []).map((company) => ({
            value: company.id,
            label: company.name,
          }))}
        />
      </div>

      <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
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
              <tr key={row.key} className="align-top">
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
                    onChange={(event) => patch(row.key, { siteId: event.target.value })}
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
                <td className="px-2 py-2">
                  {rows.length > 1 && (
                    <Button
                      variant="ghost"
                      icon={Trash2}
                      className="px-1.5 py-1 text-xs text-rose-600"
                      aria-label={`Remove row ${index + 1}`}
                      onClick={() =>
                        setRows((current) => current.filter((one) => one.key !== row.key))
                      }
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button
        variant="secondary"
        icon={Plus}
        className="mt-3"
        onClick={() => setRows((current) => [...current, blankRow()])}
      >
        Add row
      </Button>
    </Modal>
  );
}
