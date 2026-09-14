import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { createSiteSchema, type SiteDetail } from "@accountmanagement/contracts";
import {
  Button,
  CheckboxField,
  FormDialog,
  FormSection,
  TextAreaField,
  TextField,
} from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import {
  useCreateSite,
  useSite,
  useSiteAddresses,
  useSiteAddressWrites,
  useUpdateSite,
  type AddressDraft,
} from "./api";

/**
 * The site form.
 *
 * ONE ADDRESS BOX, AND A LIST OF DELIVERY ADDRESSES BESIDE IT.
 *
 * It used to be two parallel structured blocks — billing and shipping, each with
 * an address, an area and a PIN code — because that is what the source table
 * holds, 22 columns of it. The business has since said what it actually wants:
 * one free-text address per place, no area and no PIN code, and a site that can
 * carry as many delivery addresses as it has gates.
 *
 * So `SiteAddress` is finally connected. It came across with the import, 24 rows
 * of it, and until now nothing in this application could read or add to it —
 * the legacy purchase order screen was the only thing that ever listed it.
 *
 * The columns that are no longer shown — area, PIN code, the whole shipping
 * block, the geography ids — REMAIN IN THE FORM VALUES on purpose. An edit then
 * carries whatever the row already held instead of blanking it, and the
 * addresses live in the rest of the system: purchase orders record the site's
 * shipping address as text on the order itself.
 *
 * There is no company field. The source schema has no Company-to-Site
 * relationship at all — the two are associated only indirectly, through the CSV
 * `User.CompanyId`/`User.SiteId` columns — so a company picker here would be
 * inventing one.
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
  const stored = useSiteAddresses(open && isEdit ? siteId : null);
  const create = useCreateSite();
  const update = useUpdateSite();
  const addresses = useSiteAddressWrites();
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * The delivery addresses are held OUTSIDE the form, in plain state.
   *
   * They are not fields of the site: they are rows in another table, saved
   * through their own endpoints after the site itself is written — and on a new
   * site they cannot be saved at all until it has an id. Putting them in the
   * resolver's schema would mean teaching `createSiteSchema` about a table the
   * API never accepts on that route.
   */
  const [drafts, setDrafts] = useState<AddressDraft[]>([]);

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
      setDrafts([]);
    } else if (detail.data) {
      reset(toFormValues(detail.data));
    }
  }, [open, isEdit, detail.data, reset]);

  // Separate from the form reset: the addresses arrive in their own request and
  // would otherwise be dropped by whichever of the two answered second.
  useEffect(() => {
    if (!open || !isEdit || !stored.data) return;
    setDrafts(stored.data.map((row) => ({ id: row.id, address: row.address })));
  }, [open, isEdit, stored.data]);

  const pending = create.isPending || update.isPending || addresses.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const saved = isEdit
        ? await update.mutateAsync({ id: siteId, body: values })
        : await create.mutateAsync(values);

      // Always sent, even when empty: an emptied list means rows to delete.
      await addresses.mutateAsync({
        siteId: saved.id,
        existing: stored.data ?? [],
        next: drafts,
      });
      onClose();
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  }, (invalid) => setFormError(unshownValidationMessage(invalid)));

  const setDraft = (index: number, address: string) =>
    setDrafts((current) =>
      current.map((draft, at) => (at === index ? { ...draft, address } : draft)),
    );

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit site" : "Add site"}
      description="A project location, its contact and the addresses deliveries go to"
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
              hint="More than one is fine, separated by commas"
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

          <FormSection title="Address">
            <TextAreaField
              label="Address"
              rows={2}
              className="sm:col-span-2"
              error={errors.address?.message}
              {...register("address")}
            />
          </FormSection>

          <FormSection
            title="Delivery addresses"
            description="Offered on invoices and orders raised for this site"
          >
            <div className="space-y-2 sm:col-span-2">
              {drafts.length === 0 && (
                <p className="text-sm text-slate-500">
                  None yet. Documents will offer the address above.
                </p>
              )}

              {drafts.map((draft, index) => (
                <div key={draft.id ?? `new-${index}`} className="flex items-start gap-2">
                  <textarea
                    rows={2}
                    value={draft.address}
                    onChange={(event) => setDraft(index, event.currentTarget.value)}
                    aria-label={`Delivery address ${index + 1}`}
                    placeholder="Where deliveries go"
                    className="min-w-0 flex-1 rounded-lg border-0 px-2.5 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    icon={Trash2}
                    className="mt-1 px-2 py-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    aria-label={`Remove delivery address ${index + 1}`}
                    title={`Remove delivery address ${index + 1}`}
                    onClick={() =>
                      setDrafts((current) => current.filter((_row, at) => at !== index))
                    }
                  />
                </div>
              ))}

              <Button
                type="button"
                variant="secondary"
                icon={Plus}
                onClick={() => setDrafts((current) => [...current, { id: null, address: "" }])}
              >
                Add address
              </Button>
            </div>
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

/**
 * Everything the row holds, including what the form no longer shows.
 *
 * That is the whole reason the unshown fields are still here: the values go back
 * unchanged on save, so hiding a field stopped collecting it without also
 * quietly erasing what was collected before.
 */
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
