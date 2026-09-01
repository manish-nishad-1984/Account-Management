import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createCompanySchema, type CompanyDetail } from "@accountmanagement/contracts";
import { FormDialog, FormSection, TextAreaField, TextField } from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { useCompany, useCreateCompany, useUpdateCompany } from "./api";

/**
 * Create and edit share one dialog, because they share one shape.
 *
 * `companyId` null means create; an id means edit, and the full record is
 * fetched on open — the list does not carry the bank details, so a form built
 * from the grid row alone would submit them blank and wipe them.
 *
 * The resolver is the SAME Zod schema the API validates with, imported from
 * `@accountmanagement/contracts`. That is what the contracts package is for: the
 * GST format rule has one definition and the two ends cannot drift. The client
 * check is a convenience — the server runs it again, because a rule enforced
 * only in a browser is not a rule.
 */
type FormValues = z.input<typeof createCompanySchema>;
type Submitted = z.output<typeof createCompanySchema>;

export function CompanyFormDialog({
  open,
  companyId,
  onClose,
}: {
  open: boolean;
  companyId: string | null;
  onClose: () => void;
}) {
  const isEdit = companyId !== null;
  const detail = useCompany(open && isEdit ? companyId : null);
  const create = useCreateCompany();
  const update = useUpdateCompany();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createCompanySchema),
    defaultValues: EMPTY,
  });

  /**
   * Reset on open, and again when the fetched record arrives.
   *
   * Both are needed: opening for a create has to clear whatever the last edit
   * left behind, and opening for an edit renders before the detail request
   * resolves, so the values turn up after the first render.
   */
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
        await update.mutateAsync({ id: companyId, body: values });
      } else {
        await create.mutateAsync(values);
      }
      onClose();
    } catch (error) {
      // A rejection from Zod on the server and one from a unique index arrive in
      // the same shape, so both land on the field that caused them.
      setFormError(applyServerErrors(error, setError));
    }
  }, (invalid) => setFormError(unshownValidationMessage(invalid)));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit company" : "Add company"}
      description="Billing entity — GST registration, invoice prefix and bank details"
      formError={formError}
      pending={pending}
      submitLabel={isEdit ? "Save changes" : "Create company"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading company…</p>
      ) : (
        <>
          <FormSection title="Identity">
            <TextField
              label="Company name"
              required
              autoFocus
              error={errors.name?.message}
              {...register("name")}
            />
            <TextField
              label="Invoice prefix"
              hint="Stamped on this company's invoice numbers"
              error={errors.invoicePrefix?.message}
              {...register("invoicePrefix")}
            />
            <TextField
              label="GST number"
              hint="15 characters, e.g. 24AAACD1234A1Z5"
              error={errors.gstNo?.message}
              {...register("gstNo")}
            />
            <TextField
              label="PAN"
              hint="10 characters, e.g. AAACD1234A"
              error={errors.panNo?.message}
              {...register("panNo")}
            />
          </FormSection>

          <FormSection title="Address">
            <TextAreaField
              label="Address"
              className="sm:col-span-2"
              error={errors.address?.message}
              {...register("address")}
            />
            <TextField label="Area" error={errors.area?.message} {...register("area")} />
            <TextField
              label="PIN code"
              inputMode="numeric"
              error={errors.pincode?.message}
              {...register("pincode")}
            />
          </FormSection>

          <FormSection title="Bank details" description="Not shown on the companies list">
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
        </>
      )}
    </FormDialog>
  );
}

/** An empty form is empty STRINGS, never nulls — see lib/form-values.ts. */
const EMPTY: FormValues = {
  name: "",
  invoicePrefix: "",
  gstNo: "",
  panNo: "",
  address: "",
  area: "",
  cityId: null,
  stateId: null,
  countryId: null,
  pincode: "",
  bankName: "",
  bankBranch: "",
  accountNo: "",
  ifscCode: "",
};

const toFormValues = (detail: CompanyDetail): FormValues => ({
  name: detail.name,
  invoicePrefix: text(detail.invoicePrefix),
  gstNo: text(detail.gstNo),
  panNo: text(detail.panNo),
  address: text(detail.address),
  area: text(detail.area),
  cityId: detail.cityId,
  stateId: detail.stateId,
  countryId: detail.countryId,
  pincode: text(detail.pincode),
  bankName: text(detail.bankName),
  bankBranch: text(detail.bankBranch),
  accountNo: text(detail.accountNo),
  ifscCode: text(detail.ifscCode),
});
