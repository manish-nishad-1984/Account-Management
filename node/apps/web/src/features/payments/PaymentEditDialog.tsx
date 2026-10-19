import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { updatePaymentSchema, type PaymentRow } from "@accountmanagement/contracts";
import { FormDialog, FormSection, SelectField, TextField } from "../../components/ui";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { ApiError } from "../../lib/api-client";
import { usePayment, useUpdatePayment } from "./api";

const METHODS = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Adjustment"];

/**
 * Edit ONE payment (client, 19 Oct 2026: "can't edit any payment records").
 *
 * The list had an Edit icon from the start, but the only form on the screen was
 * the "Record payments" repeater, which creates — so the icon did nothing.
 *
 * What can change is what the update contract allows: the date, the site, the
 * amount, the method, the reference and the description. The party, the company,
 * the direction and the kind are shown and fixed — changing those moves a
 * balance by twice the amount with nothing on screen to say so (see
 * `updatePaymentSchema`). A wrong party is a delete and a new payment.
 */
/** What the dialog needs to know of the payment before it loads: its id and the names it shows. */
export type PaymentEditTarget = Pick<PaymentRow, "id" | "kind" | "direction" | "partyName" | "companyName" | "siteId" | "siteName">;

export function PaymentEditDialog({
  row,
  readOnly = false,
  onClose,
}: {
  /** The payment's list or ledger row, for the names; null keeps the dialog closed. */
  row: PaymentEditTarget | null;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const open = row !== null;
  const detail = usePayment(row?.id ?? null);
  const update = useUpdatePayment();
  const queryClient = useQueryClient();
  const scope = useSiteScope();

  const [paymentDate, setPaymentDate] = useState("");
  const [siteId, setSiteId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !detail.data) return;
    const d = detail.data;
    setPaymentDate((d.paymentDate ?? "").slice(0, 10));
    setSiteId(d.siteId ?? "");
    setAmount(d.amount);
    setMethod(d.method ?? "");
    setReferenceNo(d.referenceNo ?? "");
    setDescription(d.description ?? "");
    setError(null);
    // Applied once per payment opened; a refetch on window focus must not wipe the typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, detail.data?.id]);

  const save = async () => {
    if (!row) return;
    setError(null);
    const parsed = updatePaymentSchema.safeParse({
      paymentDate: paymentDate || null,
      siteId: siteId || null,
      amount: amount.replace(/,/g, "").trim(),
      method: method || null,
      referenceNo: referenceNo.trim() || null,
      description: description.trim() || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the figures");
      return;
    }
    try {
      await update.mutateAsync({ id: row.id, body: parsed.data });
      // A payment moves every balance that counts it.
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void queryClient.invalidateQueries({ queryKey: ["payouts"] });
      onClose();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The payment could not be saved");
    }
  };

  const opening = row?.kind === "opening_balance";
  const siteOptions = [
    { value: "", label: opening ? "Not site-specific" : "No site" },
    ...scope.sites.map((site) => ({ value: site.id, label: site.name })),
    // A site the user's scope does not list is still the payment's, and stays chosen.
    ...(row?.siteId && !scope.sites.some((site) => site.id === row.siteId)
      ? [{ value: row.siteId, label: row.siteName ?? "Its site" }]
      : []),
  ];
  const methodOptions = [
    { value: "", label: "Not given" },
    ...METHODS.map((m) => ({ value: m, label: m })),
    ...(method && !METHODS.includes(method) ? [{ value: method, label: method }] : []),
  ];

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={() => void save()}
      title={opening ? "Edit opening balance" : "Edit payment"}
      description={row ? `${row.partyName} · ${row.companyName}` : undefined}
      formError={error}
      pending={update.isPending}
      submitLabel="Save changes"
      readOnly={readOnly}
      size="md"
    >
      {detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading payment…</p>
      ) : (
        <FormSection title={row?.direction === "in" ? "Receipt" : "Payment"} columns={2}>
          <TextField label="Date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
          <TextField
            label="Amount"
            required
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            hint="Positive, up to 2 decimal places"
          />
          <SelectField label="Site" value={siteId} options={siteOptions} onChange={(event) => setSiteId(event.target.value)} />
          <SelectField label="Method" value={method} options={methodOptions} onChange={(event) => setMethod(event.target.value)} />
          <TextField label="Reference no." maxLength={100} value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} />
          <TextField label="Description" maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} />
        </FormSection>
      )}
    </FormDialog>
  );
}
