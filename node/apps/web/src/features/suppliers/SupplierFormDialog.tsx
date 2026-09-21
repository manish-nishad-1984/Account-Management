import { BookOpen, Building2, Home, Landmark } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createSupplierSchema, type SupplierDetail } from "@accountmanagement/contracts";
import {
  FormDialog,
  FormSection,
  TextAreaField,
  TextField,
} from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { dateInput, text } from "../../lib/form-values";
import { useCreateSupplier, useSupplier, useUpdateSupplier } from "./api";

/**
 * The supplier form.
 *
 * `openingBalance` is a TEXT input, not `type="number"`. Two reasons, and both
 * matter for money:
 *
 *  - a number input hands back a JavaScript number, which is binary floating
 *    point; the value is a decimal by definition and stays a string end to end,
 *    from this field through `numeric` in PostgreSQL and back;
 *  - number inputs silently swallow values on some browsers when the user
 *    scrolls over them, which on a ledger opening balance is a real hazard.
 *
 * `inputMode="decimal"` still brings up the numeric keypad on a phone.
 */
type FormValues = z.input<typeof createSupplierSchema>;
type Submitted = z.output<typeof createSupplierSchema>;

export function SupplierFormDialog({
  open,
  supplierId,
  onClose,
}: {
  open: boolean;
  supplierId: string | null;
  onClose: () => void;
}) {
  const isEdit = supplierId !== null;
  const detail = useSupplier(open && isEdit ? supplierId : null);
  const create = useCreateSupplier();
  const update = useUpdateSupplier();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createSupplierSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (!isEdit) {
      reset(EMPTY);
    } else if (detail.data) {
      reset(toFormValues(detail.data));
    }
  }, [open, isEdit, detail.data, reset]);

  const pending = create.isPending || update.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (isEdit) {
        await update.mutateAsync({ id: supplierId, body: values });
      } else {
        await create.mutateAsync(values);
      }
      onClose();
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  }, (invalid) => setFormError(unshownValidationMessage(invalid)));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit supplier" : "Add supplier"}
      description="A vendor you raise purchase orders against"
      formError={formError}
      pending={pending}
      submitLabel={isEdit ? "Save changes" : "Create supplier"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading supplier…</p>
      ) : (
        <>
          <FormSection icon={Building2} title="Identity">
            <TextField
              label="Supplier name"
              required
              autoFocus
              error={errors.name?.message}
              {...register("name")}
            />
            <TextField
              label="GST number"
              hint="Up to 15 characters"
              maxLength={15}
              error={errors.gstNo?.message}
              {...register("gstNo")}
            />
            <TextField
              label="Mobile"
              inputMode="tel"
              hint="More than one is fine, separated by commas"
              error={errors.mobile?.message}
              {...register("mobile")}
            />
            <TextField
              label="Email"
              type="email"
              error={errors.email?.message}
              {...register("email")}
            />
          </FormSection>

          {/*
            `buildingName` IS the address, whatever the source column is
            called: across the 194 live suppliers it holds the whole thing,
            down to the PIN code. It was a one-line input labelled Building
            name next to a required Area that repeated it. Area and PIN code
            stay in the form values so an edit preserves them.
          */}
          <FormSection icon={Home} title="Address">
            <TextAreaField
              label="Address"
              rows={2}
              className="sm:col-span-2"
              error={errors.buildingName?.message}
              {...register("buildingName")}
            />
          </FormSection>

          <FormSection icon={Landmark} title="Bank details" description="Not shown on the suppliers list">
            <TextField
              label="Bank name"
              error={errors.bankName?.message}
              {...register("bankName")}
            />
            <TextField
              label="Branch"
              error={errors.bankBranch?.message}
              {...register("bankBranch")}
            />
            <TextField
              label="Account number"
              error={errors.accountNo?.message}
              {...register("accountNo")}
            />
            <TextField
              label="IFSC"
              hint="11 characters, e.g. HDFC0001234"
              error={errors.ifscCode?.message}
              {...register("ifscCode")}
            />
          </FormSection>

          <FormSection icon={BookOpen} title="Ledger">
            <TextField
              label="Opening balance"
              inputMode="decimal"
              hint="Amount with at most 2 decimal places"
              error={errors.openingBalance?.message}
              {...register("openingBalance")}
            />
            <TextField
              label="As at"
              type="date"
              hint="Required when an opening balance is given"
              error={errors.openingBalanceDate?.message}
              {...register("openingBalanceDate")}
            />
          </FormSection>
        </>
      )}
    </FormDialog>
  );
}

const EMPTY: FormValues = {
  name: "",
  mobile: "",
  email: "",
  gstNo: "",
  buildingName: "",
  area: "",
  cityId: null,
  stateId: null,
  pincode: "",
  bankName: "",
  bankBranch: "",
  accountNo: "",
  ifscCode: "",
  openingBalance: "",
  openingBalanceDate: "",
};

const toFormValues = (detail: SupplierDetail): FormValues => ({
  name: detail.name,
  mobile: text(detail.mobile),
  email: text(detail.email),
  gstNo: text(detail.gstNo),
  buildingName: text(detail.buildingName),
  area: detail.area,
  cityId: detail.cityId,
  stateId: detail.stateId,
  pincode: text(detail.pincode),
  bankName: text(detail.bankName),
  bankBranch: text(detail.bankBranch),
  accountNo: text(detail.accountNo),
  ifscCode: text(detail.ifscCode),
  openingBalance: text(detail.openingBalance),
  // The API sends a full ISO timestamp; `<input type="date">` needs yyyy-mm-dd
  // and renders blank, with no error, for anything else.
  openingBalanceDate: dateInput(detail.openingBalanceDate),
});
