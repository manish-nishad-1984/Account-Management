import { useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  Boxes,
  Building2,
  FileBadge,
  MapPin,
  Phone,
  Plus,
  ScrollText,
  ShoppingCart,
  Trash2,
  Truck,
} from "lucide-react";
import {
  createPurchaseOrderSchema,
  type PurchaseOrderDetail,
  type SupplierRow,
} from "@accountmanagement/contracts";
import { purchaseOrderTotal } from "@accountmanagement/domain";
import {
  Alert,
  Button,
  CheckboxField,
  FormDialog,
  FormSection,
  IconButton,
  SelectField,
  TextAreaField,
  TextField,
  SummaryStrip,
} from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { formatMoney, formatQuantity } from "../../lib/format";
import { useAllUnits } from "../items/api";
import { ItemCombobox } from "../items/ItemCombobox";
import {
  useCompanyOptions,
  useCreatePurchaseOrder,
  usePurchaseOrder,
  useSupplierOptions,
  useUpdatePurchaseOrder,
} from "./api";
import { SiteAddressFields } from "../sites/SiteAddressFields";
import { SiteContactSelect } from "../sites/SiteContactSelect";
import { GstBreakdown } from "../invoices/GstBreakdown";
import { useLatestPriceFill } from "../invoices/useLatestPriceFill";
import { TermsField } from "./TermsField";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { todayInput } from "../../lib/dates";
import { SavedDocumentPdfButton } from "../document-templates/DocumentActions";

/**
 * The purchase order form.
 *
 * TWO THINGS ARE NOT IN IT, both deliberately.
 *
 * 1. THE ORDER NUMBER. The .NET screen calls `CheckPONo` when the form opens,
 *    shows the number in a disabled box and posts it back on save — so the
 *    number is reserved by opening a form and confirmed only by submitting one.
 *    Here the server issues it inside the insert's transaction, per company, and
 *    the form learns it from the response.
 *
 * 2. THE TOTALS AS INPUTS. They are shown, and they are computed — by the SAME
 *    function the server uses, `purchaseOrderTotal.compute` from the domain
 *    package. The browser and the server cannot disagree about an order's value
 *    because there is one implementation, and the server's answer is the one
 *    stored. The source has three implementations and stores whatever arrives.
 */
type FormValues = z.input<typeof createPurchaseOrderSchema>;
type Submitted = z.output<typeof createPurchaseOrderSchema>;

const EMPTY_LINE = {
  itemId: "",
  itemName: "",
  itemDescription: "",
  unitId: "" as unknown as number,
  quantity: "",
  unitPrice: "",
  gstPercent: "",
  discount: "",
};

const EMPTY: FormValues = {
  siteId: "",
  supplierId: "",
  companyId: "",
  siteLocationId: "",
  documentDate: "",
  deliveryDate: "",
  deliveryImmediate: false,
  buyersPurchaseNo: "",
  contactName: "",
  contactNumber: "",
  otherContactName: "",
  otherContactNumber: "",
  dispatchBy: "",
  paymentTerms: "",
  shippingAddress: "",
  terms: "",
  termsTemplate: null,
  description: "",
  items: [EMPTY_LINE],
  // No `deliveryAddresses`: the form does not send the old quantity split, so an
  // update leaves an old order's rows alone unless someone clears them.
};

const dateInput = (value: string | null): string => (value ? value.slice(0, 10) : "");

/**
 * A half-typed number, made safe for the live total.
 *
 * `money.decimal` THROWS on anything that is not a plain decimal, and it is right
 * to: silently accepting "1,234.56" is how a locale-formatted string becomes a
 * wrong number. But a person typing "1000.00" passes through **"1000."** on the
 * way, and a preview that throws on an intermediate keystroke takes the whole
 * form down mid-entry.
 *
 * So the intermediate states are normalised HERE, in the presentation layer,
 * rather than by weakening the domain: a trailing point is dropped, a leading
 * point gains its zero, and anything still unparseable previews as zero. The
 * value that is SUBMITTED is untouched — the contract validates it strictly and
 * the server computes the stored total from it.
 *
 * Found by a test that types character by character. The browser check missed it
 * because `fill()` sets the whole value at once and never produces "1000.".
 */
const previewNumber = (value: unknown): string => {
  const text = String(value ?? "").trim();
  if (text === "") return "0";

  const candidate = text.endsWith(".")
    ? text.slice(0, -1)
    : text.startsWith(".")
      ? `0${text}`
      : text;

  return /^-?\d+(\.\d+)?$/.test(candidate) ? candidate : "0";
};

