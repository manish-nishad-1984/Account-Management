import { useEffect, useState } from "react";
import { useForm, useWatch, type UseFormRegisterReturn } from "react-hook-form";
import { List } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createInwardChallanSchema, type InwardChallanDetail } from "@accountmanagement/contracts";
import { Alert, Button, FormDialog, FormSection, SelectField, TextField } from "../../components/ui";
import {
  ChallanAttachments,
  QueuedAttachments,
  UploadingNotice,
} from "./ChallanAttachments";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { useAllUnits } from "../items/api";
import { useItemOptions } from "../purchase-requests/api";
import {
  useAttachChallanDocuments,
  useChallanReceivers,
  useCreateInwardChallan,
  useInwardChallan,
  useSupplierOptions,
  useUpdateInwardChallan,
} from "./api";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { todayInput } from "../../lib/dates";

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
  const attach = useAttachChallanDocuments();
  const [formError, setFormError] = useState<string | null>(null);
  /**
   * Files chosen on a NEW challan, held until there is an id to hang them off.
   * A challan must exist before anything can reference it.
   */
  const [queued, setQueued] = useState<File[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createInwardChallanSchema),
    defaultValues: EMPTY,
  });
  const [siteId, receiverName] = useWatch({ control, name: ["siteId", "receiverName"] });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setQueued([]);
    if (!isEdit) {
      // Dated today unless the person says otherwise, which is what the
      // legacy screens did and what a day of data entry wants. Computed on
      // open, never at module load: a tab left open overnight would
      // otherwise offer yesterday.
      reset({ ...EMPTY, documentDate: todayInput(), siteId: scope.siteId ?? "" });
    } else if (detail.data) {
      reset(toFormValues(detail.data));
    }
  }, [open, isEdit, detail.data, reset, scope.siteId]);

  const pending = create.isPending || update.isPending || attach.isPending;

  const onSubmit = handleSubmit(
    async (values) => {
      setFormError(null);
      try {
        if (isEdit) {
          await update.mutateAsync({ id: challanId, body: values });
          onClose();
          return;
        }

        const created = await create.mutateAsync(values);

        /**
         * TWO STEPS, AND THE SECOND CAN FAIL ON ITS OWN.
         *
         * The challan is saved first because the files need its id. If the
         * upload then fails, the challan EXISTS — so the dialog stays open,
         * says exactly that, and keeps the queue so the user can retry the
         * files rather than re-keying the challan. Closing here and reporting
         * a generic failure would leave them to guess whether anything saved.
         */
        if (queued.length > 0) {
          try {
            await attach.mutateAsync({ id: created.id, files: queued });
          } catch (uploadError) {
            setFormError(
              `The challan was saved, but the files were not attached: ${
                uploadError instanceof Error ? uploadError.message : "upload failed"
              } You can attach them by editing the challan.`,
            );
            return;
          }
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
              // "Challan No." at the client's request (15 Sep 2026). The same
              // field — `invoiceNo` — only the label changed.
              label="Challan No."
              hint="As written on the challan — 922, 253-1, anything"
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
            <ReceiverField
              siteId={siteId || null}
              value={receiverName ?? ""}
              error={errors.receiverName?.message}
              onChoose={(label) =>
                setValue("receiverName", label, { shouldDirty: true, shouldValidate: true })
              }
              textInput={register("receiverName")}
            />
          </FormSection>

          <FormSection title="Attachments" columns={1}>
            {isEdit ? (
              <ChallanAttachments
                challanId={challanId}
                documents={detail.data?.documents ?? []}
              />
            ) : attach.isPending ? (
              <UploadingNotice count={queued.length} />
            ) : (
              <QueuedAttachments files={queued} onChange={setQueued} />
            )}
          </FormSection>

          {!isEdit && <Alert tone="info">A new challan is recorded unapproved.</Alert>}
        </>
      )}
    </FormDialog>
  );
}

const SOMEONE_ELSE = "__someone-else__";

/**
 * Receiver: chosen from the site's contacts in the Site master, written as
 * "Nikunj-989898988" (client request, 15 Sep 2026).
 *
 * STILL A TEXT FIELD UNDERNEATH. `receiver_name` has always been free text, and
 * old challans hold whatever the site wrote down, so:
 *  - "Someone else — type a name" opens a text box, for a driver or a visitor
 *    who is not on the list;
 *  - a challan whose receiver is not one of today's contacts opens in the text
 *    box with its value, rather than showing a blank dropdown and losing it;
 *  - a site with no contacts, or contacts that fail to load, gets the text box,
 *    so a challan can always be recorded.
 */
function ReceiverField({
  siteId,
  value,
  error,
  onChoose,
  textInput,
}: {
  siteId: string | null;
  value: string;
  error?: string;
  onChoose: (label: string) => void;
  textInput: UseFormRegisterReturn;
}) {
  const receivers = useChallanReceivers(siteId);
  const contacts = receivers.data?.rows ?? [];
  const [typing, setTyping] = useState(false);

  const known = contacts.some((contact) => contact.label === value);
  const showText = contacts.length === 0 || typing || (value !== "" && !known);

  if (receivers.isLoading) {
    return (
      <SelectField
        label="Receiver"
        className="sm:col-span-2"
        placeholder="Loading site contacts…"
        options={[]}
        value=""
        disabled
        onChange={() => {}}
      />
    );
  }

  if (showText) {
    return (
      <div className="flex items-end gap-2 sm:col-span-2">
        <TextField
          label="Receiver"
          className="flex-1"
          hint={
            contacts.length === 0
              ? "This site has no contacts in the Site master. Type who took delivery."
              : "Who took delivery, if not one of the site's contacts."
          }
          error={error}
          {...textInput}
        />
        {contacts.length > 0 && (
          <Button
            variant="secondary"
            icon={List}
            className="mb-5"
            onClick={() => {
              setTyping(false);
              onChoose("");
            }}
          >
            Site contacts
          </Button>
        )}
      </div>
    );
  }

  return (
    <SelectField
      label="Receiver"
      className="sm:col-span-2"
      hint="The site's contacts, from the Site master."
      error={error}
      value={value}
      onChange={(event) => {
        if (event.target.value === SOMEONE_ELSE) {
          setTyping(true);
          onChoose("");
        } else {
          onChoose(event.target.value);
        }
      }}
      options={[
        { value: "", label: "Choose who took delivery" },
        ...contacts.map((contact) => ({ value: contact.label, label: contact.label })),
        { value: SOMEONE_ELSE, label: "Someone else — type a name" },
      ]}
    />
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
