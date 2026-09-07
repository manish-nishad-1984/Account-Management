import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createInwardChallanSchema, type InwardChallanDetail } from "@accountmanagement/contracts";
import { Paperclip } from "lucide-react";
import { Alert, FormDialog, FormSection, SelectField, TextField } from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { useAllUnits } from "../items/api";
import { useItemOptions } from "../purchase-requests/api";
import {
  useCreateInwardChallan,
  useInwardChallan,
  useSupplierOptions,
  useUpdateInwardChallan,
} from "./api";
import { useSiteScope } from "../../contexts/SiteScopeContext";

/**
 * The inward challan form — "Create Inward Item".
 *
 * The site comes from the shell, as it does on every scoped screen, so the
 * legacy Site dropdown is gone from the form. `site_id` is NOT NULL, so a
 * challan cannot be raised with no site in scope: the form says so rather than
 * failing at the server.
 */
type FormValues = z.input<typeof createInwardChallanSchema>;
type Submitted = z.output<typeof createInwardChallanSchema>;

export function InwardChallanFormDialog({
  open,
  challanId,
  onClose,
}: {
  open: boolean;
  challanId: string | null;
  onClose: () => void;
}) {
  const isEdit = challanId !== null;
  const detail = useInwardChallan(open && isEdit ? challanId : null);
  const scope = useSiteScope();
  const units = useAllUnits();
  const itemOptions = useItemOptions("");
  const suppliers = useSupplierOptions();
  const create = useCreateInwardChallan();
  const update = useUpdateInwardChallan();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createInwardChallanSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (!isEdit) {
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
          await update.mutateAsync({ id: challanId, body: values });
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

  const unitOptions = (units.data?.rows ?? []).map((u) => ({ value: u.id, label: u.name }));
  const supplierOptions = (suppliers.data?.rows ?? []).map((s) => ({ value: s.id, label: s.name }));
  const items = itemOptions.data?.rows ?? [];

  /** A challan needs a site, and the site is the header's to choose. */
  const noSiteInScope = !isEdit && scope.isReady && scope.siteId === null;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit inward challan" : "New inward challan"}
      description={
        isEdit
          ? "What arrived, from whom, against which invoice"
          : scope.siteName
            ? `Received at ${scope.siteName}`
            : "Choose a site in the header first"
      }
      formError={formError}
      pending={pending}
      submitLabel={isEdit ? "Save changes" : "Record challan"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading challan…</p>
      ) : noSiteInScope ? (
        <Alert tone="warning">
          A challan is recorded against a site, and the header is currently showing every
          site. Choose one there, then raise the challan.
        </Alert>
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
          </FormSection>

          <FormSection title="Who from" columns={2}>
            <SelectField
              label="Supplier"
              placeholder={suppliers.isLoading ? "Loading suppliers…" : "No supplier"}
              // The legacy filter looks like free text and is parsed with
              // Guid.Parse, so a typed name never matched anything.
              options={supplierOptions}
              error={errors.supplierId?.message}
              {...register("supplierId")}
            />
            <TextField
              label="Invoice no"
              hint="As the supplier wrote it — 922, 253-1, anything"
              error={errors.invoiceNo?.message}
              {...register("invoiceNo")}
            />
            <TextField
              label="Date"
              type="date"
              hint="The date on the challan"
              error={errors.documentDate?.message}
              {...register("documentDate")}
            />
            <TextField
              label="Vehicle number"
              hint="Stored in capitals"
              error={errors.vehicleNumber?.message}
              {...register("vehicleNumber")}
            />
            <TextField
              label="Receiver"
              className="sm:col-span-2"
              hint="Who took delivery. Free text — whatever the site writes down."
              error={errors.receiverName?.message}
              {...register("receiverName")}
            />
          </FormSection>

          {/* Attachments are READ ONLY for now — see the note at the foot of the
              controller. Listing them is honest; a disabled file input would not
              be. */}
          {isEdit && (detail.data?.documents.length ?? 0) > 0 && (
            <FormSection title="Attachments">
              <ul className="space-y-1 text-sm text-slate-600">
                {detail.data!.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-2">
                    <Paperclip aria-hidden className="size-3.5 text-slate-400" />
                    <span>{doc.documentName}</span>
                    {doc.storageKey === null && (
                      <span className="text-xs text-slate-400">(on the old server)</span>
                    )}
                  </li>
                ))}
              </ul>
            </FormSection>
          )}

          {!isEdit && (
            <Alert tone="info">
              A new challan is recorded unapproved. Attaching files is not available yet —
              the old system keeps them on its own web server, and where they go next is
              still to be decided.
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
  supplierId: "",
  unitId: "" as unknown as number,
  quantity: "",
  invoiceNo: "",
  documentDate: "",
  vehicleNumber: "",
  receiverName: "",
};

/** `<input type="date">` wants `yyyy-mm-dd`; the API sends a full ISO timestamp. */
const dateInput = (value: string | null): string => (value ? value.slice(0, 10) : "");

/** An edit keeps the challan's own site, never the one the editor is looking at. */
const toFormValues = (detail: InwardChallanDetail): FormValues => ({
  siteId: detail.siteId,
  itemId: detail.itemId,
  supplierId: text(detail.supplierId),
  unitId: detail.unitId,
  quantity: detail.quantity,
  invoiceNo: text(detail.invoiceNo),
  documentDate: dateInput(detail.documentDate),
  vehicleNumber: text(detail.vehicleNumber),
  receiverName: text(detail.receiverName),
});
