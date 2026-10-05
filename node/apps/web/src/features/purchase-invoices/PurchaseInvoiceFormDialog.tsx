import clsx from "clsx";
import { Boxes, FileText, MapPin, Receipt, Truck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  Button,
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

import { useCompanyOptions, usePurchaseOrder, useSupplierOptions } from "../purchase-orders/api";
import {
  useCreatePurchaseInvoice,
  usePurchaseInvoice,
  usePurchaseOrderOptions,
  useUpdatePurchaseInvoice,
} from "./api";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { todayInput } from "../../lib/dates";
import { SavedDocumentPdfButton } from "../document-templates/DocumentActions";
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
    formState: { errors, isSubmitted, isDirty },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createPurchaseInvoiceSchema),
    defaultValues: EMPTY,
  });

  const { fields, insert, remove, replace } = useFieldArray({ control, name: "items" });

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

  /**
   * CHOOSING A PURCHASE ORDER BRINGS ITS PRODUCTS IN (client, 17 Sep 2026).
   *
   * An invoice raised against an order almost always bills that order's lines,
   * and retyping them is both slow and the place a quantity gets mistyped
   * against what was actually ordered.
   *
   * The ORDER'S OWN LINES ARE USED, fetched from its detail — the dropdown is
   * built from list rows, which carry a total but no products.
   *
   * WHAT IT WILL NOT DO IS OVERWRITE TYPED WORK. Someone who has already
   * entered lines and then links the order would otherwise lose them with no
   * warning and no undo, which is the one failure worth designing around here.
   * So the lines are replaced only when they are all still blank, or when they
   * came from an order chosen a moment ago; anything else offers a button
   * instead and leaves the decision to the person.
   *
   * NO DISCOUNT COMES ACROSS because a purchase order has no discount column —
   * see `purchase-order-total.ts`. The invoice's own Disc/unit stays blank and
   * editable.
   */
  const chosenOrderId = String(watch("purchaseOrderId") ?? "");
  const chosenOrder = usePurchaseOrder(open && chosenOrderId ? chosenOrderId : null);
  /** The order whose lines are in the grid, so re-picking it does not re-fill. */
  const linesFrom = useRef<string | null>(null);

  const orderLines = (chosenOrder.data?.items ?? []).map((line) => ({
    itemId: text(line.itemId),
    itemName: line.itemId === null ? line.itemLabel : "",
    itemDescription: text(line.itemDescription),
    unitId: line.unitId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPerUnit: "",
    gstPercent: text(line.gstPercent),
  }));

  const linesAreBlank = () =>
    (getValues("items") ?? []).every(
      (line) =>
        !String(line?.itemId ?? "").trim() &&
        !String(line?.itemName ?? "").trim() &&
        !String(line?.quantity ?? "").trim() &&
        !String(line?.unitPrice ?? "").trim(),
    );

  const loadOrderLines = () => {
    if (orderLines.length === 0) return;
    linesFrom.current = chosenOrderId;
    replace(orderLines);
  };

  /** True when the order's products are ready but would overwrite typed lines. */
  const [askToLoad, setAskToLoad] = useState(false);

  useEffect(() => {
    // Editing a saved invoice must never have its lines rewritten by the order
    // it references — only a choice made in this form fills anything.
    if (!open || chosenOrder.data === undefined) return;
    if (chosenOrder.data.id !== chosenOrderId) return;
    if (linesFrom.current === chosenOrderId) return;

    if (linesAreBlank() || linesFrom.current !== null) {
      setAskToLoad(false);
      loadOrderLines();
    } else {
      setAskToLoad(true);
    }
    // `loadOrderLines` and `linesAreBlank` read the form, which is not reactive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chosenOrderId, chosenOrder.data]);

  // Clearing the order leaves the lines alone — they may have been edited since
  // — but the grid is no longer "from" an order, so typed work is protected.
  useEffect(() => {
    if (!chosenOrderId) {
      linesFrom.current = null;
      setAskToLoad(false);
    }
  }, [chosenOrderId]);

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
      footerStart={
        invoiceId !== null ? <SavedDocumentPdfButton documentType="purchase-invoice" id={invoiceId} dirty={isDirty} /> : undefined
      }
      submitLabel={isEdit ? "Save changes" : "Add purchase invoice"}
      // Wider than the master dialogs, because the body is a data-entry grid.
      size="xl"
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading invoice…</p>
      ) : (
        <>
          <FormSection icon={Receipt} title="Invoice details" columns={2}>
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

            {/*
              THE ORDER BELONGS IN THIS CARD, not in one of its own (client
              request, 21 Sep 2026, from a mockup).

              It is one select and, occasionally, one offer — about a sixth of
              the content of a section, and as a card of its own it took a
              heading, an icon tile, a border and 16px of padding to say it.
              Inline in the tinted well it sits in the second row beside Site and
              Type, which is where the mockup puts it and where it reads as part
              of the invoice's own details rather than as a separate subject.

              `sm:col-span-2` is what makes it the right-hand half of that row:
              the card is four columns wide at this window size, so the row is
              Site, Type, and this across the remaining two.
            */}
            <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-3 sm:col-span-2">
              <div className="flex items-center gap-2">
                <FileText aria-hidden className="size-4 shrink-0 text-brand-600" />
                <h4 className="text-xs font-semibold leading-4 text-slate-800">
                  Against a purchase order
                </h4>
              </div>

              <div
                className={clsx(
                  "mt-2 grid gap-3",
                  // Side by side only once the offer is actually there, and only
                  // where there is room for both — otherwise the select would
                  // sit in half a well for no reason.
                  askToLoad && orderLines.length > 0 && "xl:grid-cols-2",
                )}
              >
                {/*
                  `SupplierInvoice.Poid` is an nvarchar holding the order's
                  NUMBER as text, matched by string equality — assessment 09
                  §7.5. Renaming or reissuing an order silently detaches its
                  invoices today. Here it is a real foreign key, chosen from a
                  list.
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
                  hint="Optional. Only orders raised on the chosen supplier are listed. Choosing one brings its products in."
                  error={errors.purchaseOrderId?.message}
                  {...register("purchaseOrderId")}
                />
                {/*
                  Only when the grid already holds typed lines. Replacing them is
                  offered rather than done, because there is no undo for it.
                */}
                {askToLoad && orderLines.length > 0 && (
                  <div className="rounded-md border border-brand-200 bg-white px-2.5 py-2">
                    <p className="text-xs leading-4 text-slate-700">
                      This order has {orderLines.length}{" "}
                      {orderLines.length === 1 ? "product" : "products"}. Loading them replaces
                      the lines you have entered.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        setAskToLoad(false);
                        loadOrderLines();
                      }}
                    >
                      Load the order&rsquo;s products
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </FormSection>

          {/*
            `columns={1}` IS LOAD-BEARING — FormSection defaults to two, and
            without it the grid is squeezed into half the dialog and the
            Add-product button sits beside it instead of below.
          */}
          <FormSection icon={Boxes} title="Products" columns={1} className="[&_input]:max-w-none! [&_select]:max-w-none! [&_textarea]:max-w-none!">
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
              THE CHARGES AND THE TOTAL BELONG WITH THE LINES, not in two
              sections of their own below (client request, 21 Sep 2026). TDS and
              the adjustment are the two figures that are typed rather than
              computed, so they sit to the left of the strip they change.
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
                of, and the rounding rule that decides its last rupee. They were
                three full-width blocks stacked down the card, which is three
                times the height for one answer and put the tax split further
                from the total than the total is from the lines.
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

                {/*
                  Said on the screen, because it is a real rule that surprises
                  people and because the alternative is someone reporting the
                  paise as a bug. A footnote rather than the blue banner it was:
                  it explains the figure above it, and a banner claims the
                  attention of something that has gone wrong.
                */}
                <p className="text-xs leading-4 text-slate-500">
                  The total is rounded to a whole rupee, with exactly 50 paise rounding down — the
                  rule every invoice this business has issued was calculated with. The subtotal, GST
                  and discount above are exact.
                </p>
              </div>
            </div>
          </FormSection>

          {/*
            THE LAST TWO CARDS SHARE A ROW, at 42/58 rather than in half (client
            request, 21 Sep 2026, from a mockup). Delivery is six short boxes —
            a challan number, a vehicle number — and addresses are long lines
            that wrap, so an even split leaves air on the left and wrapping on
            the right. Under 1280px they stack, where half a line is too narrow
            for a labelled field.
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

          <FormSection icon={MapPin} title="Location, addresses and notes" columns={1}>
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
          </div>
        </>
      )}
    </FormDialog>
  );
}

