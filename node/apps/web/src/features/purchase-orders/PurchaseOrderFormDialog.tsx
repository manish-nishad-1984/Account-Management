import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { createPurchaseOrderSchema, type PurchaseOrderDetail } from "@accountmanagement/contracts";
import { purchaseOrderTotal } from "@accountmanagement/domain";
import {
  Alert,
  Button,
  CheckboxField,
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
import {
  useCompanyOptions,
  useCreatePurchaseOrder,
  usePurchaseOrder,
  useSupplierOptions,
  useUpdatePurchaseOrder,
} from "./api";
import { useSiteScope } from "../../contexts/SiteScopeContext";

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
  siteGroupId: "",
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
  billingAddress: "",
  groupAddress: "",
  terms: "",
  description: "",
  items: [EMPTY_LINE],
};

const dateInput = (value: string | null): string => (value ? value.slice(0, 10) : "");

const toFormValues = (detail: PurchaseOrderDetail): FormValues => ({
  siteId: detail.siteId,
  supplierId: detail.supplierId,
  companyId: detail.companyId,
  siteGroupId: text(detail.siteGroupId),
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
  billingAddress: text(detail.billingAddress),
  groupAddress: text(detail.groupAddress),
  terms: text(detail.terms),
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
  const itemOptions = useItemOptions("");
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
    watch,
    control,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createPurchaseOrderSchema),
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
   * `watch("items")` re-runs this on every keystroke, which is what the legacy
   * screen does too — its `updateTotals` is bound to the change event of every
   * price, quantity and GST box.
   */
  const lines = watch("items");
  const totals = useMemo(
    () =>
      purchaseOrderTotal.compute(
        (lines ?? []).map((line) => ({
          unitPrice: String(line?.unitPrice ?? ""),
          quantity: String(line?.quantity ?? ""),
          gstPercent: String(line?.gstPercent ?? ""),
        })),
      ),
    [lines],
  );

  const onSubmit = handleSubmit(
    async (values) => {
      setFormError(null);
      try {
        if (isEdit) {
          await update.mutateAsync({ id: orderId, body: values });
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

  const items = itemOptions.data?.rows ?? [];
  const itemTotal = itemOptions.data?.total ?? 0;
  const itemsTruncated = itemTotal > items.length;
  const itemChoices = items.map((item) => ({ value: item.id, label: item.name }));

  const chosenCompanyId = watch("companyId");
  const chosenCompany = companyRows.find((row) => row.id === chosenCompanyId);
  const immediate = watch("deliveryImmediate");

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
      submitLabel={isEdit ? "Save changes" : "Add purchase order"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading order…</p>
      ) : (
        <>
          <FormSection title="Supplier" columns={2}>
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
          </FormSection>

          <FormSection title="Order" columns={2}>
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
              {...register("siteId")}
            />
            <TextField
              label="Order date"
              type="date"
              error={errors.documentDate?.message}
              {...register("documentDate")}
            />
            <TextAreaField
              label="Billing address"
              rows={2}
              error={errors.billingAddress?.message}
              {...register("billingAddress")}
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

          {/* ---------------------------------------------------------------- */}
          <FormSection title="Products">
            <div className="overflow-x-auto">
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
                          // The last line is not removable: an order with no
                          // lines has no total and the contract refuses it, so
                          // the button would produce an error rather than a
                          // result.
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

            <div className="mt-3">
              <Button variant="secondary" icon={Plus} onClick={() => append(EMPTY_LINE)}>
                Add product
              </Button>
            </div>

            {itemsTruncated && (
              <Alert tone="info" className="mt-3">
                Showing the first {items.length} of {itemTotal} items. If the one you need is not
                listed, type its name beside the dropdown — an order line can name a product that
                is not in the catalogue.
              </Alert>
            )}
          </FormSection>

          <FormSection title="Totals" columns={2}>
            <Summary label="Sub total" value={formatMoney(totals.subtotal)} />
            <Summary label="Total GST" value={formatMoney(totals.totalGst)} />
            <Summary label="Total amount" value={formatMoney(totals.grandTotal)} strong />
            <p className="text-xs text-slate-500 sm:col-span-2">
              Calculated on the server when this is saved, using the same function shown here. The
              old screen computed these in the browser and stored whatever was posted.
            </p>
          </FormSection>

          <FormSection title="Delivery and contacts" columns={2}>
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

          <FormSection title="Terms and conditions">
            <TextAreaField
              label="Terms"
              rows={6}
              hint="Plain text for now — see the note below"
              error={errors.terms?.message}
              {...register("terms")}
            />
            <TextAreaField
              label="Notes"
              rows={3}
              error={errors.description?.message}
              {...register("description")}
            />
            <Alert tone="info" className="mt-3">
              The old screen offered three saved templates in a rich text editor. This field is
              plain text until that editor and an HTML sanitiser are added — storing rich text
              without one would put scripts from a saved order onto everyone who opens it.
            </Alert>
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
