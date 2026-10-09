import { useEffect, useMemo, useState } from "react";
import { MinusCircle, PlusCircle, Trash2, Wallet } from "lucide-react";
import { createClientIncomeSchema } from "@accountmanagement/contracts";
import { Button, FormDialog, FormSection, IconButton, SelectField, TextAreaField, TextField } from "../../components/ui";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { ApiError } from "../../lib/api-client";
import { todayInput } from "../../lib/dates";
import { formatMoney } from "../../lib/format";
import { useCompanyOptions } from "../purchase-orders/api";
import { useClientsOfSite } from "../clients/api";
import { AmountField } from "../payouts/AmountField";
import { useClientIncome, useCreateClientIncome, useUpdateClientIncome } from "./api";

/**
 * Record income (9 Oct 2026): money a project's client has paid.
 *
 * The PROJECT is the one in the header and is not chosen again (only a user who is
 * looking at every site picks one). The COMPANY it was received in is chosen -
 * site and company have never been tied together in this application. The CLIENT
 * is one of those linked to the project.
 *
 *   FINAL TOTAL = amount + additions - deductions
 *
 * Additions and deductions are any number of lines, each with an amount and a
 * remark. The total shown here is a preview; the server works out the real one.
 */
interface Line {
  key: string;
  amount: string;
  remark: string;
}

const METHODS = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Adjustment"];

const blankLine = (): Line => ({ key: Math.random().toString(36).slice(2), amount: "", remark: "" });

const toPaise = (value: string) => Math.round((Number.parseFloat(value) || 0) * 100);
const sum = (lines: Line[]) => lines.reduce((acc, line) => acc + toPaise(line.amount), 0);

