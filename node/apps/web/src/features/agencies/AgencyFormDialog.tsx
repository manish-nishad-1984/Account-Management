import { useEffect, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Building2, Landmark, Plus, Trash2, UserRound, Users } from "lucide-react";
import { createAgencySchema, type AgencyDetail } from "@accountmanagement/contracts";
import {
  Button,
  CheckboxField,
  EmptyRow,
  FormDialog,
  FormSection,
  IconButton,
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { useAgency, useCities, useCreateAgency, useStates, useUpdateAgency } from "./api";
import { WorkTypePicker } from "./WorkTypePicker";

/**
 * Add / edit an agency, in the sections of the client's mockup: basic
 * information, primary contact, bank details, additional contacts.
 *
 * STATE AND CITY ARE CONTROLLED SELECTS, not `register`ed ones. On edit, the
 * stored city is put into the form before that state's cities have loaded; an
 * uncontrolled `<select>` given a value it has no option for shows blank and
 * then submits "", so the city would be silently lost on every save. A
 * controlled one re-applies its value when the options arrive.
 *
 * The city is cleared in the State select's own onChange — when a PERSON
 * changes the state — never by watching `stateId`, which also changes when an
 * edit loads (the §5w trap: a watcher cannot tell the two apart).
 */
type FormValues = z.input<typeof createAgencySchema>;
type Submitted = z.output<typeof createAgencySchema>;

export function AgencyFormDialog({
  open,
  agencyId,
  onClose,
}: {
  open: boolean;
  agencyId: string | null;
  onClose: () => void;
}) {
  const isEdit = agencyId !== null;
  const detail = useAgency(open && isEdit ? agencyId : null);
  const create = useCreateAgency();
  const update = useUpdateAgency();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createAgencySchema),
    defaultValues: EMPTY,
  });

  const { fields: contactRows, append, remove } = useFieldArray({ control, name: "additionalContacts" });

  const stateValue = useWatch({ control, name: "stateId" });
  const stateId = stateValue === "" || stateValue == null ? null : Number(stateValue);
  const states = useStates();
  const cities = useCities(stateId);

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
        await update.mutateAsync({ id: agencyId, body: values });
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
      title={isEdit ? "Edit agency" : "Add new agency"}
      description="A contractor or agency, the work it does and who to call"
      formError={formError}
      pending={pending}
      submitLabel="Save agency"
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading agency…</p>
      ) : (
        <>
          <FormSection icon={Building2} title="Basic information">
            <TextField
              label="Agency name"
              required
              autoFocus
              placeholder="Enter agency name"
              error={errors.name?.message}
              {...register("name")}
            />
            <Controller
              control={control}
              name="workTypeIds"
              render={({ field }) => (
                <WorkTypePicker
                  value={field.value ?? []}
                  onChange={field.onChange}
                  error={errors.workTypeIds?.message ?? errors.workTypeIds?.root?.message}
                />
              )}
            />
            <TextAreaField
              label="Address"
              rows={2}
              className="sm:col-span-2"
              placeholder="Enter address"
              error={errors.address?.message}
              {...register("address")}
            />
            <Controller
              control={control}
              name="stateId"
              render={({ field }) => (
                <SelectField
                  label="State"
                  required
                  placeholder={states.isLoading ? "Loading states…" : "Select state"}
                  options={(states.data ?? []).map((state) => ({ value: String(state.id), label: state.name }))}
                  value={field.value == null ? "" : String(field.value)}
                  onBlur={field.onBlur}
                  onChange={(event) => {
                    field.onChange(event.target.value);
                    setValue("cityId", "");
                  }}
                  error={errors.stateId?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="cityId"
              render={({ field }) => (
                <SelectField
                  label="City"
                  required
                  disabled={stateId === null}
                  placeholder={
                    stateId === null ? "Select a state first" : cities.isLoading ? "Loading cities…" : "Select city"
                  }
                  options={(cities.data ?? []).map((city) => ({ value: String(city.id), label: city.name }))}
                  value={field.value == null ? "" : String(field.value)}
                  onBlur={field.onBlur}
                  onChange={(event) => field.onChange(event.target.value)}
                  error={errors.cityId?.message}
                />
              )}
            />
            <TextField
              label="GST No. (optional)"
              placeholder="Enter GST number"
              maxLength={15}
              error={errors.gstNo?.message}
              {...register("gstNo")}
            />
            <TextField
              label="PAN No. (optional)"
              placeholder="Enter PAN number"
              maxLength={10}
              error={errors.panNo?.message}
              {...register("panNo")}
            />
            <CheckboxField
              label="Active"
              hint="An inactive agency stays on the list, marked inactive"
              {...register("isActive")}
            />
          </FormSection>

          <FormSection icon={UserRound} title="Primary contact" description="Shown on the agencies list">
            <TextField
              label="Contact name"
              required
              placeholder="Enter contact name"
              error={errors.primaryContact?.name?.message}
              {...register("primaryContact.name")}
            />
            <TextField
              label="Designation"
              placeholder="Enter designation"
              error={errors.primaryContact?.designation?.message}
              {...register("primaryContact.designation")}
            />
            <TextField
              label="Mobile No."
              required
              inputMode="tel"
              placeholder="Enter mobile number"
              error={errors.primaryContact?.mobile?.message}
              {...register("primaryContact.mobile")}
            />
            <TextField
              label="Email (optional)"
              type="email"
              placeholder="Enter email address"
              error={errors.primaryContact?.email?.message}
              {...register("primaryContact.email")}
            />
          </FormSection>

          <FormSection icon={Landmark} title="Bank details (optional)" description="Not shown on the agencies list">
            <TextField label="Bank name" placeholder="Enter bank name" error={errors.bankName?.message} {...register("bankName")} />
            <TextField
              label="Account No."
              placeholder="Enter account number"
              error={errors.accountNo?.message}
              {...register("accountNo")}
            />
            <TextField
              label="IFSC code"
              placeholder="Enter IFSC code"
              maxLength={11}
              error={errors.ifscCode?.message}
              {...register("ifscCode")}
            />
            <TextField
              label="Account holder name"
              placeholder="Enter account holder name"
              error={errors.accountHolderName?.message}
              {...register("accountHolderName")}
            />
          </FormSection>

          <FormSection
            icon={Users}
            title="Additional contacts"
            columns={1}
            action={
              <Button
                variant="outline"
                size="sm"
                icon={Plus}
                onClick={() => append({ name: "", designation: "", mobile: "", email: "" })}
              >
                Add contact
              </Button>
            }
          >
            <div className="space-y-2">
              {contactRows.length === 0 && <EmptyRow>No additional contacts added yet.</EmptyRow>}
              {contactRows.map((row, index) => (
                <div key={row.id} className="flex items-start gap-2">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
                    <TextField
                      label={`Contact ${index + 1} name`}
                      labelHidden
                      placeholder="Name"
                      error={errors.additionalContacts?.[index]?.name?.message}
                      {...register(`additionalContacts.${index}.name`)}
                    />
                    <TextField
                      label={`Contact ${index + 1} designation`}
                      labelHidden
                      placeholder="Designation"
                      error={errors.additionalContacts?.[index]?.designation?.message}
                      {...register(`additionalContacts.${index}.designation`)}
                    />
                    <TextField
                      label={`Contact ${index + 1} mobile`}
                      labelHidden
                      inputMode="tel"
                      placeholder="Mobile"
                      error={errors.additionalContacts?.[index]?.mobile?.message}
                      {...register(`additionalContacts.${index}.mobile`)}
                    />
                  </div>
                  <IconButton
                    label={`Remove contact ${index + 1}`}
                    icon={Trash2}
                    tone="destructive"
                    size="md"
                    onClick={() => remove(index)}
                  />
                </div>
              ))}
            </div>
          </FormSection>
        </>
      )}
    </FormDialog>
  );
}

