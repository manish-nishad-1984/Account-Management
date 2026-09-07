import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  createPurchaseRequestSchema,
  type PurchaseRequestDetail,
} from "@accountmanagement/contracts";
import { Alert, FormDialog, FormSection, SelectField, TextAreaField, TextField } from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { useAllUnits } from "../items/api";
import {
  useCreatePurchaseRequest,
  useItemOptions,
  usePurchaseRequest,
  useUpdatePurchaseRequest,
} from "./api";
import { useSiteScope } from "../../contexts/SiteScopeContext";

/**
 * The purchase request form.
 *
 * THE REQUEST NUMBER IS NOT IN THIS FORM, and that is the important part.
 *
 * The .NET screen called `CheckPRNo` when the form opened, displayed the number
 * in a read-only box, and posted it back on save. So the number was reserved by
 * opening a form and confirmed only by submitting one — two people with the form
 * open got the same number, and nothing in the database refused it. Here the
 * server issues the number inside the same transaction as the insert, and the
 * form learns it from the response.
 */
type FormValues = z.input<typeof createPurchaseRequestSchema>;
type Submitted = z.output<typeof createPurchaseRequestSchema>;

export function PurchaseRequestFormDialog({
  open,
  requestId,
  onClose,
}: {
  open: boolean;
  requestId: string | null;
  onClose: () => void;
}) {
  const isEdit = requestId !== null;
  const detail = usePurchaseRequest(open && isEdit ? requestId : null);

  /**
   * The site dropdown is fed by the SCOPE, not by `GET /sites`.
   *
   * That list needs the `site.view` right, which guards the Site master screen —
   * so a clerk who may raise requests but not edit sites got a 403 and an empty
   * dropdown with no way to save. `/sites/assignable` needs no right and returns
   * the sites this user actually works on, which is the correct set anyway.
   */
  const scope = useSiteScope();
  const units = useAllUnits();
  const itemOptions = useItemOptions("");
  const create = useCreatePurchaseRequest();
  const update = useUpdatePurchaseRequest();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createPurchaseRequestSchema),
    defaultValues: EMPTY,
  });

  const chosenItemId = watch("itemId");

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (!isEdit) {
      // A new request defaults to the site in the header, which is what the
      // person raising it is looking at. Still changeable.
      reset({ ...EMPTY, siteId: scope.siteId ?? "" });
    } else if (detail.data) {
      reset(toFormValues(detail.data));
    }
  }, [open, isEdit, detail.data, reset, scope.siteId]);

  const pending = create.isPending || update.isPending;

  const onSubmit = handleSubmit(
    async (values) => {
      setFormError(null);
      try {
        if (isEdit) {
          await update.mutateAsync({ id: requestId, body: values });
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

  const unitOptions = (units.data?.rows ?? []).map((unit) => ({
    value: unit.id,
    label: unit.name,
  }));

  const items = itemOptions.data?.rows ?? [];
  const itemTotal = itemOptions.data?.total ?? 0;
  const itemsTruncated = itemTotal > items.length;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit purchase request" : "New purchase request"}
      description={
        isEdit
          ? `Request ${detail.data?.prNo ?? ""}`
          : "The request number is issued when this is saved"
      }
      formError={formError}
      pending={pending}
      submitLabel={isEdit ? "Save changes" : "Create request"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading request…</p>
      ) : (
        <>
          <FormSection title="Where" columns={2}>
            <SelectField
              label="Site"
              required
              autoFocus
              placeholder={scope.isReady ? "Choose a site" : "Loading sites…"}
              options={siteOptions}
              error={errors.siteId?.message}
              {...register("siteId")}
            />
            <TextField
              label="Date"
              type="date"
              hint="The date on the document"
              error={errors.documentDate?.message}
              {...register("documentDate")}
            />
            <TextAreaField
              label="Delivery address"
              className="sm:col-span-2"
              rows={2}
              hint="Optional. Where the goods should arrive, if not the site's own address."
              error={errors.siteAddress?.message}
              {...register("siteAddress")}
            />
          </FormSection>

          <FormSection title="What" columns={2}>
            <SelectField
              label="Item"
              placeholder={itemOptions.isLoading ? "Loading items…" : "Choose an item"}
              options={items.map((item) => ({ value: item.id, label: item.name }))}
              error={errors.itemId?.message}
              {...register("itemId")}
            />
            <TextField
              label="Or name it"
              hint="For something not in the item catalogue"
              error={errors.itemName?.message}
              {...register("itemName")}
            />

            {itemsTruncated && (
              <Alert tone="info" className="sm:col-span-2">
                Showing the first {items.length} of {itemTotal} items. If the one you
                need is not listed, type its name in the field beside the dropdown —
                a request can name an item that is not in the catalogue.
              </Alert>
            )}

            <TextField
              label="Quantity"
              required
              inputMode="decimal"
              hint="At most 2 decimal places"
              error={errors.quantity?.message}
              {...register("quantity")}
            />
            <SelectField
              label="Unit"
              required
              placeholder={units.isLoading ? "Loading units…" : "Choose a unit"}
              options={unitOptions}
              error={errors.unitId?.message}
              {...register("unitId")}
            />

            <TextAreaField
              label="Description"
              className="sm:col-span-2"
              rows={3}
              hint={
                chosenItemId
                  ? "Anything the item name does not cover — grade, size, finish."
                  : "Describe what is wanted, since no catalogue item was chosen."
              }
              error={errors.itemDescription?.message}
              {...register("itemDescription")}
            />
          </FormSection>

          {!isEdit && (
            <Alert tone="info">
              A new request is created unapproved. Approving it is a separate action
              and needs the approve right.
            </Alert>
          )}
        </>
      )}
    </FormDialog>
  );
}

const EMPTY: FormValues = {
  siteId: "",
  itemId: "",
  itemName: "",
  itemDescription: "",
  unitId: "" as unknown as number,
  quantity: "",
  documentDate: "",
  siteAddressId: null,
  siteAddress: "",
};

/** `<input type="date">` wants `yyyy-mm-dd`; the API sends a full ISO timestamp. */
const dateInput = (value: string | null): string => (value ? value.slice(0, 10) : "");

const toFormValues = (detail: PurchaseRequestDetail): FormValues => ({
  siteId: detail.siteId,
  itemId: text(detail.itemId),
  itemName: text(detail.itemName),
  itemDescription: text(detail.itemDescription),
  unitId: detail.unitId,
  quantity: detail.quantity,
  documentDate: dateInput(detail.documentDate),
  siteAddressId: detail.siteAddressId,
  siteAddress: text(detail.siteAddress),
});
