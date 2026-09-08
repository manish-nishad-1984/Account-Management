import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import {
  INVOICE_TYPES,
  createPurchaseInvoiceSchema,
  type PurchaseInvoiceDetail,
} from "@accountmanagement/contracts";
import { invoiceTotal, money } from "@accountmanagement/domain";
import {
  Alert,
  Button,
  FormDialog,
  FormSection,
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { formatMoney, formatQuantity } from "../../lib/format";
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
  siteGroupId: "",
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
  groupAddress: "",
  tds: "",
  roundOff: "",
  items: [EMPTY_LINE],
};

const dateInput = (value: string | null): string => (value ? value.slice(0, 10) : "");

/**
 * A half-typed number, made safe for the live total.
 *
 * `money.decimal` THROWS on anything that is not a plain decimal, and it is
 * right to: silently accepting "1,234.56" is how a locale-formatted string
 * becomes a wrong number. But a person typing "1000.00" passes through "1000."
 * on the way, and a preview that throws on an intermediate keystroke takes the
 * whole form down mid-entry.
 *
 * Shared behaviour with the purchase order form, where it was found by a test
 * that types character by character — a browser check missed it because `fill()`
 * sets the whole value at once and never produces "1000.".
 *
 * A LEADING MINUS IS KEPT, unlike the order form's copy. The Adjustment box is
 * signed and negative is its common case, so stripping it would preview the
 * wrong total for the ordinary entry.
 */
const previewNumber = (value: unknown): string => {
  const raw = String(value ?? "").trim();
  if (raw === "" || raw === "-") return "0";

  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const candidate = body.endsWith(".")
    ? body.slice(0, -1)
    : body.startsWith(".")
      ? `0${body}`
      : body;

  if (!/^\d+(\.\d+)?$/.test(candidate)) return "0";
  return negative ? `-${candidate}` : candidate;
};

