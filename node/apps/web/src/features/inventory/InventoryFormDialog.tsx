import { PackageCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  createInventoryInwardSchema,
  type InventoryInwardDetail,
} from "@accountmanagement/contracts";
import { FormDialog, FormSection, SelectField, TextAreaField, TextField } from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import {
  useCreateInventoryInward,
  useInventoryInward,
  useUpdateInventoryInward,
} from "./api";
import { useInventoryItems } from "./stock-api";
import { PhotoInput } from "./photos";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { todayInput } from "../../lib/dates";

/**
 * NEW ARRIVAL. Since 26 Oct 2026 (client) it brings stock into the INVENTORY
 * ITEM MASTER: an item picked from it, or a name typed for the first time,
 * which the master then gets, with its unit. The quantity, and a photo of what
 * came. The purchase items (the Items master) keep a stock of their own, from
 * the inward challans.
 *
 * NO SITE FIELD, matching the source — and the site is nonetheless recorded.
 * The scope in the header supplies it, and the stock is the site's.
 *
 * NO APPROVAL FIELD either: new rows are created unapproved; approving is a
 * separate action needing the approve right.
 */
type FormValues = z.input<typeof createInventoryInwardSchema>;
type Submitted = z.output<typeof createInventoryInwardSchema>;

/** The picker's choice that opens the name and unit of a new item. */
const NEW_ITEM = "__new__";

export function InventoryFormDialog({
  open,
  recordId,
  onClose,
}: {
  open: boolean;
  recordId: string | null;
  onClose: () => void;
}) {
  const isEdit = recordId !== null;
  const detail = useInventoryInward(open && isEdit ? recordId : null);
  const scope = useSiteScope();
  const itemsQuery = useInventoryItems(scope.siteId);
  const create = useCreateInventoryInward();
  const update = useUpdateInventoryInward();
  const [formError, setFormError] = useState<string | null>(null);
  // "+ New item" chosen: the name and unit open.
  const [typingNew, setTypingNew] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createInventoryInwardSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setTypingNew(false);
    if (!isEdit) {
      // Dated today unless the person says otherwise. Computed on open, never at
      // module load: a tab left open overnight would otherwise offer yesterday.
      reset({ ...EMPTY, documentDate: todayInput(), siteId: scope.siteId ?? null });
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
          await update.mutateAsync({ id: recordId, body: values });
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

  const inventoryItemId = useWatch({ control, name: "inventoryItemId" });
  const items = itemsQuery.data?.rows ?? [];
  const picked = items.find((item) => item.id === inventoryItemId);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit arrival" : "New arrival"}
      description={
        isEdit
          ? "What arrived, and how much"
          : scope.siteName
            ? `Into the stock of ${scope.siteName}`
            : "Recorded against every site — choose a site in the header to narrow it"
      }
      formError={formError}
      pending={pending}
      submitLabel={isEdit ? "Save changes" : "Record arrival"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading arrival…</p>
      ) : (
        <FormSection icon={PackageCheck} title="What arrived" columns={3}>
          <SelectField
            label="Inventory item"
            required
            className="sm:col-span-2"
            value={typingNew ? NEW_ITEM : String(inventoryItemId ?? "")}
            placeholder={itemsQuery.isLoading ? "Loading items…" : "Choose the item"}
            options={[
              ...items.map((item) => ({ value: item.id, label: `${item.name} (${item.unit})` })),
              { value: NEW_ITEM, label: "+ New item…" },
            ]}
            error={typingNew ? undefined : errors.inventoryItemId?.message}
            onChange={(event) => {
              const value = event.target.value;
              if (value === NEW_ITEM) {
                setTypingNew(true);
                setValue("inventoryItemId", null, { shouldDirty: true });
              } else {
                setTypingNew(false);
                setValue("newItemName", undefined, { shouldDirty: true });
                setValue("inventoryItemId", value || null, { shouldDirty: true, shouldValidate: true });
              }
            }}
          />
          <p className="self-end pb-2 text-xs text-slate-500">
            {picked ? `In stock here: ${Number(picked.stock)} ${picked.unit}` : ""}
          </p>

          {typingNew && (
            <>
              <TextField
                label="New item name"
                required
                className="sm:col-span-2"
                placeholder="e.g. Drill machine"
                error={errors.inventoryItemId?.message ?? errors.newItemName?.message}
                {...register("newItemName")}
              />
              <TextField label="Unit" placeholder="Nos" error={errors.unit?.message} {...register("unit")} />
            </>
          )}

          <TextField
            label="Quantity"
            required
            inputMode="decimal"
            error={errors.quantity?.message}
            {...register("quantity")}
          />
          <TextField
            label="Date"
            type="date"
            error={errors.documentDate?.message}
            {...register("documentDate")}
          />
          <TextAreaField
            label="Details"
            rows={1}
            error={errors.details?.message}
            {...register("details")}
          />

          <div className="sm:col-span-3">
            <PhotoInput
              label="Photo"
              currentPath={isEdit && detail.data?.hasPhoto ? `/inventory-issues/arrivals/${recordId}/photo` : null}
              onChange={(photoKey) => setValue("photoKey", photoKey, { shouldDirty: true })}
            />
          </div>
        </FormSection>
      )}
    </FormDialog>
  );
}

const EMPTY: FormValues = {
  siteId: null,
  inventoryItemId: null,
  newItemName: undefined,
  unit: undefined,
  quantity: "",
  documentDate: "",
  details: "",
  photoKey: undefined,
};

/** `<input type="date">` wants `yyyy-mm-dd`; the API sends a full ISO timestamp. */
const dateInput = (value: string | null): string => (value ? value.slice(0, 10) : "");

/**
 * An edit KEEPS the row's own site, including a null one. Reassigning an old
 * arrival to whatever site the editor happens to be looking at would rewrite
 * history as a side effect of opening a form. An arrival from before 26 Oct 2026
 * has no inventory item: its item is picked again.
 */
const toFormValues = (detail: InventoryInwardDetail): FormValues => ({
  siteId: detail.siteId,
  inventoryItemId: detail.inventoryItemId,
  newItemName: undefined,
  unit: undefined,
  quantity: detail.quantity,
  documentDate: dateInput(detail.documentDate),
  details: text(detail.details),
  photoKey: undefined,
});
