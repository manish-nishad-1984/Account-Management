import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createSupplierSchema, type SupplierDetail } from "@accountmanagement/contracts";
import {
  CheckboxField,
  FormDialog,
  FormSection,
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
          <FormSection title="Identity">
            <TextField
              label="Supplier name"
              required
              autoFocus
              error={errors.name?.message}
              {...register("name")}
            />
            <TextField
              label="GST number"
              hint="15 characters, e.g. 24AAACD1234A1Z5"
              error={errors.gstNo?.message}
              {...register("gstNo")}
            />
            <TextField
              label="Mobile"
              inputMode="tel"
              hint="10 digits; +91 and spacing are stripped"
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

          <FormSection title="Address">
            <TextField
              label="Building name"
              error={errors.buildingName?.message}
              {...register("buildingName")}
            />
            <TextField label="Area" required error={errors.area?.message} {...register("area")} />
            <TextField
              label="PIN code"
              inputMode="numeric"
              error={errors.pincode?.message}
              {...register("pincode")}
            />
          </FormSection>

          <FormSection title="Bank details" description="Not shown on the suppliers list">
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

          <FormSection title="Ledger">
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
            {/*
              `IsApproved` is carried, not enforced. Nothing in the repository
              layer treats it as a gate — an unapproved supplier can still be
              chosen on a purchase order — so the label says what it does rather
              than implying a control that does not exist.
            */}
            <CheckboxField
              label="Approved"
              hint="Recorded on the supplier. It does not currently prevent use on a purchase order."
              className="sm:col-span-2"
              {...register("isApproved")}
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
  isApproved: false,
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
  isApproved: detail.isApproved,
  openingBalance: text(detail.openingBalance),
  // The API sends a full ISO timestamp; `<input type="date">` needs yyyy-mm-dd
  // and renders blank, with no error, for anything else.
  openingBalanceDate: dateInput(detail.openingBalanceDate),
});
