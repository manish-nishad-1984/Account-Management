import { Boxes, MapPin, Receipt, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  SALES_INVOICE_TYPES,
  createSalesInvoiceSchema,
  type SalesInvoiceDetail,
} from "@accountmanagement/contracts";
import { invoiceTotal } from "@accountmanagement/domain";
import {
  Alert,
  FormDialog,
  FormSection,
  SelectField,
  TextAreaField,
  TextField,
  SummaryStrip,
} from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { formatMoney } from "../../lib/format";
import { useLatestPriceFill } from "../invoices/useLatestPriceFill";
import { InvoiceLineGrid, previewNumber } from "../invoices/InvoiceLineGrid";
import { GstBreakdown } from "../invoices/GstBreakdown";
import { useAllUnits } from "../items/api";

import {
  useCompanyOptions,
  useCreateSalesInvoice,
  useCustomerOptions,
  useSalesInvoice,
  useUpdateSalesInvoice,
} from "./api";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { todayInput } from "../../lib/dates";
import { SavedDocumentPdfButton } from "../document-templates/DocumentActions";
import { SiteAddressFields } from "../sites/SiteAddressFields";
import { SiteContactSelect } from "../sites/SiteContactSelect";

/**
 * The sales invoice form — the purchase invoice with the direction reversed.
 *
 * `13-create-sales-invoice.md`: "One editor component, two directions. The
 * difference is: which side is the counterparty, whether the invoice number is
 * generated or typed, and whether the Active PO link exists." All three are
 * here and nothing else is, which is why the grid itself comes from
 * `InvoiceLineGrid` rather than being written twice.
 *
 * THE SALES CALCULATOR IS THE HEALTHIEST OF THE THREE in the source — one
 * script, and its row class matches the partial that renders rows — so B-2's
 * two defects do not apply to this screen. The two it DOES have are about the
 * price, and both are made unrepresentable here rather than reproduced:
 *
 *  1. The source keeps an editable visible price AND a hidden catalogue twin,
 *     computes the line's GST from the hidden one and the roll-up from the
 *     visible one. Type a price and GST is charged on a different number.
 *  2. Typing a discount afterwards overwrites the typed price with
 *     `catalogue − discount`, silently.
 *
 * There is one price here. It is the price.
 */
type FormValues = z.input<typeof createSalesInvoiceSchema>;
type Submitted = z.output<typeof createSalesInvoiceSchema>;

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
  invoiceType: "Sales",
  customerId: "",
  companyId: "",
  siteId: "",
  customerInvoiceNo: "",
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

