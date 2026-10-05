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
import { useAllUnits } from "../items/api";
import { ItemCombobox } from "../items/ItemCombobox";
import {
  useCreateInventoryInward,
  useInventoryInward,
  useUpdateInventoryInward,
} from "./api";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { todayInput } from "../../lib/dates";

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
  const create = useCreateInventoryInward();
  const update = useUpdateInventoryInward();
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
    resolver: zodResolver(createInventoryInwardSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (!isEdit) {
      // Dated today unless the person says otherwise, which is what the
      // legacy screens did and what a day of data entry wants. Computed on
      // open, never at module load: a tab left open overnight would
      // otherwise offer yesterday.
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

  const unitOptions = (units.data?.rows ?? []).map((unit) => ({
    value: unit.id,
    label: unit.name,
  }));

  /** Watched rather than registered: `ItemCombobox` is a controlled picker. */
  const itemId = useWatch({ control, name: "itemId" });

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
          <FormSection icon={PackageCheck} title="What arrived" columns={3}>
            {/*
              NO `allowFreeText`. An arrival must name a catalogue item — there
              is nowhere on this document for a typed name to go — so the picker
              offers the catalogue and nothing else. The Alert that used to say
              "showing the first 200 of 758, add it to Items first if it is not
              listed" is gone with it: the search reaches all 758.
            */}
            <ItemCombobox
              label="Item"
              required
              className="sm:col-span-2"
              itemId={String(itemId ?? "")}
              error={errors.itemId?.message}
              onPick={(picked) =>
                setValue("itemId", picked, { shouldDirty: true, shouldValidate: true })
              }
            />

            <TextField
              label="Quantity"
              required
              inputMode="decimal"
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
              error={errors.documentDate?.message}
              {...register("documentDate")}
            />

            <TextAreaField
              label="Details"
              rows={1}
              error={errors.details?.message}
              {...register("details")}
            />
          </FormSection>

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
