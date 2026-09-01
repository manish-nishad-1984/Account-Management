import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createSiteSchema, type SiteDetail } from "@accountmanagement/contracts";
import {
  CheckboxField,
  FormDialog,
  FormSection,
  TextAreaField,
  TextField,
} from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { useCreateSite, useSite, useUpdateSite } from "./api";

/**
 * The site form.
 *
 * Two parallel address blocks, billing and shipping, because that is what the
 * source table holds — 22 columns with `ShippingAddress`, `ShippingArea` and so
 * on beside the main set. They are NOT normalised into one structure here:
 * `SiteAddress` already exists in the source for additional shipping addresses,
 * and merging them is a business decision rather than a mechanical one.
 *
 * There is no company field. The source schema has no Company-to-Site
 * relationship at all — the two are associated only indirectly, through the CSV
 * `User.CompanyId`/`User.SiteId` columns — so a company picker here would be
 * inventing one. `sites.company_id` exists in Drizzle but nothing derives it from
 * production data; confirm with the business before it means anything.
 */
type FormValues = z.input<typeof createSiteSchema>;
type Submitted = z.output<typeof createSiteSchema>;

export function SiteFormDialog({
  open,
  siteId,
  onClose,
}: {
  open: boolean;
  siteId: string | null;
  onClose: () => void;
}) {
  const isEdit = siteId !== null;
  const detail = useSite(open && isEdit ? siteId : null);
  const create = useCreateSite();
  const update = useUpdateSite();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createSiteSchema),
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
        await update.mutateAsync({ id: siteId, body: values });
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
      title={isEdit ? "Edit site" : "Add site"}
      description="A project location — its contact, billing address and shipping address"
      formError={formError}
      pending={pending}
      submitLabel={isEdit ? "Save changes" : "Create site"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading site…</p>
      ) : (
        <>
          <FormSection title="Site">
            <TextField
              label="Site name"
              required
              autoFocus
              error={errors.name?.message}
              {...register("name")}
            />
            <TextField
              label="Contact person"
              error={errors.contactPersonName?.message}
              {...register("contactPersonName")}
            />
            <TextField
              label="Contact phone"
              inputMode="tel"
              hint="10 digits, starting 6-9"
              error={errors.contactPersonPhoneNo?.message}
              {...register("contactPersonPhoneNo")}
            />
            <CheckboxField
              label="Active"
              hint="Inactive sites stay on the list but are marked"
              className="self-end pb-2.5"
              {...register("isActive")}
            />
          </FormSection>

          <FormSection title="Billing address">
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

          <FormSection
            title="Shipping address"
            description="Where deliveries go, when that differs from the billing address"
          >
            <TextAreaField
              label="Shipping address"
              className="sm:col-span-2"
              error={errors.shippingAddress?.message}
              {...register("shippingAddress")}
            />
            <TextField
              label="Shipping area"
              error={errors.shippingArea?.message}
              {...register("shippingArea")}
            />
            <TextField
              label="Shipping PIN code"
              inputMode="numeric"
              error={errors.shippingPincode?.message}
              {...register("shippingPincode")}
            />
          </FormSection>
        </>
      )}
    </FormDialog>
  );
}

const EMPTY: FormValues = {
  name: "",
  isActive: true,
  contactPersonName: "",
  contactPersonPhoneNo: "",
  address: "",
  area: "",
  cityId: null,
  stateId: null,
  countryId: null,
  pincode: "",
  shippingAddress: "",
  shippingArea: "",
  shippingCityId: null,
  shippingStateId: null,
  shippingCountryId: null,
  shippingPincode: "",
};

const toFormValues = (detail: SiteDetail): FormValues => ({
  name: detail.name,
  isActive: detail.isActive,
  contactPersonName: text(detail.contactPersonName),
  contactPersonPhoneNo: text(detail.contactPersonPhoneNo),
  address: text(detail.address),
  area: text(detail.area),
  cityId: detail.cityId,
  stateId: detail.stateId,
  countryId: detail.countryId,
  pincode: text(detail.pincode),
  shippingAddress: text(detail.shippingAddress),
  shippingArea: text(detail.shippingArea),
  shippingCityId: detail.shippingCityId,
  shippingStateId: detail.shippingStateId,
  shippingCountryId: detail.shippingCountryId,
  shippingPincode: text(detail.shippingPincode),
});