const toFormValues = (detail: SalesInvoiceDetail): FormValues => ({
  invoiceType: (SALES_INVOICE_TYPES as readonly string[]).includes(detail.invoiceType)
    ? (detail.invoiceType as FormValues["invoiceType"])
    : "Sales",
  customerId: detail.customerId,
  companyId: detail.companyId,
  siteId: text(detail.siteId),
  customerInvoiceNo: text(detail.customerInvoiceNo),
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

export function SalesInvoiceFormDialog({
  open,
  invoiceId,
  onClose,
}: {
  open: boolean;
  invoiceId: string | null;
  onClose: () => void;
}) {
  const isEdit = invoiceId !== null;
  const detail = useSalesInvoice(open && isEdit ? invoiceId : null);

  const scope = useSiteScope();
  const units = useAllUnits();
  const customers = useCustomerOptions();
  const companies = useCompanyOptions();
  const create = useCreateSalesInvoice();
  const update = useUpdateSalesInvoice();
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
    formState: { errors, isSubmitted, isDirty },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createSalesInvoiceSchema),
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

  /** `useWatch`, not `watch` — see the purchase form for what that cost once. */
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
  const customerOptions = (customers.data?.rows ?? []).map((row) => ({
    value: row.id,
    label: row.name,
  }));
  const companyRows = companies.data?.rows ?? [];
  const companyOptions = companyRows.map((row) => ({ value: row.id, label: row.name }));



  // Choosing an item fills its price, unit and GST from the latest sales invoice
  // for it, or from the item master (client request, 14 Sep 2026).
  const latestPrice = useLatestPriceFill({
    direction: "in",
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

  const chosenCompanyId = watch("companyId");
  // Watched, so the addresses follow the chosen site. `useWatch` for the
  // shipping address, which is written by `setValue` and `watch` misses.
  const chosenSiteId = watch("siteId") as string | undefined;
  const shippingAddress = useWatch({ control, name: "shippingAddress" });
  const contactName = useWatch({ control, name: "contactName" });
  const contactNumber = useWatch({ control, name: "contactNumber" });
  const chosenCompany = companyRows.find((row) => row.id === chosenCompanyId);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit sales invoice" : "New sales invoice"}
      description={
        isEdit
          ? `Invoice ${detail.data?.salesInvoiceNo ?? ""}`
          : "The invoice number is issued when this is saved"
      }
      formError={formError}
      pending={pending}
      footerStart={
        invoiceId !== null ? <SavedDocumentPdfButton documentType="sales-invoice" id={invoiceId} dirty={isDirty} /> : undefined
      }
      submitLabel={isEdit ? "Save changes" : "Add sales invoice"}
      size="xl"
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading invoice…</p>
      ) : (
        <>
          <FormSection icon={Receipt} title="Invoice" columns={2}>
            <SelectField
              label="Customer"
              required
              autoFocus
              placeholder={customers.isLoading ? "Loading customers…" : "Choose a customer"}
              options={customerOptions}
              // The dropdown is the supplier master. Said once, here, rather
              // than leaving the next reader to wonder.
              hint="Customers and suppliers share one list in this system"
              error={errors.customerId?.message}
              {...register("customerId")}
            />
            <SelectField
              label="Company"
              required
              placeholder={companies.isLoading ? "Loading companies…" : "Choose a company"}
              options={companyOptions}
              hint="Decides the invoice number's prefix"
              error={errors.companyId?.message}
              {...register("companyId")}
            />
            <TextField
              label="Invoice date"
              type="date"
              error={errors.documentDate?.message}
              {...register("documentDate")}
            />
            <SelectField
              label="Site"
              placeholder={scope.isReady ? "No site" : "Loading sites…"}
              options={siteOptions}
              hint="Optional — the source allows an invoice with no site"
              error={errors.siteId?.message}
              {...register("siteId", {
                // The shipping address and contact belonged to the site chosen
                // before. Cleared on the person's change, not by watching — see
                // SiteAddressFields.
                onChange: () => {
                  setValue("shippingAddress", "");
                  setValue("contactName", "");
                  setValue("contactNumber", "");
                },
              })}
            />
            <TextField
              label="Their reference"
              hint="The customer's own order or invoice number, if they gave one"
              error={errors.customerInvoiceNo?.message}
              {...register("customerInvoiceNo")}
            />
            <SelectField
              label="Type"
              options={SALES_INVOICE_TYPES.map((value) => ({ value, label: value }))}
              hint="Returns and credit notes are money going the other way"
              error={errors.invoiceType?.message}
              {...register("invoiceType")}
            />

            {/*
              The number cannot be issued without the company's invoice prefix,
              and `invoice_prefix` is nullable. `CheckSalesInvoiceNo` dereferences
              it with no null check inside a catch that returns the error text as
              the number. Said here, before the save, rather than refused after.
            */}
            {chosenCompany && !chosenCompany.invoicePrefix?.trim() && (
              <Alert tone="warning" className="sm:col-span-2">
                {chosenCompany.name} has no invoice prefix, so its sales invoices cannot be
                numbered. Set one on the company before raising an invoice for it.
              </Alert>
            )}
          </FormSection>

          {/* `columns={1}` IS LOAD-BEARING — FormSection defaults to two. */}
          <FormSection icon={Boxes} title="Products" columns={1}>
            <InvoiceLineGrid
              fields={fields}
              lines={lines}
              totals={totals}
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
            />

            {/*
              THE CHARGES AND THE TOTAL BELONG WITH THE LINES (client request,
              21 Sep 2026), as one strip under the lines they are the sum of,
              rather than six bordered tiles in two sections of their own.
            */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start">
              <div className="grid gap-3 sm:grid-cols-2">
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
              </div>

              {/*
                THE WHOLE RECKONING IN ONE COLUMN: the strip, the GST it is made
                of, and the rounding rule that decides its last rupee — beside
                the two boxes that change them rather than stacked underneath.
              */}
              <div className="grid gap-2">
                <SummaryStrip
                  items={[
                    { label: "Sub total", value: formatMoney(totals.subtotal) },
                    { label: "Discount", value: formatMoney(totals.totalDiscount) },
                    { label: "Total GST", value: formatMoney(totals.totalGst) },
                    { label: "TDS", value: `− ${formatMoney(totals.tds)}` },
                    { label: "Adjustment", value: formatMoney(totals.roundOff) },
                    { label: "Total amount", value: formatMoney(totals.grandTotal), strong: true },
                  ]}
                />

                <GstBreakdown
                  lines={(lines ?? []).map((line, index) => ({
                    gstPercent: String(line?.gstPercent ?? "") || null,
                    netAmount: totals.lines[index]?.netAmount ?? "0",
                    gstAmount: totals.lines[index]?.gstAmount ?? "0",
                  }))}
                />

                {/* A footnote, not a banner: it explains the figure above it. */}
                <p className="text-xs leading-4 text-slate-500">
                  The total is rounded to a whole rupee, with exactly 50 paise rounding down — the
                  rule every invoice this business has issued was calculated with. The subtotal, GST
                  and discount above are exact.
                </p>
              </div>
            </div>
          </FormSection>

          {/*
            TWO TO A ROW AT 42/58 (client request, 21 Sep 2026): neither card
            fills a 1500px line on its own, and stacked they pushed the products
            — the part of the document people actually work in — below the fold.
            The split is uneven because delivery is short boxes and addresses are
            long lines that wrap. Under 1280px they stack, where half a line is
            too narrow for a labelled field.
          */}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,42fr)_minmax(0,58fr)]">
          <FormSection icon={Truck} title="Delivery and contacts" columns={3}>
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

          <FormSection icon={MapPin} title="Addresses and notes" columns={1}>
            {/*
              Billing is our site's own address; shipping is ONE of the site's
              addresses, chosen — the rules of 15 Sep 2026. A sales invoice
              carries no location. Both are copied onto the invoice as text.
            */}
            <SiteAddressFields
              siteId={chosenSiteId}
              shippingAddress={shippingAddress}
              onShippingChange={(address) =>
                setValue("shippingAddress", address, { shouldDirty: true })
              }
              shippingError={errors.shippingAddress?.message}
            />
            <TextAreaField
              label="Notes"
              rows={3}
              error={errors.description?.message}
              {...register("description")}
            />
          </FormSection>
          </div>

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

