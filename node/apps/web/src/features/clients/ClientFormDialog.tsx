import { Home, MapPin, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createClientSchema, type ClientDetail } from "@accountmanagement/contracts";
import { FormDialog, FormSection, MultiSelectField, TextAreaField, TextField } from "../../components/ui";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { useClient, useCreateClient, useUpdateClient } from "./api";

/**
 * Create and edit share one dialog (the Company form's pattern). The resolver is
 * the same Zod schema the API validates with.
 *
 * The projects a client pays for are chosen here: the Income screen offers, for
 * the project in the header, the clients linked to it.
 */
type FormValues = z.input<typeof createClientSchema>;
type Submitted = z.output<typeof createClientSchema>;

export function ClientFormDialog({
  open,
  clientId,
  onClose,
}: {
  open: boolean;
  clientId: string | null;
  onClose: () => void;
}) {
  const isEdit = clientId !== null;
  const detail = useClient(open && isEdit ? clientId : null);
  const create = useCreateClient();
  const update = useUpdateClient();
  const scope = useSiteScope();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createClientSchema),
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

  const onSubmit = handleSubmit(
    async (values) => {
      setFormError(null);
      try {
        if (isEdit) {
          await update.mutateAsync({ id: clientId, body: values });
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

  const siteOptions = scope.sites.map((site) => ({ value: site.id, label: site.name }));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit client" : "Add client"}
      description="Who pays us for a project"
      formError={formError}
      pending={create.isPending || update.isPending}
      submitLabel={isEdit ? "Save changes" : "Create client"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading client…</p>
      ) : (
        <>
          <FormSection icon={UserRound} title="Client">
            <TextField label="Client name" required autoFocus error={errors.name?.message} {...register("name")} />
            <TextField label="Mobile" error={errors.mobile?.message} {...register("mobile")} />
            <TextField label="Email" error={errors.email?.message} {...register("email")} />
            <TextField label="GST number" maxLength={15} error={errors.gstNo?.message} {...register("gstNo")} />
            <TextField label="PAN" maxLength={10} error={errors.panNo?.message} {...register("panNo")} />
          </FormSection>

          <FormSection icon={MapPin} title="Projects" description="The projects (sites) this client pays for">
            <Controller
              control={control}
              name="siteIds"
              render={({ field }) => (
                <MultiSelectField
                  label="Projects"
                  options={siteOptions}
                  value={(field.value as string[] | undefined) ?? []}
                  onChange={field.onChange}
                  error={errors.siteIds?.message}
                  emptyMessage="No sites yet"
                />
              )}
            />
          </FormSection>

          <FormSection icon={Home} title="Address">
            <TextAreaField
              label="Address"
              rows={2}
              className="sm:col-span-2"
              error={errors.address?.message}
              {...register("address")}
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
  panNo: "",
  address: "",
  siteIds: [],
};

const toFormValues = (detail: ClientDetail): FormValues => ({
  name: detail.name,
  mobile: text(detail.mobile),
  email: text(detail.email),
  gstNo: text(detail.gstNo),
  panNo: text(detail.panNo),
  address: text(detail.address),
  siteIds: detail.siteIds,
});
