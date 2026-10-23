import { Home, Landmark, Plus, Trash2, UserRound, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createEmployeeSchema, type EmployeeDetail } from "@accountmanagement/contracts";
import {
  Button,
  CheckboxField,
  FormDialog,
  FormSection,
  IconButton,
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/ui";
import { confirmRemoveRow } from "../../components/ui/confirm";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { formatMoney } from "../../lib/format";
import { useCompanyOptions } from "../purchase-orders/api";
import { fromPaise, sumAmounts, toPaise } from "../payouts/decimal";
import { useCreateEmployee, useEmployee, useUpdateEmployee } from "./api";

/**
 * Add and edit an employee (client request, 23 Oct 2026): name, address, date of
 * joining, bank, basic salary, and the fixed additions and deductions of a month.
 * The net salary under them is what the payout list starts each month at.
 */
type FormValues = z.input<typeof createEmployeeSchema>;
type Submitted = z.output<typeof createEmployeeSchema>;

export function EmployeeFormDialog({
  open,
  employeeId,
  onClose,
}: {
  open: boolean;
  employeeId: string | null;
  onClose: () => void;
}) {
  const isEdit = employeeId !== null;
  const detail = useEmployee(open && isEdit ? employeeId : null);
  const create = useCreateEmployee();
  const update = useUpdateEmployee();
  const scope = useSiteScope();
  const companies = useCompanyOptions();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: EMPTY,
  });
  const { fields: items, append, remove } = useFieldArray({ control, name: "items" });
  const basic = useWatch({ control, name: "basicSalary" });
  const watchedItems = useWatch({ control, name: "items" }) ?? [];

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (!isEdit) {
      reset(EMPTY);
    } else if (detail.data) {
      reset(toFormValues(detail.data));
    }
  }, [open, isEdit, detail.data, reset]);

  const onSubmit = handleSubmit(
    async (values) => {
      setFormError(null);
      try {
        if (isEdit) {
          await update.mutateAsync({ id: employeeId, body: values });
        } else {
          await create.mutateAsync(values);
        }
        onClose();
      } catch (error) {
        setFormError(applyServerErrors(error, setError));
      }
    },
    (invalid) => setFormError(unshownValidationMessage(invalid)),
  );

  const amountOf = (kind: "addition" | "deduction") =>
    sumAmounts(watchedItems.filter((item) => item?.kind === kind).map((item) => clean(item?.amount)));
  const additions = amountOf("addition");
  const deductions = amountOf("deduction");
  const net = fromPaise((toPaise(clean(basic)) ?? 0n) + (toPaise(additions) ?? 0n) - (toPaise(deductions) ?? 0n));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit employee" : "Add employee"}
      description="Basic details, bank and salary"
      formError={formError}
      pending={create.isPending || update.isPending}
      submitLabel={isEdit ? "Save changes" : "Create employee"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading employee…</p>
      ) : (
        <>
          <FormSection icon={UserRound} title="Employee">
            <TextField label="Employee name" required autoFocus error={errors.name?.message} {...register("name")} />
            <TextField label="Mobile" error={errors.mobile?.message} {...register("mobile")} />
            <SelectField
              label="Company"
              required
              placeholder="Choose a company"
              options={(companies.data?.rows ?? []).map((row) => ({ value: row.id, label: row.name }))}
              error={errors.companyId?.message}
              {...register("companyId")}
            />
            <SelectField
              label="Site"
              options={[{ value: "", label: "No site" }, ...scope.sites.map((site) => ({ value: site.id, label: site.name }))]}
              error={errors.siteId?.message}
              {...register("siteId", { setValueAs: (value: string) => (value === "" ? null : value) })}
            />
            <TextField label="Date of joining" type="date" error={errors.joinDate?.message} {...register("joinDate")} />
            <CheckboxField label="Active" hint="Only an active employee's salary comes up on the payout list" {...register("isActive")} />
          </FormSection>

          <FormSection icon={Wallet} title="Salary" description="A month's pay: basic, plus additions, less deductions">
            <TextField label="Basic salary" required inputMode="decimal" error={errors.basicSalary?.message} {...register("basicSalary")} />
            <div className="sm:col-span-2 space-y-2">
              {items.map((item, index) => (
                <div key={item.id} className="grid grid-cols-[8rem_1fr_9rem_auto] items-start gap-2">
                  <SelectField
                    label={`Type ${index + 1}`}
                    labelHidden
                    options={[
                      { value: "addition", label: "Addition" },
                      { value: "deduction", label: "Deduction" },
                    ]}
                    {...register(`items.${index}.kind`)}
                  />
                  <TextField
                    label={`Name ${index + 1}`}
                    labelHidden
                    placeholder="e.g. Travel, PF"
                    error={errors.items?.[index]?.label?.message}
                    {...register(`items.${index}.label`)}
                  />
                  <TextField
                    label={`Amount ${index + 1}`}
                    labelHidden
                    inputMode="decimal"
                    placeholder="Amount"
                    error={errors.items?.[index]?.amount?.message}
                    {...register(`items.${index}.amount`)}
                  />
                  <IconButton
                    label={`Remove line ${index + 1}`}
                    icon={Trash2}
                    tone="destructive"
                    onClick={() => void confirmRemoveRow(`line ${index + 1}`).then((yes) => yes && remove(index))}
                  />
                </div>
              ))}
              <Button type="button" variant="outline" icon={Plus} onClick={() => append({ kind: "addition", label: "", amount: "" })}>
                Add addition / deduction
              </Button>
              <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm sm:max-w-sm">
                <dt className="text-slate-500">Additions</dt>
                <dd className="tabular text-right text-slate-700">{formatMoney(additions)}</dd>
                <dt className="text-slate-500">Deductions</dt>
                <dd className="tabular text-right text-slate-700">{formatMoney(deductions)}</dd>
                <dt className="font-semibold text-slate-700">Net salary</dt>
                <dd aria-label="Net salary" className="tabular text-right font-semibold text-slate-900">{formatMoney(net)}</dd>
              </dl>
            </div>
          </FormSection>

          <FormSection icon={Landmark} title="Bank">
            <TextField label="Bank name" error={errors.bankName?.message} {...register("bankName")} />
            <TextField label="Account holder" error={errors.accountHolder?.message} {...register("accountHolder")} />
            <TextField label="Account number" error={errors.accountNo?.message} {...register("accountNo")} />
            <TextField label="IFSC" maxLength={11} error={errors.ifscCode?.message} {...register("ifscCode")} />
          </FormSection>

          <FormSection icon={Home} title="Address and note">
            <TextAreaField label="Address" rows={2} className="sm:col-span-2" error={errors.address?.message} {...register("address")} />
            <TextAreaField label="Note" rows={2} className="sm:col-span-2" error={errors.note?.message} {...register("note")} />
          </FormSection>
        </>
      )}
    </FormDialog>
  );
}

/** A typed amount as a figure for the running total; anything else counts as nothing. */
const clean = (value: unknown): string => {
  const raw = typeof value === "string" ? value.replace(/[,\s₹]/g, "") : "";
  return /^\d+(\.\d{1,2})?$/.test(raw) ? raw : "0";
};

const EMPTY: FormValues = {
  name: "",
  mobile: "",
  address: "",
  companyId: "",
  siteId: null,
  joinDate: "",
  bankName: "",
  accountHolder: "",
  accountNo: "",
  ifscCode: "",
  basicSalary: "",
  items: [],
  isActive: true,
  note: "",
};

const toFormValues = (detail: EmployeeDetail): FormValues => ({
  name: detail.name,
  mobile: text(detail.mobile),
  address: text(detail.address),
  companyId: detail.companyId,
  siteId: detail.siteId,
  joinDate: text(detail.joinDate),
  bankName: text(detail.bankName),
  accountHolder: text(detail.accountHolder),
  accountNo: text(detail.accountNo),
  ifscCode: text(detail.ifscCode),
  basicSalary: detail.basicSalary,
  items: detail.items,
  isActive: detail.isActive,
  note: text(detail.note),
});
