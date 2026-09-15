import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  INVOICE_TYPES,
  createPurchaseInvoiceSchema,
  type PurchaseInvoiceDetail,
} from "@accountmanagement/contracts";
import { invoiceTotal } from "@accountmanagement/domain";
import {
  Alert,
  FormDialog,
  FormSection,
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { formatMoney } from "../../lib/format";
import { useLatestPriceFill } from "../invoices/useLatestPriceFill";
import { InvoiceLineGrid, previewNumber } from "../invoices/InvoiceLineGrid";
import { useAllUnits } from "../items/api";
import { useItemOptions } from "../purchase-requests/api";
import { useCompanyOptions, useSupplierOptions } from "../purchase-orders/api";
import {
  useCreatePurchaseInvoice,
  usePurchaseInvoice,
  usePurchaseOrderOptions,
  useUpdatePurchaseInvoice,
} from "./api";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { todayInput } from "../../lib/dates";
import { SiteAddressFields } from "../sites/SiteAddressFields";
import { SiteContactSelect } from "../sites/SiteContactSelect";

/**
 * The purchase invoice form — the screen `11-create-purchase-invoice.md` calls
 * the one that decides the money model.
 *
 * THE TOTALS PANEL HAS SIX LINES, and every one of them is computed by
 * `invoiceTotal.corrected()` — the same function the server stores from. The
 * legacy screen's six-line panel is computed by a calculator that has been
 * overwritten by the purchase ORDER one, which has no discount, no TDS and no
 * round-off term at all, and which reads a different set of table rows than the
 * page renders. So on the live screen:
 *
 *   - the TDS box moves nothing;
 *   - the Adjustment box moves nothing;
 *   - the grand total is not rounded to a rupee, though every stored one is;
 *   - and lines the page opened with are not counted.
 *
 * Here the browser and the server cannot disagree, because there is one
 * implementation and the server's answer is the one stored.
 */
type FormValues = z.input<typeof createPurchaseInvoiceSchema>;
type Submitted = z.output<typeof createPurchaseInvoiceSchema>;

const EMPTY_LINE = {
  itemId: "",
  itemName: "",
  itemDescription: "",
  unitId: "" as unknown as number,
  quantity: "",
  unitPrice: "",
  discountPerUnit: "",
  gstPercent: "",
};

const EMPTY: FormValues = {
  supplierInvoiceNo: "",
  invoiceType: "Purchase",
  siteId: "",
  supplierId: "",
  companyId: "",
  siteLocationId: "",
  purchaseOrderId: "",
  documentDate: "",
  challanNo: "",
  lrNo: "",
  vehicleNo: "",
  dispatchBy: "",
  paymentTerms: "",
  description: "",
  contactName: "",
  contactNumber: "",
  shippingAddress: "",
  tds: "",
  roundOff: "",
  items: [EMPTY_LINE],
};

const dateInput = (value: string | null): string => (value ? value.slice(0, 10) : "");

const toFormValues = (detail: PurchaseInvoiceDetail): FormValues => ({
  supplierInvoiceNo: text(detail.supplierInvoiceNo) ?? "",
  invoiceType: (INVOICE_TYPES as readonly string[]).includes(detail.invoiceType)
    ? (detail.invoiceType as FormValues["invoiceType"])
    : "Purchase",
  siteId: text(detail.siteId),
  supplierId: detail.supplierId,
  companyId: detail.companyId,
  siteLocationId: text(detail.siteLocationId),
  purchaseOrderId: text(detail.purchaseOrderId),
  documentDate: dateInput(detail.documentDate),
  challanNo: text(detail.challanNo),
  lrNo: text(detail.lrNo),
  vehicleNo: text(detail.vehicleNo),
  dispatchBy: text(detail.dispatchBy),
  paymentTerms: text(detail.paymentTerms),
  description: text(detail.description),
  contactName: text(detail.contactName),
  contactNumber: text(detail.contactNumber),
  shippingAddress: text(detail.shippingAddress),
  tds: detail.tds,
  roundOff: detail.roundOff,
  items: detail.items.map((line) => ({
    itemId: text(line.itemId),
    itemName: line.itemId === null ? line.itemLabel : "",
    itemDescription: text(line.itemDescription),
    unitId: line.unitId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPerUnit: line.discountPerUnit,
    gstPercent: text(line.gstPercent),
  })),
});

export function PurchaseInvoiceFormDialog({
  open,
  invoiceId,
  onClose,
}: {
  open: boolean;
  invoiceId: string | null;
  onClose: () => void;
}) {
  const isEdit = invoiceId !== null;
  const detail = usePurchaseInvoice(open && isEdit ? invoiceId : null);

  const scope = useSiteScope();
  const units = useAllUnits();
  const itemOptions = useItemOptions("");
  const suppliers = useSupplierOptions();
  const companies = useCompanyOptions();
  const create = useCreatePurchaseInvoice();
  const update = useUpdatePurchaseInvoice();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    getValues,
    watch,
    control,
    formState: { errors, isSubmitted },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createPurchaseInvoiceSchema),
    defaultValues: EMPTY,
  });

  const { fields, insert, remove } = useFieldArray({ control, name: "items" });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
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

  const pending = create.isPending || update.isPending;

  /**
   * Live totals, from the domain calculator rather than a copy of it.
   *
   * `useWatch`, NOT `watch("items")` — with a `useFieldArray` the latter does not
   * re-render per keystroke, so every computed cell falls through to its
   * fallback and the grid shows 0.00 while the arithmetic is never called. That
   * shipped once on the purchase order form and only a real browser caught it.
   */
  const lines = useWatch({ control, name: "items" });
  const tds = useWatch({ control, name: "tds" });
  const roundOff = useWatch({ control, name: "roundOff" });

  const totals = useMemo(
    () =>
      invoiceTotal.corrected(
        (lines ?? []).map((line) => ({
          unitPrice: previewNumber(line?.unitPrice),
          quantity: previewNumber(line?.quantity),
          discountPerUnit: previewNumber(line?.discountPerUnit),
          gstPercent: previewNumber(line?.gstPercent),
        })),
        { tds: previewNumber(tds), roundOff: previewNumber(roundOff) },
      ),
    [lines, tds, roundOff],
  );

  const onSubmit = handleSubmit(
    async (values) => {
      setFormError(null);
      try {
        if (isEdit) {
          await update.mutateAsync({ id: invoiceId, body: values });
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
  const unitOptions = (units.data?.rows ?? []).map((unit) => ({ value: unit.id, label: unit.name }));
  const supplierOptions = (suppliers.data?.rows ?? []).map((row) => ({
    value: row.id,
    label: row.name,
  }));
  const companyOptions = (companies.data?.rows ?? []).map((row) => ({
    value: row.id,
    label: row.name,
  }));

  const items = itemOptions.data?.rows ?? [];
  const itemTotal = itemOptions.data?.total ?? 0;
  const itemsTruncated = itemTotal > items.length;
  const itemChoices = items.map((item) => ({ value: item.id, label: item.name }));

  // Choosing an item fills its price, unit and GST from the latest purchase invoice
  // for it, or from the item master (client request, 14 Sep 2026).
  const latestPrice = useLatestPriceFill({
    direction: "out",
    currentItemId: (index) => getValues(`items.${index}.itemId`),
    fill: (index, price) => {
      const options = { shouldDirty: true, shouldValidate: isSubmitted };
      setValue(`items.${index}.unitPrice`, price.unitPrice, options);
      setValue(`items.${index}.unitId`, price.unitId, options);
      setValue(`items.${index}.gstPercent`, price.gstPercent ?? "", options);
      // "0.00" is how an undiscounted line is stored; an empty box reads better.
      const discount = price.discountPerUnit && Number(price.discountPerUnit) !== 0 ? price.discountPerUnit : "";
      setValue(`items.${index}.discountPerUnit`, discount, options);
    },
  });

  // The order dropdown is scoped to the chosen supplier — an invoice bills an
  // order the SAME supplier raised, and offering all of them invites exactly the
  // mismatch the legacy text match makes silently.
  const chosenSupplierId = watch("supplierId");
  // Watched, so the location and addresses follow the chosen site. `useWatch`
  // for the two written by `setValue`, which `watch` does not re-render for.
  const chosenSiteId = watch("siteId") as string | undefined;
  const chosenLocationId = useWatch({ control, name: "siteLocationId" });
  const shippingAddress = useWatch({ control, name: "shippingAddress" });
  const contactName = useWatch({ control, name: "contactName" });
  const contactNumber = useWatch({ control, name: "contactNumber" });
  const orders = usePurchaseOrderOptions(chosenSupplierId || null);
  const orderChoices = (orders.data?.rows ?? []).map((row) => ({
    value: row.id,
    label: `${row.poNo} · ${formatMoney(row.totalAmount)}`,
  }));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit purchase invoice" : "New purchase invoice"}
      description={
        isEdit
          ? `Invoice ${detail.data?.displayNo ?? ""}`
          : "The number is the supplier's, not ours"
      }
      formError={formError}
      pending={pending}
      submitLabel={isEdit ? "Save changes" : "Add purchase invoice"}
      // Wider than the master dialogs, because the body is a data-entry grid.
      size="xl"
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading invoice…</p>
      ) : (
        <>
          <FormSection title="Invoice" columns={2}>
            {/*
              REQUIRED, and it is the SUPPLIER'S number — free text in whatever
              format they use. Deliberately not checked for uniqueness: two
              suppliers both numbering an invoice "016" is ordinary, and refusing
              the second would be refusing a real document.
            */}
            <TextField
              label="Supplier's invoice number"
              required
              autoFocus
              hint="As printed on their invoice — BB/154, 016, AE/26-27/00872"
              error={errors.supplierInvoiceNo?.message}
              {...register("supplierInvoiceNo")}
            />
            <TextField
              label="Invoice date"
              type="date"
              error={errors.documentDate?.message}
              {...register("documentDate")}
            />
            <SelectField
              label="Supplier"
              required
              placeholder={suppliers.isLoading ? "Loading suppliers…" : "Choose a supplier"}
              options={supplierOptions}
              error={errors.supplierId?.message}
              {...register("supplierId")}
            />
            <SelectField
              label="Company"
              required
              placeholder={companies.isLoading ? "Loading companies…" : "Choose a company"}
              options={companyOptions}
              error={errors.companyId?.message}
              {...register("companyId")}
            />
            <SelectField
              label="Site"
              placeholder={scope.isReady ? "No site" : "Loading sites…"}
              options={siteOptions}
              hint="Optional — the source allows an invoice with no site"
              error={errors.siteId?.message}
              {...register("siteId", {
                // The location, shipping address and contact belonged to the site
                // chosen before. Cleared HERE, on the person's change, and not by
                // watching the value — see SiteAddressFields.
                onChange: () => {
                  setValue("siteLocationId", "");
                  setValue("shippingAddress", "");
                  setValue("contactName", "");
                  setValue("contactNumber", "");
                },
              })}
            />
            <SelectField
              label="Type"
              options={INVOICE_TYPES.map((value) => ({ value, label: value }))}
              hint="Returns and credit notes are money going the other way"
              error={errors.invoiceType?.message}
              {...register("invoiceType")}
            />
          </FormSection>

          <FormSection title="Against a purchase order" columns={1}>
            {/*
              `SupplierInvoice.Poid` is an nvarchar holding the order's NUMBER as
              text, matched by string equality — assessment 09 §7.5. Renaming or
              reissuing an order silently detaches its invoices today. Here it is
              a real foreign key, chosen from a list.
            */}
            <SelectField
              label="Purchase order"
              placeholder={
                !chosenSupplierId
                  ? "Choose a supplier first"
                  : orders.isLoading
                    ? "Loading orders…"
                    : orderChoices.length === 0
                      ? "This supplier has no orders"
                      : "Not against an order"
              }
              options={orderChoices}
              hint="Optional. Only orders raised on the chosen supplier are listed."
              error={errors.purchaseOrderId?.message}
              {...register("purchaseOrderId")}
            />
          </FormSection>

          {/*
            `columns={1}` IS LOAD-BEARING — FormSection defaults to two, and
            without it the grid is squeezed into half the dialog and the
            Add-product button sits beside it instead of below.
          */}
          <FormSection title="Products" columns={1}>
            <InvoiceLineGrid
              fields={fields}
              lines={lines}
              totals={totals}
              itemChoices={itemChoices}
              unitOptions={unitOptions}
              register={register as unknown as (name: string) => ReturnType<typeof register>}
              lineError={(index, field) => errors.items?.[index]?.[field]?.message}
              onInsert={(index) => insert(index + 1, EMPTY_LINE, { shouldFocus: false })}
              onRemove={remove}
              onItemChosen={(index, itemId) => {
                setValue(`items.${index}.itemName`, "");
                // Quantity 1 when the line has none yet (client request, 14 Sep
                // 2026). A quantity already typed is the person's, and kept.
                if (Number(previewNumber(getValues(`items.${index}.quantity`))) === 0) {
                  setValue(`items.${index}.quantity`, "1", { shouldDirty: true });
                }
                latestPrice.onItemChosen(index, itemId);
              }}
              priceHint={(index) => latestPrice.hintFor(lines?.[index]?.itemId)}
              footerNote={
                itemsTruncated && (
                  <Alert tone="info">
                    Showing the first {items.length} of {itemTotal} items. If the one you need is
                    not listed, type its name beside the dropdown — an invoice line can name a
                    product that is not in the catalogue.
                  </Alert>
                )
              }
            />
          </FormSection>

          <FormSection title="Charges" columns={2}>
            <TextField
              label="TDS"
              inputMode="decimal"
              hint="Tax deducted at source. Subtracted from the total."
              error={errors.tds?.message}
              {...register("tds")}
            />
            <TextField
              label="Adjustment"
              inputMode="decimal"
              hint="Added to the total. Use a minus to nudge it down."
              error={errors.roundOff?.message}
              {...register("roundOff")}
            />
          </FormSection>

          <FormSection title="Totals" columns={2}>
            <Summary label="Sub total" value={formatMoney(totals.subtotal)} />
            <Summary label="Total GST" value={formatMoney(totals.totalGst)} />
            <Summary label="Discount" value={formatMoney(totals.totalDiscount)} />
            <Summary label="TDS" value={`− ${formatMoney(totals.tds)}`} />
            <Summary label="Adjustment" value={formatMoney(totals.roundOff)} />
            <Summary label="Total amount" value={formatMoney(totals.grandTotal)} strong />

            {/*
              Said on the screen, because it is a real rule that surprises people
              and because the alternative is someone reporting the paise as a bug.
            */}
            <Alert tone="info" className="sm:col-span-2">
              The total is rounded to a whole rupee, with exactly 50 paise rounding down — the rule
              every invoice this business has issued was calculated with. The subtotal, GST and
              discount above are exact.
            </Alert>
          </FormSection>

          <FormSection title="Delivery and contacts" columns={2}>
            <TextField
              label="Challan number"
              error={errors.challanNo?.message}
              {...register("challanNo")}
            />
            <TextField label="LR number" error={errors.lrNo?.message} {...register("lrNo")} />
            <TextField
              label="Vehicle number"
              error={errors.vehicleNo?.message}
              {...register("vehicleNo")}
            />
            <TextField
              label="Dispatch by"
              error={errors.dispatchBy?.message}
              {...register("dispatchBy")}
            />
            <SiteContactSelect
              siteId={chosenSiteId}
              name={contactName}
              number={contactNumber}
              onChange={(name, number) => {
                setValue("contactName", name, { shouldDirty: true });
                setValue("contactNumber", number, { shouldDirty: true });
              }}
              error={errors.contactName?.message ?? errors.contactNumber?.message}
            />
            <TextField
              label="Payment terms"
              error={errors.paymentTerms?.message}
              {...register("paymentTerms")}
            />
          </FormSection>

          <FormSection title="Location, addresses and notes" columns={1}>
            {/*
              Billing is the site's own address; shipping is ONE of the site's
              addresses, chosen — the rules of 15 Sep 2026. Either is copied onto
              the invoice as text, so correcting the site later cannot rewrite
              where a delivery already went.
            */}
            <SiteAddressFields
              siteId={chosenSiteId}
              shippingAddress={shippingAddress}
              onShippingChange={(address) =>
                setValue("shippingAddress", address, { shouldDirty: true })
              }
              shippingError={errors.shippingAddress?.message}
              location={{
                value: chosenLocationId,
                onChange: (locationId) =>
                  setValue("siteLocationId", locationId, { shouldDirty: true }),
                error: errors.siteLocationId?.message,
              }}
            />
            <TextAreaField
              label="Notes"
              rows={3}
              error={errors.description?.message}
              {...register("description")}
            />
          </FormSection>

          {!isEdit && (
            <Alert tone="info">
              A new invoice is created unapproved. Approving it is a separate action and needs the
              approve right.
            </Alert>
          )}
        </>
      )}
    </FormDialog>
  );
}

function Summary({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={`tabular mt-0.5 ${strong ? "text-lg font-semibold text-slate-900" : "text-slate-800"}`}
      >
        {value}
      </div>
    </div>
  );
}