const EMPTY: FormValues = {
  name: "",
  workTypeIds: [],
  address: "",
  stateId: "",
  cityId: "",
  gstNo: "",
  panNo: "",
  bankName: "",
  accountNo: "",
  ifscCode: "",
  accountHolderName: "",
  isActive: true,
  primaryContact: { name: "", designation: "", mobile: "", email: "" },
  additionalContacts: [],
};

const toFormValues = (detail: AgencyDetail): FormValues => ({
  name: detail.name,
  workTypeIds: detail.workTypeIds,
  address: text(detail.address),
  stateId: String(detail.stateId),
  cityId: String(detail.cityId),
  gstNo: text(detail.gstNo),
  panNo: text(detail.panNo),
  bankName: text(detail.bankName),
  accountNo: text(detail.accountNo),
  ifscCode: text(detail.ifscCode),
  accountHolderName: text(detail.accountHolderName),
  isActive: detail.isActive,
  primaryContact: {
    name: detail.primaryContact?.name ?? "",
    designation: text(detail.primaryContact?.designation ?? null),
    mobile: text(detail.primaryContact?.mobile ?? null),
    email: text(detail.primaryContact?.email ?? null),
  },
  additionalContacts: detail.additionalContacts.map((contact) => ({
    name: contact.name,
    designation: text(contact.designation),
    mobile: text(contact.mobile),
    email: text(contact.email),
  })),
});
