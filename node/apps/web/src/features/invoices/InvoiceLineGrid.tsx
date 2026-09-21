import { useEffect, useRef, type ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { money, type InvoiceTotal } from "@accountmanagement/domain";
import {
  IconButton,
  SelectField,
  TextField,
} from "../../components/ui";
import { ItemCombobox } from "../items/ItemCombobox";
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

/**
 * A change event for a field this component only has `register` for.
 *
 * React Hook Form's `onChange` reads `target.name` and `target.value`, so an
 * object with those is a change as far as it is concerned. It lets the grid
 * clear a box it does not render at that moment without the caller handing
 * over `setValue` for it.
 */
const changeOf = (name: string, value: string) => ({ target: { name, value }, type: "change" });

/**
 * EVERY LINE IS ONE ROW (client request, 14 Sep 2026).
 *
 * Three things used to make a line taller than one control, and each has moved
 * into the row:
 *
 *  - The "…or type a name" box under the item dropdown is now the last option
 *    inside the picker itself. It was briefly a dropdown option that SWAPPED the
 *    cell for a text box; since `ItemCombobox` the box and the list are the same
 *    control, so there is nothing to swap.
 *  - The note saying where a filled-in price came from is an icon inside the
 *    Price box. Its full text is the icon's tooltip and accessible name.
 *  - The discount percent sits inside the Disc/unit box, on the right.
 *
 * New lines come from the + at the end of each row, which adds one directly
 * below that row. The separate Add product button under the grid is gone.
 */
export function InvoiceLineGrid({
  fields,
  lines,
  totals,
  unitOptions,
  register,
  lineError,
  onInsert,
  onRemove,
  onItemChosen,
  priceHint,
  footerNote,
}: {
  /** `useFieldArray`'s fields — only the key is used here. */
  fields: { id: string }[];
  /** The watched values, for the derived percent and the quantity footer. */
  lines: InvoiceLineValues[] | undefined;
  /** Already computed by the caller with `invoiceTotal.corrected()`. */
  totals: InvoiceTotal;
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
  /** Add an empty line directly after this one. */
  onInsert: (index: number) => void;
  onRemove: (index: number) => void;
  /**
   * An item was picked on that line. The caller clears the free-text name,
   * sets the quantity and fills the latest price — it owns `setValue`.
   */
  onItemChosen?: (index: number, itemId: string) => void;
  /** An icon inside the line's Price box: where a filled-in price came from. */
  priceHint?: (index: number) => ReactNode;
  footerNote?: ReactNode;
}) {
  /*
    GONE WITH THE COMBOBOX: a `typing` map keyed by the field array's id, saying
    which lines had been swapped from the dropdown to a text box. It was state
    ABOUT the form that had to be kept in step with the form — a line whose item
    was cleared, or one loaded with a saved typed name, had to be reasoned back
    into the right half. `ItemCombobox` derives the same thing from `itemId` and
    `itemName` directly, so there is nothing left to keep in step.
  */

  /**
   * The line a + just added, whose item dropdown takes the cursor once it has
   * rendered — so adding a line and choosing its item needs no extra click.
   * Done here rather than with `insert`'s `focusName`, which in a browser test
   * left the cursor on the + button: the rows after the new one re-register
   * under shifted names in the same render.
   */
  const focusLine = useRef<number | null>(null);
  useEffect(() => {
    if (focusLine.current === null) return;
    document.getElementById(`field-item-on-line-${focusLine.current + 1}`)?.focus();
    focusLine.current = null;
  }, [fields]);

  return (
    <>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-8 py-2 pr-2">#</th>
              <th className="py-2 pr-2">Product</th>
              <th className="w-20 py-2 pr-2">Qty</th>
              <th className="w-24 py-2 pr-2">Unit</th>
              <th className="w-28 py-2 pr-2">Price</th>
              <th className="w-28 py-2 pr-2">Disc/unit</th>
              <th className="w-20 py-2 pr-2">GST %</th>
              <th className="w-24 py-2 pr-2 text-right">GST</th>
              <th className="w-28 py-2 pr-2 text-right">Amount</th>
              <th className="w-20 py-2" />
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => {
              const line = lines?.[index];
              const itemField = `items.${index}.itemId`;
              const nameField = `items.${index}.itemName`;
              const percent = discountPercentOf(line);

              return (
                <tr key={field.id} className="border-b border-slate-100 align-top">
                  {/*
                    A 41px ROW (client request, 21 Sep 2026, from a mockup),
                    down from 53px. The control inside is 32px and fixed by
                    CONTROL_COMPACT; the row is what is left, so `py-1` is the
                    whole of the change. It matters because this is the one part
                    of the document that repeats — a ten-line invoice is 120px
                    shorter for it.

                    THE TEXT-ONLY CELLS ARE 6px TALLER on each side (`py-2.5`
                    against `py-1`), which is not an inconsistency: a 20px line
                    of text has to be padded to the height of a 32px box beside
                    it or the numbers sit above the values they belong to. The
                    two move together.
                  */}
                  <td className="py-2.5 pr-2 text-slate-400">{index + 1}</td>
                  {/*
                    ONE PICKER, replacing a dropdown, a "Not in the list" option,
                    a text box it swapped to and a button to swap back.

                    All of that machinery existed because the dropdown could only
                    offer 200 of the 758 items. `ItemCombobox` searches the
                    server, so the whole catalogue is reachable and the typed
                    name is simply the last option in the list — no swapping, and
                    no `typing` state to keep in step with what was saved.
                  */}
                  <td className="py-1 pr-2">
                    <ItemCombobox
                      id={`field-item-on-line-${index + 1}`}
                      label={`Item on line ${index + 1}`}
                      labelHidden
                      allowFreeText
                      itemId={String(line?.itemId ?? "")}
                      itemName={String(line?.itemName ?? "")}
                      error={lineError(index, "itemId") ?? lineError(index, "itemName")}
                      onPick={(pickedId) => {
                        void register(itemField).onChange(changeOf(itemField, pickedId));
                        void register(nameField).onChange(changeOf(nameField, ""));
                        // The caller owns `setValue`: it fills the unit and the
                        // latest price from the item that was chosen.
                        if (pickedId) onItemChosen?.(index, pickedId);
                      }}
                      onTypeName={(name) => {
                        void register(nameField).onChange(changeOf(nameField, name));
                        void register(itemField).onChange(changeOf(itemField, ""));
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <TextField
                      label={`Quantity on line ${index + 1}`}
                      labelHidden
                      inputMode="decimal"
                      error={lineError(index, "quantity")}
                      {...register(`items.${index}.quantity`)}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <SelectField
                      label={`Unit on line ${index + 1}`}
                      labelHidden
                      placeholder="Unit"
                      options={unitOptions}
                      error={lineError(index, "unitId")}
                      {...register(`items.${index}.unitId`)}
                    />
                  </td>
                  <td className="relative py-1 pr-2">
                    {/*
                      NEVER type="number" for money — it returns a float and this
                      system holds money as a decimal string end to end.
                    */}
                    <TextField
                      label={`Price on line ${index + 1}`}
                      labelHidden
                      inputMode="decimal"
                      style={{ paddingRight: "1.75rem" }}
                      error={lineError(index, "unitPrice")}
                      {...register(`items.${index}.unitPrice`)}
                    />
                    {/* Tracks the cell's own padding — see the row-height note. */}
                    <div className="absolute right-3.5 top-[0.7rem] flex">{priceHint?.(index)}</div>
                  </td>
                  <td className="relative py-1 pr-2">
                    <TextField
                      label={`Discount per unit on line ${index + 1}`}
                      labelHidden
                      inputMode="decimal"
                      style={{ paddingRight: percent ? "3.25rem" : undefined }}
                      error={lineError(index, "discountPerUnit")}
                      {...register(`items.${index}.discountPerUnit`)}
                    />
                    {percent && (
                      <span
                        className="tabular pointer-events-none absolute right-4 top-[0.8rem] text-[11px] text-slate-400"
                        title="The discount as a percent of the price"
                      >
                        {percent}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    <TextField
                      label={`GST percent on line ${index + 1}`}
                      labelHidden
                      inputMode="decimal"
                      error={lineError(index, "gstPercent")}
                      {...register(`items.${index}.gstPercent`)}
                    />
                  </td>
                  <td className="tabular py-2.5 pr-2 text-right text-slate-600">
                    {formatMoney(totals.lines[index]?.gstAmount ?? "0")}
                  </td>
                  <td className="tabular py-2.5 pr-2 text-right font-medium text-slate-900">
                    {formatMoney(totals.lines[index]?.total ?? "0")}
                  </td>
                  <td className="py-1">
                    <div className="flex justify-end gap-0.5">
                      <IconButton
                        label={`Add a line after line ${index + 1}`}
                        icon={Plus}
                        tone="operation"
                        size="sm"
                        onClick={() => {
                          focusLine.current = index + 1;
                          onInsert(index);
                        }}
                      />
                      <IconButton
                        label={`Remove line ${index + 1}`}
                        icon={Trash2}
                        tone="destructive"
                        size="sm"
                        onClick={() => onRemove(index)}
                        disabled={fields.length === 1}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
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