const toFormValues = (detail: PurchaseOrderDetail): FormValues => ({
  siteId: detail.siteId,
  supplierId: detail.supplierId,
  companyId: detail.companyId,
  siteLocationId: text(detail.siteLocationId),
  documentDate: dateInput(detail.documentDate),
  deliveryDate: dateInput(detail.deliveryDate),
  deliveryImmediate: detail.deliveryImmediate,
  buyersPurchaseNo: text(detail.buyersPurchaseNo),
  contactName: text(detail.contactName),
  contactNumber: text(detail.contactNumber),
  otherContactName: text(detail.otherContactName),
  otherContactNumber: text(detail.otherContactNumber),
  dispatchBy: text(detail.dispatchBy),
  paymentTerms: text(detail.paymentTerms),
  shippingAddress: text(detail.shippingAddress),
  terms: text(detail.terms),
  termsTemplate: detail.termsTemplate,
  description: text(detail.description),
  items: detail.items.map((line) => ({
    itemId: text(line.itemId),
    itemName: line.itemId === null ? line.itemLabel : "",
    itemDescription: text(line.itemDescription),
    unitId: line.unitId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    gstPercent: text(line.gstPercent),
    discount: "",
  })),
});

export function PurchaseOrderFormDialog({
  open,
  orderId,
  onClose,
}: {
  open: boolean;
  orderId: string | null;
  onClose: () => void;
}) {
  const isEdit = orderId !== null;
  const detail = usePurchaseOrder(open && isEdit ? orderId : null);

  const scope = useSiteScope();
  const units = useAllUnits();
  const suppliers = useSupplierOptions();
  const companies = useCompanyOptions();
  const create = useCreatePurchaseOrder();
  const update = useUpdatePurchaseOrder();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    control,
    getValues,
    formState: { errors, isSubmitted, isDirty },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createPurchaseOrderSchema),
    defaultValues: EMPTY,
  });

  const { fields, insert, remove } = useFieldArray({ control, name: "items" });

  /**
   * Which line the cursor belongs in after `+`, or null.
   *
   * Set before the insert and consumed by the effect below, because the row does
   * not exist to focus until React has rendered it. The same mechanism the
   * invoice grid uses.
   */
  const focusLine = useRef<number | null>(null);
  useEffect(() => {
    if (focusLine.current === null) return;
    document.getElementById(`field-item-on-line-${focusLine.current + 1}`)?.focus();
    focusLine.current = null;
  }, [fields]);

  /** Set when someone clears an old order's quantity split; sent as an empty list. */
  const [clearSplit, setClearSplit] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setClearSplit(false);
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
   * Recomputed on every keystroke, which is what the legacy screen does too —
   * its `updateTotals` is bound to the change event of every price, quantity and
   * GST box.
   *
   * `useWatch`, NOT `watch("items")`. The first version used `watch` and the
   * totals never moved off 0.00: with a `useFieldArray` the values come back
   * without the per-keystroke re-render, so `totals.lines` stayed empty and every
   * computed cell fell through to its `?? "0"` fallback. That reads as "the
   * arithmetic is broken" when the arithmetic was never called.
   *
   * Caught in a browser, not by a test: the unit tests cover the calculator
   * directly and the page tests never type into the grid, so both were green
   * while the screen showed zeros. The regression test below it now types.
   */
  const lines = useWatch({ control, name: "items" });

  /**
   * CHOOSING AN ITEM FILLS ITS LATEST PRICE, UNIT AND GST, and the picker below
   * sets a blank quantity to 1 (client request, 17 Sep 2026).
   *
   * The same hook the two invoice forms use, so a purchase order and the invoice
   * raised against it agree on what "the latest price" means rather than having
   * two implementations that can drift apart.
   *
   * `direction: "in"` — a purchase order BUYS, so the price to offer is the one
   * last paid to a supplier, not the one last charged to a customer. Sales
   * invoices pass "out". Backwards, this would quote a selling price to a
   * supplier.
   *
   * NOTHING IS FILLED FOR DISCOUNT, because a purchase order has no discount
   * column — see `purchase-order-total.ts` for why that is deliberate.
   */
  const latestPrice = useLatestPriceFill({
    direction: "in",
    currentItemId: (index) => getValues(`items.${index}.itemId`),
    fill: (index, price) => {
      const options = { shouldDirty: true, shouldValidate: isSubmitted };
      setValue(`items.${index}.unitPrice`, price.unitPrice, options);
      setValue(`items.${index}.unitId`, price.unitId, options);
      setValue(`items.${index}.gstPercent`, price.gstPercent ?? "", options);
    },
  });
  const totals = useMemo(
    () =>
      purchaseOrderTotal.compute(
        (lines ?? []).map((line) => ({
          unitPrice: previewNumber(line?.unitPrice),
          quantity: previewNumber(line?.quantity),
          gstPercent: previewNumber(line?.gstPercent),
        })),
      ),
    [lines],
  );

  const onSubmit = handleSubmit(
    async (values) => {
      setFormError(null);
      try {
        if (isEdit) {
          /**
           * `deliveryAddresses` IS TAKEN OUT, not just left unset. The resolver
           * parses with the CREATE schema, whose default turns a missing list
           * into `[]` — so sending `values` as they come would clear every old
           * order's quantity split on its first save after 15 Sep 2026, silently.
           * Found by a test asserting what the form posts.
           */
          const { deliveryAddresses: _defaulted, ...rest } = values;
          const body = clearSplit ? { ...rest, deliveryAddresses: [] } : rest;
          await update.mutateAsync({ id: orderId, body });
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
  const companyRows = companies.data?.rows ?? [];
  const companyOptions = companyRows.map((row) => ({ value: row.id, label: row.name }));

  /*
    The item list is no longer loaded here. `ItemCombobox` runs its own search
    per picker, keyed by the term, so every unsearched picker shares one request
    and a search only fetches what was typed. What went with it: `itemsTruncated`
    and the Alert that admitted the dropdown was showing 200 of 758 items — the
    limitation it warned about no longer exists.
  */

  const chosenCompanyId = watch("companyId");
  const chosenCompany = companyRows.find((row) => row.id === chosenCompanyId);
  const immediate = watch("deliveryImmediate");

  /**
   * WHO IS BEING ORDERED FROM, shown the moment the supplier is chosen (client
   * request, 21 Sep 2026): their mobile number, address and GST number, so the
   * person raising the order can check they have the right one without leaving
   * this screen for Suppliers.
   *
   * Read off the row already loaded for the dropdown — `useSupplierOptions`
   * fetches every supplier's mobile, GST number, area and pincode for exactly
   * this list, so choosing one costs no second request. `area` and `pincode`
   * are what the LIST row carries; the building name is on the detail payload
   * only, fetched one supplier at a time, and not worth a second round trip for
   * a box whose job is a quick check rather than the full postal address.
   */
  const chosenSupplierId = watch("supplierId");
  const chosenSupplier = (suppliers.data?.rows ?? []).find((row) => row.id === chosenSupplierId);

  /**
   * The site, location, shipping address and terms editor.
   *
   * `useWatch`, not `watch`, for every one of them — the same lesson the totals
   * cost a browser session to learn. `watch` does not re-render reliably for a
   * value that is written with `setValue` rather than by a registered input, so
   * a chosen address or a loaded template would update the form state and not
   * the screen: the click would appear to do nothing at all.
   */
  const chosenSiteId = useWatch({ control, name: "siteId" });
  const chosenLocationId = useWatch({ control, name: "siteLocationId" });
  const shippingAddress = useWatch({ control, name: "shippingAddress" });
  const contactName = useWatch({ control, name: "contactName" });
  const contactNumber = useWatch({ control, name: "contactNumber" });
  const terms = useWatch({ control, name: "terms" }) ?? "";
  const termsTemplate = useWatch({ control, name: "termsTemplate" }) ?? null;

  const oldSplit = isEdit && !clearSplit ? (detail.data?.deliveryAddresses ?? []) : [];

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit purchase order" : "New purchase order"}
      description={
        isEdit
          ? `Order ${detail.data?.poNo ?? ""}`
          : "The order number is issued when this is saved"
      }
      formError={formError}
      pending={pending}
      footerStart={
        orderId !== null ? <SavedDocumentPdfButton documentType="purchase-order" id={orderId} dirty={isDirty} /> : undefined
      }
      submitLabel={isEdit ? "Save changes" : "Add purchase order"}
      // Wider than every other form dialog, because this one's body is a grid.
      size="xl"
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading order…</p>
      ) : (
        <>
          {/*
            TWO TO A ROW (client request, 21 Sep 2026): neither card fills a
            1500px line on its own, and stacked they pushed the products — the
            part of the document people actually work in — below the fold. Under
            1280px they stack, where half a line is too narrow for a labelled
            field.
          */}
          <div className="grid gap-4 xl:grid-cols-2">
          <FormSection icon={Building2} title="Supplier" columns={2}>
            <SelectField
              label="Supplier"
              required
              autoFocus
              placeholder={suppliers.isLoading ? "Loading suppliers…" : "Choose a supplier"}
              options={supplierOptions}
              error={errors.supplierId?.message}
              {...register("supplierId")}
            />
            <TextField
              label="Buyer's purchase number"
              hint="Your own reference, if there is one"
              error={errors.buyersPurchaseNo?.message}
              {...register("buyersPurchaseNo")}
            />
            {chosenSupplier && <SupplierSummary supplier={chosenSupplier} />}
          </FormSection>

          <FormSection icon={ShoppingCart} title="Order" columns={2}>
            <SelectField
              label="Company"
              required
              placeholder={companies.isLoading ? "Loading companies…" : "Choose a company"}
              options={companyOptions}
              hint="Decides the order number's prefix"
              error={errors.companyId?.message}
              {...register("companyId")}
            />
            <SelectField
              label="Site"
              required
              placeholder={scope.isReady ? "Choose a site" : "Loading sites…"}
              options={siteOptions}
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
            <TextField
              label="Order date"
              type="date"
              error={errors.documentDate?.message}
              {...register("documentDate")}
            />

            {/*
              The number cannot be issued without the company's invoice prefix,
              and `invoice_prefix` is nullable. The source dereferences it with no
              null check and its catch turns the resulting exception into the
              STRING "Error generating Purchase Order number.", which is then
              stored as the number. Said here, before the save, rather than
              refused after it.
            */}
            {chosenCompany && !chosenCompany.invoicePrefix?.trim() && (
              <Alert tone="warning" className="sm:col-span-2">
                {chosenCompany.name} has no invoice prefix, so its purchase orders cannot be
                numbered. Set one on the company before raising an order for it.
              </Alert>
            )}
          </FormSection>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/*
            `columns={1}` IS LOAD-BEARING. FormSection defaults to TWO, so
            without it the grid and the Add-product button below it become two
            cells of a two-column layout, side by side — the table is squeezed
            into half the dialog and cut off after the Unit column, and the
            button sits in the space where the price and GST boxes should be.
          */}
          <FormSection icon={Boxes} title="Products" columns={1}>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="w-8 py-2 pr-2">#</th>
                    <th className="py-2 pr-2">Product</th>
                    <th className="w-24 py-2 pr-2">Qty</th>
                    <th className="w-28 py-2 pr-2">Unit</th>
                    <th className="w-28 py-2 pr-2">Price</th>
                    <th className="w-20 py-2 pr-2">GST %</th>
                    <th className="w-28 py-2 pr-2 text-right">GST</th>
                    <th className="w-32 py-2 pr-2 text-right">Amount</th>
                    <th className="w-10 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, index) => (
                    <tr key={field.id} className="border-b border-slate-100 align-top">
                      <td className="py-2.5 pr-2 text-slate-400">{index + 1}</td>
                      {/*
                        ONE CONTROL, ONE LINE.

                        This cell was a dropdown with a second text box under it
                        whenever no item was chosen — which is most of the time
                        on a new order — so every line was two controls tall and
                        three lines took the height of six. The box existed
                        because the dropdown could only offer 200 of 758 items;
                        `ItemCombobox` searches the server, so the whole
                        catalogue is reachable and the typed name moved inside
                        the list as its last option. See that file.
                      */}
                      <td className="py-1 pr-2">
                        <ItemCombobox
                          id={`field-item-on-line-${index + 1}`}
                          label={`Item on line ${index + 1}`}
                          labelHidden
                          allowFreeText
                          // `String(...)`: `useWatch` widens a field of the form's
                          // INPUT type, which zod's coercion leaves as `{}` here.
                          // The old code only ever asked whether it was truthy.
                          itemId={String(lines?.[index]?.itemId ?? "")}
                          itemName={String(lines?.[index]?.itemName ?? "")}
                          error={
                            errors.items?.[index]?.itemId?.message ??
                            errors.items?.[index]?.itemName?.message
                          }
                          onPick={(pickedId) => {
                            setValue(`items.${index}.itemId`, pickedId, { shouldDirty: true });
                            // Choosing a catalogue item CLEARS the free text.
                            // React Hook Form keeps the value of a field that is
                            // no longer shown, so without this a name typed
                            // before an item was picked would be submitted
                            // alongside it and sit in `item_name` forever,
                            // contradicting the item the line references.
                            setValue(`items.${index}.itemName`, "", { shouldDirty: true });
                            // A blank quantity becomes 1; one already typed is
                            // left alone, because the person meant it.
                            if (!String(getValues(`items.${index}.quantity`) ?? "").trim()) {
                              setValue(`items.${index}.quantity`, "1", { shouldDirty: true });
                            }
                            if (pickedId) latestPrice.onItemChosen(index, pickedId);
                          }}
                          onTypeName={(name) => {
                            setValue(`items.${index}.itemName`, name, { shouldDirty: true });
                            setValue(`items.${index}.itemId`, "", { shouldDirty: true });
                          }}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <TextField
                          label={`Quantity on line ${index + 1}`}
                          labelHidden
                          inputMode="decimal"
                          error={errors.items?.[index]?.quantity?.message}
                          {...register(`items.${index}.quantity`)}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <SelectField
                          label={`Unit on line ${index + 1}`}
                          labelHidden
                          placeholder="Unit"
                          options={unitOptions}
                          error={errors.items?.[index]?.unitId?.message}
                          {...register(`items.${index}.unitId`)}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        {/*
                          NEVER type="number" for money — it returns a float and
                          this system holds money as a decimal string end to end.
                        */}
                        <div className="relative">
                          <TextField
                            label={`Price on line ${index + 1}`}
                            labelHidden
                            inputMode="decimal"
                            error={errors.items?.[index]?.unitPrice?.message}
                            {...register(`items.${index}.unitPrice`)}
                          />
                          {/* Where the filled price came from, as on the invoices. */}
                          <div className="absolute right-3.5 top-[0.95rem] flex">
                            {latestPrice.hintFor(lines?.[index]?.itemId)}
                          </div>
                        </div>
                      </td>
                      <td className="py-1 pr-2">
                        <TextField
                          label={`GST percent on line ${index + 1}`}
                          labelHidden
                          inputMode="decimal"
                          error={errors.items?.[index]?.gstPercent?.message}
                          {...register(`items.${index}.gstPercent`)}
                        />
                      </td>
                      <td className="tabular py-2.5 pr-2 text-right text-slate-600">
                        {formatMoney(totals.lines[index]?.gstAmount ?? "0")}
                      </td>
                      <td className="tabular py-2.5 pr-2 text-right font-medium text-slate-900">
                        {formatMoney(totals.lines[index]?.total ?? "0")}
                      </td>
                      {/*
                        ADD AND REMOVE ON THE LINE ITSELF, which is how the
                        invoice grid already worked. The Add button was a block
                        under the table, so adding a line meant leaving the row,
                        and a new line always went to the END however far up the
                        order you were working. `+` inserts after THIS line and
                        puts the cursor in it.
                      */}
                      <td className="py-1">
                        <div className="flex justify-end gap-0.5">
                          <IconButton
                            label={`Add a line after line ${index + 1}`}
                            icon={Plus}
                            tone="operation"
                            size="sm"
                            onClick={() => {
                              focusLine.current = index + 1;
                              insert(index + 1, EMPTY_LINE);
                            }}
                          />
                          <IconButton
                            label={`Remove line ${index + 1}`}
                            icon={Trash2}
                            tone="destructive"
                            size="sm"
                            onClick={() => remove(index)}
                            disabled={fields.length === 1}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-sm">
                    <td colSpan={2} className="py-3 text-slate-500">
                      {fields.length} {fields.length === 1 ? "line" : "lines"}
                    </td>
                    <td className="tabular py-3 pr-2 text-slate-700">
                      {formatQuantity(totals.totalQuantity)}
                    </td>
                    <td colSpan={3} />
                    <td className="tabular py-3 pr-2 text-right text-slate-700">
                      {formatMoney(totals.totalGst)}
                    </td>
                    <td className="tabular py-3 pr-2 text-right font-semibold text-slate-900">
                      {formatMoney(totals.grandTotal)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/*
              THE TOTAL BELONGS WITH THE LINES (client request, 21 Sep 2026), as
              one strip under the lines it is the sum of, rather than three
              bordered tiles in a section of its own.
            */}
            {/* The strip, the GST it is made of, and where the figures come from. */}
            <div className="grid gap-2">
              <SummaryStrip
                items={[
                  { label: "Sub total", value: formatMoney(totals.subtotal) },
                  { label: "Total GST", value: formatMoney(totals.totalGst) },
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
              <p className="text-xs leading-4 text-slate-500">
                Calculated on the server when this is saved, using the same function shown here. The
                old screen computed these in the browser and stored whatever was posted.
              </p>
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
            <CheckboxField
              label="Deliver immediately"
              hint="The legacy form's Immediate option"
              error={errors.deliveryImmediate?.message}
              {...register("deliveryImmediate")}
            />
            <TextField
              label="Delivery date"
              type="date"
              // Not disabled — a date typed and then switched to Immediate is
              // still worth keeping until the user says otherwise. The server
              // stores both and the two are independent by design.
              hint={immediate ? "Ignored while Immediate is ticked" : "When it is needed"}
              error={errors.deliveryDate?.message}
              {...register("deliveryDate")}
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
            {/* The legacy label reads "Other ContectNo". The column is spelled
                correctly and so is this. */}
            <TextField
              label="Other contact person"
              error={errors.otherContactName?.message}
              {...register("otherContactName")}
            />
            <TextField
              label="Other contact number"
              error={errors.otherContactNumber?.message}
              {...register("otherContactNumber")}
            />
            <TextField
              label="Dispatch by"
              error={errors.dispatchBy?.message}
              {...register("dispatchBy")}
            />
            <TextField
              label="Payment terms"
              error={errors.paymentTerms?.message}
              {...register("paymentTerms")}
            />
          </FormSection>

          {/*
            ONE SHIPPING ADDRESS, and the billing address that is always the
            site's own — the rules of 15 Sep 2026, which replaced the legacy
            panels that split the order's quantity across several addresses.
          */}
          <FormSection icon={MapPin} title="Location and addresses" columns={1}>
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

            {/*
              An order raised before the change may carry the old split. It is
              shown, not edited, and can be cleared — which it may need to be: the
              server still refuses a save whose split adds up to more than the
              order, so reducing a quantity on such an order needs this.
            */}
            {oldSplit.length > 0 && (
              <Alert tone="info">
                <div className="font-medium">Delivery split from the old screen</div>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {oldSplit.map((row) => (
                    <li key={row.id}>
                      <span className="tabular">{formatQuantity(row.quantity)}</span> to {row.address}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="secondary"
                  className="mt-2"
                  onClick={() => setClearSplit(true)}
                >
                  Remove the old split when saving
                </Button>
              </Alert>
            )}
          </FormSection>
          </div>

          <FormSection icon={ScrollText} title="Terms and conditions" columns={1}>
            <TermsField
              value={terms}
              template={termsTemplate}
              error={errors.terms?.message}
              onChange={(next) => {
                setValue("terms", next.terms, { shouldValidate: false });
                setValue("termsTemplate", next.termsTemplate, { shouldValidate: false });
              }}
            />
            <TextAreaField
              label="Notes"
              rows={2}
              error={errors.description?.message}
              {...register("description")}
            />
          </FormSection>

          {!isEdit && (
            <Alert tone="info">
              A new order is created unapproved and active. Approving it is a separate action and
              needs the approve right.
            </Alert>
          )}
        </>
      )}
    </FormDialog>
  );
}

/**
 * The chosen supplier's mobile, address and GST number, so the person raising
 * the order can check they have the right supplier without a trip to Suppliers.
 *
 * Any of the three can be missing on a real record — a supplier is not required
 * to carry a mobile number or a GST number — and each is shown only when there
 * is something to show, rather than as a row reading "Mobile: —".
 */
function SupplierSummary({ supplier }: { supplier: SupplierRow }) {
  const address = [supplier.area, supplier.pincode].filter(Boolean).join(", ");
  const facts = [
    { icon: Phone, label: "Mobile", value: supplier.mobile },
    { icon: MapPin, label: "Address", value: address || null },
    { icon: FileBadge, label: "GST number", value: supplier.gstNo },
  ].filter((fact) => fact.value);

  if (facts.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 sm:col-span-2">
      {facts.map((fact) => (
        <div key={fact.label} className="flex items-start gap-1.5 text-xs">
          <fact.icon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
          <span>
            <span className="sr-only">{fact.label}: </span>
            <span className="text-slate-700">{fact.value}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