const toFormValues = (detail: PurchaseInvoiceDetail): FormValues => ({
  supplierInvoiceNo: text(detail.supplierInvoiceNo) ?? "",
  invoiceType: (INVOICE_TYPES as readonly string[]).includes(detail.invoiceType)
    ? (detail.invoiceType as FormValues["invoiceType"])
    : "Purchase",
  siteId: text(detail.siteId),
  supplierId: detail.supplierId,
  companyId: detail.companyId,
  siteGroupId: text(detail.siteGroupId),
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
  groupAddress: text(detail.groupAddress),
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
    watch,
    control,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createPurchaseInvoiceSchema),
    defaultValues: EMPTY,
  });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });

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

  // The order dropdown is scoped to the chosen supplier — an invoice bills an
  // order the SAME supplier raised, and offering all of them invites exactly the
  // mismatch the legacy text match makes silently.
  const chosenSupplierId = watch("supplierId");
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
              {...register("siteId")}
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[58rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="w-8 py-2 pr-2">#</th>
                    <th className="py-2 pr-2">Product</th>
                    <th className="w-20 py-2 pr-2">Qty</th>
                    <th className="w-24 py-2 pr-2">Unit</th>
                    <th className="w-24 py-2 pr-2">Price</th>
                    <th className="w-24 py-2 pr-2">Disc/unit</th>
                    <th className="w-20 py-2 pr-2">GST %</th>
                    <th className="w-24 py-2 pr-2 text-right">GST</th>
                    <th className="w-28 py-2 pr-2 text-right">Amount</th>
                    <th className="w-10 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, index) => (
                    <tr key={field.id} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-2 text-slate-400">{index + 1}</td>
                      <td className="py-2 pr-2">
                        <SelectField
                          label={`Item on line ${index + 1}`}
                          labelHidden
                          placeholder="Choose an item"
                          options={itemChoices}
                          error={errors.items?.[index]?.itemId?.message}
                          {...register(`items.${index}.itemId`)}
                        />
                        <div className="mt-1">
                          <TextField
                            label={`Or name the product on line ${index + 1}`}
                            labelHidden
                            placeholder="…or type a name"
                            error={errors.items?.[index]?.itemName?.message}
                            {...register(`items.${index}.itemName`)}
                          />
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        <TextField
                          label={`Quantity on line ${index + 1}`}
                          labelHidden
                          inputMode="decimal"
                          error={errors.items?.[index]?.quantity?.message}
                          {...register(`items.${index}.quantity`)}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <SelectField
                          label={`Unit on line ${index + 1}`}
                          labelHidden
                          placeholder="Unit"
                          options={unitOptions}
                          error={errors.items?.[index]?.unitId?.message}
                          {...register(`items.${index}.unitId`)}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        {/*
                          NEVER type="number" for money — it returns a float and
                          this system holds money as a decimal string end to end.
                        */}
                        <TextField
                          label={`Price on line ${index + 1}`}
                          labelHidden
                          inputMode="decimal"
                          error={errors.items?.[index]?.unitPrice?.message}
                          {...register(`items.${index}.unitPrice`)}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        {/*
                          ONE DISCOUNT BOX, IN RUPEES PER UNIT — where the legacy
                          grid has two.

                          Its two handlers each overwrite the other
                          (`updateDiscount` writes the percent, and
                          `UpdateDiscountPercentage` writes the rupees), so they
                          are one number in two boxes and cannot independently
                          disagree. Doc 11 asks which is authoritative when both
                          are set; the answer is that the question cannot arise.
                          The percent is shown read-only beneath, derived.
                        */}
                        <TextField
                          label={`Discount per unit on line ${index + 1}`}
                          labelHidden
                          inputMode="decimal"
                          error={errors.items?.[index]?.discountPerUnit?.message}
                          {...register(`items.${index}.discountPerUnit`)}
                        />
                        <div className="tabular mt-1 text-right text-xs text-slate-400">
                          {discountPercentOf(lines?.[index])}
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        <TextField
                          label={`GST percent on line ${index + 1}`}
                          labelHidden
                          inputMode="decimal"
                          error={errors.items?.[index]?.gstPercent?.message}
                          {...register(`items.${index}.gstPercent`)}
                        />
                      </td>
                      <td className="tabular py-4 pr-2 text-right text-slate-600">
                        {formatMoney(totals.lines[index]?.gstAmount ?? "0")}
                      </td>
                      <td className="tabular py-4 pr-2 text-right font-medium text-slate-900">
                        {formatMoney(totals.lines[index]?.total ?? "0")}
                      </td>
                      <td className="py-3">
                        <Button
                          variant="ghost"
                          icon={Trash2}
                          title={`Remove line ${index + 1}`}
                          disabled={fields.length === 1}
                          onClick={() => remove(index)}
                        />
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
                      {formatQuantity(totalQuantityOf(lines))}
                    </td>
                    <td />
                    <td />
                    <td className="tabular py-3 pr-2 text-right text-slate-700">
                      {formatMoney(totals.totalDiscount)}
                    </td>
                    <td />
                    <td className="tabular py-3 pr-2 text-right text-slate-700">
                      {formatMoney(totals.totalGst)}
                    </td>
                    {/*
                      THE SUM OF THE AMOUNT COLUMN, not the subtotal.

                      It showed `subtotal` at first, so a one-line invoice read
                      Amount 885.00 against a footer of 750.00 — a column footer
                      that does not add up its own column, which is a support
                      call every time. The subtotal is a real number and it has
                      its own box in the Totals panel below; it just is not the
                      total of this column, which includes GST.
                    */}
                    <td className="tabular py-3 pr-2 text-right font-semibold text-slate-900">
                      {formatMoney(lineTotalSum(totals))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div>
              <Button variant="secondary" icon={Plus} onClick={() => append(EMPTY_LINE)}>
                Add product
              </Button>
            </div>

            {itemsTruncated && (
              <Alert tone="info">
                Showing the first {items.length} of {itemTotal} items. If the one you need is not
                listed, type its name beside the dropdown — an invoice line can name a product that
                is not in the catalogue.
              </Alert>
            )}
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
            <TextField
              label="Contact person"
              error={errors.contactName?.message}
              {...register("contactName")}
            />
            <TextField
              label="Contact number"
              error={errors.contactNumber?.message}
              {...register("contactNumber")}
            />
            <TextField
              label="Payment terms"
              error={errors.paymentTerms?.message}
              {...register("paymentTerms")}
            />
          </FormSection>

          <FormSection title="Addresses and notes" columns={1}>
            <TextAreaField
              label="Shipping address"
              rows={2}
              error={errors.shippingAddress?.message}
              {...register("shippingAddress")}
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

/**
 * The discount percent the typed rupee figure works out to.
 *
 * Shown read-only beside the box rather than offered as a second input, because
 * a second input is what makes doc 11's "which one wins" question possible at
 * all. Nothing here can be typed into, so nothing can disagree.
 */
function discountPercentOf(line: { unitPrice?: unknown; discountPerUnit?: unknown } | undefined) {
  const price = Number(previewNumber(line?.unitPrice));
  const discount = Number(previewNumber(line?.discountPerUnit));
  if (!price || !discount) return "";
  return `${((discount / price) * 100).toFixed(2)}%`;
}

/**
 * The sum of the Amount column — `subtotal + GST`, in decimals.
 *
 * Added with `money`, not with `Number`, because this is money and the whole
 * point of the string representation is that it never becomes a float. Summing
 * the line totals directly would work too; adding the two roll-ups the
 * calculator already produced is the same figure with less to go wrong.
 */
function lineTotalSum(totals: { subtotal: string; totalGst: string }): string {
  return money.format(money.add(money.decimal(totals.subtotal), money.decimal(totals.totalGst)));
}

/** Quantity is not money, so summing it for a footer display is safe as a number. */
function totalQuantityOf(lines: { quantity?: unknown }[] | undefined) {
  const total = (lines ?? []).reduce((sum, line) => sum + Number(previewNumber(line?.quantity)), 0);
  return total.toFixed(2);
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
