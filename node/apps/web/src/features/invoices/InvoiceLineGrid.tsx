import type { ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { money, type InvoiceTotal } from "@accountmanagement/domain";
import { Button, SelectField, TextField } from "../../components/ui";
import { formatMoney, formatQuantity } from "../../lib/format";

/**
 * The line-item grid, shared by the purchase and sales invoice forms.
 *
 * `13-create-sales-invoice.md` is explicit about this: "One editor component,
 * two directions. Build it once, against the purchase invoice, and configure it
 * for sales. Building two is how the source ended up with `SalesRepo` and
 * `SupplierInvoiceRepo` sharing the same bugs in two places."
 *
 * The two screens differ in their HEADER panels — counterparty, whether the
 * number is issued or typed, the purchase-order link — and not at all in the
 * grid. So the grid is here and the panels stay in their own forms.
 *
 * WHAT LIVES HERE BECAUSE IT MUST NOT DIVERGE:
 *
 *  - `previewNumber`, the half-typed-decimal guard. `money.decimal` throws on
 *    "1000.", which a person types on the way to "1000.00".
 *  - The derived discount percent, shown read-only. The source offers rupees AND
 *    percent as two inputs whose handlers overwrite each other; one input and a
 *    derived label makes them unable to disagree.
 *  - The footer that sums the Amount column rather than showing the subtotal.
 *    That was wrong once and read as a grid that cannot add up its own column.
 */

/** One line as the form holds it — every value a string mid-typing. */
export interface InvoiceLineValues {
  itemId?: unknown;
  itemName?: unknown;
  unitId?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  discountPerUnit?: unknown;
  gstPercent?: unknown;
}

/** The fields the grid renders, for the error accessor below. */
export type InvoiceLineField =
  | "itemId"
  | "itemName"
  | "unitId"
  | "quantity"
  | "unitPrice"
  | "discountPerUnit"
  | "gstPercent";

/**
 * A half-typed number, made safe for the live total.
 *
 * `money.decimal` THROWS on anything that is not a plain decimal, and it is
 * right to: silently accepting "1,234.56" is how a locale-formatted string
 * becomes a wrong number. But a preview that throws on an intermediate keystroke
 * takes the whole form down mid-entry.
 *
 * So the intermediate states are normalised HERE, in the presentation layer,
 * rather than by weakening the domain. The value SUBMITTED is untouched — the
 * contract validates it strictly and the server computes the stored total.
 *
 * A LEADING MINUS SURVIVES, because the Adjustment box this also serves is
 * signed and negative is its common case. Found by a test that types character
 * by character; a browser check missed it because `fill()` sets the whole value
 * at once and never produces "1000.".
 */
export const previewNumber = (value: unknown): string => {
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

/**
 * The discount percent the typed rupee figure works out to.
 *
 * Read-only, and that is the point. A second INPUT is what makes doc 11's "which
 * one wins when both are set" question possible; a label cannot be typed into,
 * so the two cannot disagree.
 */
export const discountPercentOf = (line: InvoiceLineValues | undefined): string => {
  const price = Number(previewNumber(line?.unitPrice));
  const discount = Number(previewNumber(line?.discountPerUnit));
  if (!price || !discount) return "";
  return `${((discount / price) * 100).toFixed(2)}%`;
};

/** Quantity is not money, so summing it for a footer display is safe as a number. */
export const totalQuantityOf = (lines: InvoiceLineValues[] | undefined): string =>
  (lines ?? []).reduce((sum, line) => sum + Number(previewNumber(line?.quantity)), 0).toFixed(2);

export function InvoiceLineGrid({
  fields,
  lines,
  totals,
  itemChoices,
  unitOptions,
  register,
  lineError,
  onAdd,
  onRemove,
  onItemChosen,
  footerNote,
}: {
  /** `useFieldArray`'s fields — only the key is used here. */
  fields: { id: string }[];
  /** The watched values, for the derived percent and the quantity footer. */
  lines: InvoiceLineValues[] | undefined;
  /** Already computed by the caller with `invoiceTotal.corrected()`. */
  totals: InvoiceTotal;
  itemChoices: { value: string; label: string }[];
  unitOptions: { value: number; label: string }[];
  /**
   * `register("items.0.quantity")` from the caller's own form.
   *
   * Typed as a plain string path rather than generically over the form's shape:
   * both callers have the identical `items` array, and threading `Path<T>`
   * through would add casts at every call site to buy type-safety the two
   * concrete forms already have at their own boundaries.
   */
  register: (name: string) => UseFormRegisterReturn;
  /** The caller knows its own error type; the grid only needs the message. */
  lineError: (index: number, field: InvoiceLineField) => string | undefined;
  onAdd: () => void;
  onRemove: (index: number) => void;
  /** Clear that line's free-text name — the caller owns `setValue`. */
  onItemChosen?: (index: number) => void;
  footerNote?: ReactNode;
}) {
  return (
    <>
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
                    error={lineError(index, "itemId")}
                    {...register(`items.${index}.itemId`)}
                    onChange={(event) => {
                      void register(`items.${index}.itemId`).onChange(event);
                      // Choosing a catalogue item clears the free text. React
                      // Hook Form keeps an unmounted field's value, so without
                      // this a name typed before an item was picked would be
                      // submitted beside it and contradict the item the line
                      // actually references.
                      if (event.target.value) onItemChosen?.(index);
                    }}
                  />
                  {/*
                    THE FREE-TEXT NAME APPEARS ONLY WHEN NO ITEM IS CHOSEN,
                    which is the only time it does anything.

                    It used to sit under every row, so each line was two controls
                    tall whether it needed one or not — and this grid carries
                    eight columns, so that height is paid on the widest form in
                    the application.
                  */}
                  {!lines?.[index]?.itemId && (
                    <div className="mt-1">
                      <TextField
                        label={`Or name the product on line ${index + 1}`}
                        labelHidden
                        placeholder="…or type a name"
                        error={lineError(index, "itemName")}
                        {...register(`items.${index}.itemName`)}
                      />
                    </div>
                  )}
                </td>
                <td className="py-2 pr-2">
                  <TextField
                    label={`Quantity on line ${index + 1}`}
                    labelHidden
                    inputMode="decimal"
                    error={lineError(index, "quantity")}
                    {...register(`items.${index}.quantity`)}
                  />
                </td>
                <td className="py-2 pr-2">
                  <SelectField
                    label={`Unit on line ${index + 1}`}
                    labelHidden
                    placeholder="Unit"
                    options={unitOptions}
                    error={lineError(index, "unitId")}
                    {...register(`items.${index}.unitId`)}
                  />
                </td>
                <td className="py-2 pr-2">
                  {/*
                    NEVER type="number" for money — it returns a float and this
                    system holds money as a decimal string end to end.
                  */}
                  <TextField
                    label={`Price on line ${index + 1}`}
                    labelHidden
                    inputMode="decimal"
                    error={lineError(index, "unitPrice")}
                    {...register(`items.${index}.unitPrice`)}
                  />
                </td>
                <td className="py-2 pr-2">
                  <TextField
                    label={`Discount per unit on line ${index + 1}`}
                    labelHidden
                    inputMode="decimal"
                    error={lineError(index, "discountPerUnit")}
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
                    error={lineError(index, "gstPercent")}
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
                    // The last line is not removable: an invoice with no lines
                    // has no total and the contract refuses it, so the button
                    // would produce an error rather than a result.
                    disabled={fields.length === 1}
                    onClick={() => onRemove(index)}
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

                It showed `subtotal` at first, so a one-line invoice read Amount
                885.00 against a footer of 750.00 — a column footer that does not
                add up its own column, which is a support call every time. The
                subtotal has its own box in the Totals panel; it just is not the
                total of this column, which includes GST.
              */}
              <td className="tabular py-3 pr-2 text-right font-semibold text-slate-900">
                {formatMoney(amountColumnSum(totals))}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div>
        <Button variant="secondary" icon={Plus} onClick={onAdd}>
          Add product
        </Button>
      </div>

      {footerNote}
    </>
  );
}

/**
 * `subtotal + GST`, as decimal strings.
 *
 * Through `money`, NOT `Number` — this is the Amount column's total and the
 * whole point of the string representation is that money never becomes a float
 * on the way through. Adding the two roll-ups the calculator already produced,
 * rather than re-summing the line totals: same figure, less to go wrong.
 */
function amountColumnSum(totals: InvoiceTotal): string {
  return money.format(money.add(money.decimal(totals.subtotal), money.decimal(totals.totalGst)));
}
