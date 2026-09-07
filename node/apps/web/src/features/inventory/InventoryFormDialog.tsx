import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  createInventoryInwardSchema,
  type InventoryInwardDetail,
} from "@accountmanagement/contracts";
import { Alert, FormDialog, FormSection, SelectField, TextAreaField, TextField } from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { useAllUnits } from "../items/api";
import { useItemOptions } from "../purchase-requests/api";
import {
  useCreateInventoryInward,
  useInventoryInward,
  useUpdateInventoryInward,
} from "./api";
import { useSiteScope } from "../../contexts/SiteScopeContext";

/**
 * The inventory arrival form. Six fields, matching "Create Inventory".
 *
 * NO SITE FIELD, matching the source — and the site is nonetheless recorded.
 * The scope in the header supplies it, so a new arrival is attributable without
 * adding a control the old screen never had. The list says which site that is.
 *
 * NO APPROVAL FIELD either. `InsertInventoryDetails` hard-codes
 * `IsApproved = true`, so every arrival in production posted already approved
 * and the Approve column has never gated anything. New rows are created
 * unapproved; approving is a separate action needing the approve right.
 */
type FormValues = z.input<typeof createInventoryInwardSchema>;
type Submitted = z.output<typeof createInventoryInwardSchema>;

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
  const units = useAllUnits();
  const itemOptions = useItemOptions("");
  const create = useCreateInventoryInward();
  const update = useUpdateInventoryInward();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createInventoryInwardSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (!isEdit) {
      reset({ ...EMPTY, siteId: scope.siteId ?? null });
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
      title={isEdit ? "Edit inventory arrival" : "New inventory arrival"}
      description={
        isEdit
          ? "What arrived, and how much"
          : scope.siteName
            ? `Recorded against ${scope.siteName}`
            : "Recorded against every site — choose a site in the header to narrow it"
      }
      formError={formError}
      pending={pending}
      submitLabel={isEdit ? "Save changes" : "Record arrival"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading arrival…</p>
      ) : (
        <>
          <FormSection title="What arrived" columns={2}>
            <SelectField
              label="Item"
              required
              autoFocus
              className="sm:col-span-2"
              placeholder={itemOptions.isLoading ? "Loading items…" : "Choose an item"}
              options={items.map((item) => ({ value: item.id, label: item.name }))}
              error={errors.itemId?.message}
              {...register("itemId")}
            />

            {itemsTruncated && (
              <Alert tone="info" className="sm:col-span-2">
                Showing the first {items.length} of {itemTotal} items. Unlike a purchase
                request, an arrival must name a catalogue item — add it to Items first if
                it is not listed.
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

            <TextField
              label="Date"
              type="date"
              hint="The date it arrived"
              error={errors.documentDate?.message}
              {...register("documentDate")}
            />

            <TextAreaField
              label="Details"
              className="sm:col-span-2"
              rows={3}
              // "TO RAJAOUL" in the captured row is a destination, not a
              // description. The hint stays open about what belongs here.
              hint="Free text — whatever needs noting about this arrival"
              error={errors.details?.message}
              {...register("details")}
            />
          </FormSection>

          {!isEdit && (
            <Alert tone="info">
              A new arrival is recorded unapproved. Approving it is a separate action and
              needs the approve right. The old screen approved every arrival on save.
            </Alert>
          )}
        </>
      )}
    </FormDialog>
  );
}

const EMPTY: FormValues = {
  siteId: null,
  itemId: "",
  unitId: "" as unknown as number,
  quantity: "",
  documentDate: "",
  details: "",
};

/** `<input type="date">` wants `yyyy-mm-dd`; the API sends a full ISO timestamp. */
const dateInput = (value: string | null): string => (value ? value.slice(0, 10) : "");

/**
 * An edit KEEPS the row's own site, including a null one. Reassigning an old
 * arrival to whatever site the editor happens to be looking at would rewrite
 * history as a side effect of opening a form.
 */
const toFormValues = (detail: InventoryInwardDetail): FormValues => ({
  siteId: detail.siteId,
  itemId: detail.itemId,
  unitId: detail.unitId,
  quantity: detail.quantity,
  documentDate: dateInput(detail.documentDate),
  details: text(detail.details),
});