export function ClientIncomeFormDialog({
  open,
  incomeId,
  onClose,
}: {
  open: boolean;
  incomeId: string | null;
  onClose: () => void;
}) {
  const isEdit = incomeId !== null;
  const scope = useSiteScope();
  const detail = useClientIncome(open && isEdit ? incomeId : null);
  const companies = useCompanyOptions();
  const create = useCreateClientIncome();
  const update = useUpdateClientIncome();

  const [siteId, setSiteId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [clientId, setClientId] = useState("");
  const [incomeDate, setIncomeDate] = useState(todayInput());
  const [amount, setAmount] = useState("");
  const [additions, setAdditions] = useState<Line[]>([]);
  const [deductions, setDeductions] = useState<Line[]>([]);
  const [method, setMethod] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const clients = useClientsOfSite(open && siteId ? siteId : null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!isEdit) {
      // The project is the header's; a user looking at every site chooses one.
      setSiteId(scope.siteId ?? "");
      setCompanyId("");
      setClientId("");
      setIncomeDate(todayInput());
      setAmount("");
      setAdditions([]);
      setDeductions([]);
      setMethod("");
      setReferenceNo("");
      setNote("");
    } else if (detail.data) {
      const data = detail.data;
      setSiteId(data.siteId);
      setCompanyId(data.companyId);
      setClientId(data.clientId);
      setIncomeDate(data.incomeDate);
      setAmount(data.amount);
      setAdditions(data.additions.map((line) => ({ key: Math.random().toString(36).slice(2), amount: line.amount, remark: line.remark ?? "" })));
      setDeductions(data.deductions.map((line) => ({ key: Math.random().toString(36).slice(2), amount: line.amount, remark: line.remark ?? "" })));
      setMethod(data.method ?? "");
      setReferenceNo(data.referenceNo ?? "");
      setNote(data.note ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, detail.data]);

  // With one client for the project there is nothing to choose between.
  const clientRows = clients.data?.rows ?? [];
  useEffect(() => {
    if (open && !isEdit && !clientId && clientRows.length === 1) setClientId(clientRows[0]!.id);
  }, [open, isEdit, clientId, clientRows]);

  const finalTotal = toPaise(amount) + sum(additions) - sum(deductions);

  const siteName = useMemo(
    () => scope.sites.find((site) => site.id === siteId)?.name ?? "",
    [scope.sites, siteId],
  );
  const siteLocked = isEdit || scope.siteId !== null;

  const submit = async () => {
    setError(null);
    const parsed = createClientIncomeSchema.safeParse({
      incomeDate,
      siteId,
      companyId,
      clientId,
      amount,
      additions: additions.filter((line) => line.amount || line.remark).map(({ amount, remark }) => ({ amount, remark })),
      deductions: deductions.filter((line) => line.amount || line.remark).map(({ amount, remark }) => ({ amount, remark })),
      method,
      referenceNo,
      note,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const field = first?.path[0];
      setError(
        field === "siteId"
          ? "Choose the project."
          : field === "companyId"
            ? "Choose the company the money was received in."
            : field === "clientId"
              ? "Choose the client."
              : (first?.message ?? "Check the entry."),
      );
      return;
    }
    try {
      if (isEdit) {
        await update.mutateAsync({ id: incomeId, body: parsed.data });
      } else {
        await create.mutateAsync(parsed.data);
      }
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The entry could not be saved.");
    }
  };

  const adjustments = (
    kind: "Additional" | "Deduction",
    lines: Line[],
    setLines: (next: Line[]) => void,
  ) => {
    const plus = kind === "Additional";
    return (
      <FormSection
        icon={plus ? PlusCircle : MinusCircle}
        title={plus ? "Additional (added to the total)" : "Deduction (taken from the total)"}
        columns={1}
        action={
          <Button variant="outline" size="sm" onClick={() => setLines([...lines, blankLine()])}>
            {plus ? "Add additional" : "Add deduction"}
          </Button>
        }
      >
        {lines.length === 0 ? (
          <p className="text-xs text-slate-500">{plus ? "No additional amount." : "No deduction."}</p>
        ) : (
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={line.key} className="grid grid-cols-[10rem_1fr_auto] items-start gap-2">
                <AmountField
                  label={`${kind} amount ${index + 1}`}
                  labelHidden
                  inputMode="decimal"
                  placeholder={`${kind} amount`}
                  value={line.amount}
                  onValue={(raw) => setLines(lines.map((one) => (one.key === line.key ? { ...one, amount: raw } : one)))}
                />
                <TextField
                  label={`${kind} remark ${index + 1}`}
                  labelHidden
                  placeholder={`${kind} remark`}
                  maxLength={200}
                  value={line.remark}
                  onChange={(event) =>
                    setLines(lines.map((one) => (one.key === line.key ? { ...one, remark: event.target.value } : one)))
                  }
                />
                <IconButton
                  label={`Remove ${kind.toLowerCase()} ${index + 1}`}
                  icon={Trash2}
                  tone="destructive"
                  size="sm"
                  onClick={() => setLines(lines.filter((one) => one.key !== line.key))}
                />
              </div>
            ))}
          </div>
        )}
      </FormSection>
    );
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={() => void submit()}
      title={isEdit ? "Edit income" : "Record income"}
      description="Money the project's client has paid us"
      formError={error}
      pending={create.isPending || update.isPending}
      submitLabel={isEdit ? "Save changes" : "Save income"}
      size="xl"
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading income…</p>
      ) : (
        <>
          <FormSection icon={Wallet} title="Received" columns={3}>
            {siteLocked ? (
              <div>
                <span className="block text-xs font-medium text-slate-700">Project</span>
                <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 ring-1 ring-slate-200">
                  {siteName || "…"}
                </p>
              </div>
            ) : (
              <SelectField
                label="Project"
                required
                placeholder="Choose…"
                value={siteId}
                onChange={(event) => {
                  setSiteId(event.target.value);
                  setClientId("");
                }}
                options={scope.sites.map((site) => ({ value: site.id, label: site.name }))}
              />
            )}
            <SelectField
              label="Company"
              required
              hint="The company the money came into"
              placeholder="Choose…"
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              options={(companies.data?.rows ?? []).map((company) => ({ value: company.id, label: company.name }))}
            />
            <SelectField
              label="Client"
              required
              placeholder={siteId ? (clientRows.length === 0 && !clients.isLoading ? "No client linked to this project" : "Choose…") : "Choose the project first"}
              disabled={!siteId}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              options={clientRows.map((client) => ({ value: client.id, label: client.name }))}
            />
            <TextField
              label="Date received"
              type="date"
              required
              value={incomeDate}
              onChange={(event) => setIncomeDate(event.target.value)}
            />
            <AmountField
              label="Amount"
              required
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onValue={setAmount}
            />
          </FormSection>

          {adjustments("Additional", additions, setAdditions)}
          {adjustments("Deduction", deductions, setDeductions)}

          <FormSection title="Payment details" columns={3}>
            <SelectField
              label="Method"
              placeholder="—"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              options={METHODS.map((one) => ({ value: one, label: one }))}
            />
            <TextField
              label="Reference"
              placeholder="Cheque / UTR no."
              value={referenceNo}
              onChange={(event) => setReferenceNo(event.target.value)}
            />
            <TextAreaField
              label="Note"
              rows={1}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormSection>

          <div
            aria-live="polite"
            className="flex flex-wrap items-baseline justify-end gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-4 py-3 text-sm ring-1 ring-slate-200"
          >
            <span className="text-slate-600">
              Amount <span className="tabular font-medium text-slate-900">{formatMoney((toPaise(amount) / 100).toFixed(2))}</span>
            </span>
            <span className="text-emerald-700">
              + <span className="tabular font-medium">{formatMoney((sum(additions) / 100).toFixed(2))}</span>
            </span>
            <span className="text-rose-700">
              − <span className="tabular font-medium">{formatMoney((sum(deductions) / 100).toFixed(2))}</span>
            </span>
            <span className="text-slate-700">
              Final total{" "}
              <span className={`tabular ml-1 text-lg font-semibold ${finalTotal < 0 ? "text-rose-700" : "text-slate-900"}`}>
                {formatMoney((finalTotal / 100).toFixed(2))}
              </span>
            </span>
            {finalTotal < 0 && <span className="w-full text-right text-xs text-amber-700">The deductions are more than the amount.</span>}
          </div>
        </>
      )}
    </FormDialog>
  );
}
