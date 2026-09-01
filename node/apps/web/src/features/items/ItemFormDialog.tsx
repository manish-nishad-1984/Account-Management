import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createItemSchema, type ItemDetail } from "@accountmanagement/contracts";
import {
  Alert,
  CheckboxField,
  FormDialog,
  FormSection,
  SelectField,
  TextField,
} from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { useAllUnits, useCreateItem, useItem, useUpdateItem } from "./api";

/**
 * The item form.
 *
 * THE GST FIGURES ARE NOT CALCULATED HERE, and that is the most important thing
 * about this screen.
 *
 * `gstAmount` is derivable from `pricePerUnit` and `gstPercent`, so the obvious
 * move is to compute it as the user types. The obvious move is wrong: the
 * existing system computes GST in the browser with THREE different jQuery
 * implementations that do not agree (assessment finding B-2), and which of them
 * is correct is an open question with the business
 * (`07-Business-Rule-Inventory.md`, the longest-lead blocker). Adding a fourth
 * calculation here would silently pick a winner, in a master screen, months
 * before anyone decides.
 *
 * So the field is entered, validated for shape and internal consistency, and
 * stored. When the rule is settled it belongs in `packages/domain` with tests,
 * called by the server — not in a component.
 */
type FormValues = z.input<typeof createItemSchema>;
type Submitted = z.output<typeof createItemSchema>;

export function ItemFormDialog({
  open,
  itemId,
  onClose,
}: {
  open: boolean;
  itemId: string | null;
  onClose: () => void;
}) {
  const isEdit = itemId !== null;
  const detail = useItem(open && isEdit ? itemId : null);
  const units = useAllUnits();
  const create = useCreateItem();
  const update = useUpdateItem();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createItemSchema),
    defaultValues: EMPTY,
  });

  const isWithGst = watch("isWithGst");

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
        await update.mutateAsync({ id: itemId, body: values });
      } else {
        await create.mutateAsync(values);
      }
      onClose();
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  }, (invalid) => setFormError(unshownValidationMessage(invalid)));

  const unitOptions = (units.data?.rows ?? []).map((unit) => ({
    value: unit.id,
    label: unit.name,
  }));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit item" : "Add item"}
      description="A material or service that appears on purchase orders"
      formError={formError}
      pending={pending}
      submitLabel={isEdit ? "Save changes" : "Create item"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading item…</p>
      ) : (
        <>
          <FormSection title="Item">
            <TextField
              label="Item name"
              required
              autoFocus
              error={errors.name?.message}
              {...register("name")}
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
              label="Price per unit"
              required
              inputMode="decimal"
              hint="Amount with at most 2 decimal places"
              error={errors.pricePerUnit?.message}
              {...register("pricePerUnit")}
            />
            <TextField
              label="HSN code"
              inputMode="numeric"
              hint="4, 6 or 8 digits"
              error={errors.hsnCode?.message}
              {...register("hsnCode")}
            />
          </FormSection>

          <FormSection title="GST" columns={2}>
            <CheckboxField
              label="Item is GST-inclusive"
              className="sm:col-span-2"
              {...register("isWithGst")}
            />

            {isWithGst && (
              <>
                <TextField
                  label="GST percentage"
                  required
                  inputMode="decimal"
                  hint="5, 12, 18 or 28"
                  error={errors.gstPercent?.message}
                  {...register("gstPercent")}
                />
                <TextField
                  label="GST amount"
                  inputMode="decimal"
                  error={errors.gstAmount?.message}
                  {...register("gstAmount")}
                />
                <Alert tone="info" className="sm:col-span-2">
                  The GST amount is stored exactly as entered. It is not calculated
                  from the price and percentage — three different calculations
                  exist in the current system and which is correct has not been
                  settled with the business.
                </Alert>
              </>
            )}
          </FormSection>

          <FormSection title="Status" columns={1}>
            <CheckboxField
              label="Approved"
              hint="Recorded on the item. It does not currently prevent use on a purchase order."
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
  unitId: "" as unknown as number,
  pricePerUnit: "",
  isWithGst: false,
  gstPercent: "",
  gstAmount: "",
  hsnCode: "",
  isApproved: false,
};

const toFormValues = (detail: ItemDetail): FormValues => ({
  name: detail.name,
  unitId: detail.unitId,
  pricePerUnit: detail.pricePerUnit,
  isWithGst: detail.isWithGst,
  gstPercent: text(detail.gstPercent),
  gstAmount: text(detail.gstAmount),
  hsnCode: text(detail.hsnCode),
  isApproved: detail.isApproved,
});
