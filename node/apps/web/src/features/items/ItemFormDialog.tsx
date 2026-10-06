import { Package, Percent } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  createItemSchema,
  duplicateItemNameMessage,
  normalizeItemName,
  type ItemDetail,
} from "@accountmanagement/contracts";
import {
  Alert,
  FormDialog,
  FormSection,
  SelectField,
  TextField,
} from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { useAllUnits, useCreateItem, useItem, useItemNameCheck, useItemOptions, useUpdateItem } from "./api";

/**
 * The item form.
 *
 * THE GST FIGURES ARE NOT CALCULATED HERE, and that is the most important thing
 * about this screen.
 *
 * `gstAmount` is derivable from `pricePerUnit` and `gstPercent`, so the obvious
 * move is to compute it as the user types. The obvious move is wrong: the
 * existing system computes GST in the browser with THREE different jQuery
 * implementations that do not agree (assessment finding B-2), and which of them
 * is correct is an open question with the business
 * (`07-Business-Rule-Inventory.md`, the longest-lead blocker). Adding a fourth
 * calculation here would silently pick a winner, in a master screen, months
 * before anyone decides.
 *
 * So the field is entered, validated for shape and internal consistency, and
 * stored. When the rule is settled it belongs in `packages/domain` with tests,
 * called by the server — not in a component.
 */
type FormValues = z.input<typeof createItemSchema>;
type Submitted = z.output<typeof createItemSchema>;

export function ItemFormDialog({
  open,
  itemId,
  onClose,
}: {
  open: boolean;
  itemId: string | null;
  onClose: () => void;
}) {
  /**
   * A STARTING POINT PICKED FROM THE MATCHES (client request, 6 Oct 2026). While
   * ADDING, the person types a name, sees the items already called something like
   * it and may choose one: its unit, price, GST and HSN fill the form, and the
   * name is left in the box to be changed. The save is still a NEW item. It is
   * not an edit of the one picked, and the name check refuses the picked item's
   * own name, so the person has to change it. The new item's price history
   * begins with its own "created" row.
   */
  const [pickedId, setPickedId] = useState<string | null>(null);
  const isEdit = itemId !== null;
  const canPick = !isEdit;
  const detail = useItem(open && isEdit ? itemId : null);
  const template = useItem(open && !isEdit ? pickedId : null);
  const units = useAllUnits();
  const create = useCreateItem();
  const update = useUpdateItem();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setFocus,
    watch,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createItemSchema),
    defaultValues: EMPTY,
  });

  /**
   * THE NAME CHECK WHILE TYPING (client request, 14 Sep 2026).
   *
   * Asked once typing pauses, and its answer is used only while it still
   * describes what is in the box. Otherwise "Cement" matching an existing item
   * would keep showing "already exists" for a moment after the person typed on
   * to "Cement 53 Grade".
   *
   * The server refuses the same name whatever this shows, so a person who saves
   * faster than the check answers still gets the message, from the save.
   */
  const typedName = String(watch("name") ?? "");
  const settledName = useDebouncedValue(typedName, 300);
  const nameCheck = useItemNameCheck(open ? settledName : "", itemId);
  const checkIsCurrent =
    normalizeItemName(settledName).toLowerCase() === normalizeItemName(typedName).toLowerCase();
  const sameName = checkIsCurrent ? (nameCheck.data?.exact ?? null) : null;
  const similarNames = checkIsCurrent ? (nameCheck.data?.similar ?? []) : [];
  const checking = typedName.trim().length >= 2 && (!checkIsCurrent || nameCheck.isFetching);

  useEffect(() => {
    if (!open) setPickedId(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (!isEdit) {
      if (!pickedId) {
        reset(EMPTY);
      } else if (template.data) {
        // The copy lands on the name box, selected, ready to be typed over.
        reset(toFormValues(template.data));
        setFocus("name", { shouldSelect: true });
      }
    } else if (detail.data) {
      reset(toFormValues(detail.data));
    }
  }, [open, isEdit, detail.data, pickedId, template.data, reset, setFocus]);

  const pending = create.isPending || update.isPending;

  /**
   * THE MATCHES AS A DROPDOWN UNDER THE NAME BOX, instantly (client request,
   * 6 Oct 2026): the same search-as-you-type the invoice's product box has. It is
   * the item search itself, not the name check, so it lists every item whose name
   * contains what is typed, after a short pause of 150ms rather than the name
   * check's 300.
   */
  const [listOpen, setListOpen] = useState(false);
  // The close after a blur is delayed so a click on an option can land first. It
  // must be CANCELLED when the box is focused again inside that delay, or a quick
  // refocus has the list shut under the person's hands.
  const closeTimer = useRef<number | undefined>(undefined);
  const [highlight, setHighlight] = useState(-1);
  const listTerm = useDebouncedValue(typedName.trim(), 150);
  const matchesQuery = useItemOptions(open && !itemId && listTerm.length >= 1 ? listTerm : "");
  const matches = listTerm.length >= 1 ? (matchesQuery.data?.rows ?? []) : [];


  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (sameName) {
      setError("name", { message: duplicateItemNameMessage(sameName.name) });
      return;
    }
    try {
      if (isEdit) {
        await update.mutateAsync({ id: itemId, body: values });
      } else {
        await create.mutateAsync(values);
      }
      onClose();
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  }, (invalid) => setFormError(unshownValidationMessage(invalid)));

  const unitOptions = (units.data?.rows ?? []).map((unit) => ({
    value: unit.id,
    label: unit.name,
  }));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit item" : "Add item"}
      description="A material or service that appears on purchase orders"
      formError={formError}
      pending={pending}
      submitLabel={isEdit ? "Save changes" : "Create item"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading item…</p>
      ) : (
        <>
          <FormSection icon={Package} title="Item">
            <div
              className="relative"
              onFocus={() => {
                window.clearTimeout(closeTimer.current);
                setListOpen(true);
              }}
              onBlur={() => {
                window.clearTimeout(closeTimer.current);
                closeTimer.current = window.setTimeout(() => setListOpen(false), 150);
              }}
              onKeyDown={(event) => {
                if (!canPick || !listOpen || matches.length === 0) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setHighlight((i) => Math.min(i + 1, matches.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setHighlight((i) => Math.max(i - 1, 0));
                } else if (event.key === "Enter" && highlight >= 0) {
                  // Only once an item was arrowed to: a plain Enter still saves.
                  event.preventDefault();
                  setPickedId(matches[highlight]!.id);
                  setListOpen(false);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setListOpen(false);
                }
              }}
            >
              <TextField
                label="Item name"
                required
                autoFocus
                autoComplete="off"
                error={
                  sameName ? duplicateItemNameMessage(sameName.name) : errors.name?.message
                }
                {...register("name", {
                  onChange: () => {
                    setHighlight(-1);
                    window.clearTimeout(closeTimer.current);
                    setListOpen(true);
                  },
                })}
              />
              {canPick && listOpen && matches.length > 0 && (
                <ul
                  role="listbox"
                  aria-label="Existing items"
                  className="scroll-subtle absolute left-0 right-0 z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-pop"
                >
                  <li className="px-3 pb-1 pt-0.5 text-xs text-slate-500" aria-hidden>
                    Existing items — choose one to start from
                  </li>
                  {matches.map((match, index) => (
                    <li
                      key={match.id}
                      role="option"
                      aria-selected={index === highlight}
                      // `onMouseDown`, not `onClick`: the input's blur would close
                      // the list before a click could land.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setPickedId(match.id);
                        setListOpen(false);
                      }}
                      onMouseEnter={() => setHighlight(index)}
                      className={
                        index === highlight
                          ? "cursor-pointer bg-brand-50 px-3 py-2 text-brand-900"
                          : "cursor-pointer px-3 py-2 text-slate-700"
                      }
                    >
                      {match.name}
                    </li>
                  ))}
                </ul>
              )}
              {sameName && canPick && !pickedId && (
                <button
                  type="button"
                  className="mt-1 text-xs font-medium text-brand-700 underline underline-offset-2"
                  onClick={() => setPickedId(sameName.id)}
                >
                  Start from this item&rsquo;s details
                </button>
              )}
              {pickedId && canPick && (
                <p className="mt-1 text-xs leading-4 text-slate-500" aria-live="polite">
                  Details copied from an existing item. Change the name to save it as a new item.{" "}
                  <button
                    type="button"
                    className="font-medium text-slate-700 underline underline-offset-2"
                    onClick={() => {
                      setPickedId(null);
                      reset(EMPTY);
                    }}
                  >
                    Start blank
                  </button>
                </p>
              )}
              {checking && !sameName && (
                <p className="mt-1 text-xs leading-4 text-slate-400" aria-live="polite">
                  Checking existing items…
                </p>
              )}
              {!checking && !canPick && similarNames.length > 0 && (
                <div
                  className="mt-1.5 rounded-md bg-amber-50 px-2.5 py-2 ring-1 ring-inset ring-amber-200"
                  aria-live="polite"
                >
                  <p className="text-xs font-medium leading-4 text-amber-800">
                    Items with a similar name already exist
                  </p>
                  <ul aria-label="Items with a similar name" className="mt-1 space-y-0.5">
                    {similarNames.map((match) => (
                      <li key={match.id} className="truncate text-xs text-amber-900">
                        {match.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <SelectField
              label="Unit"
              required
              placeholder={units.isLoading ? "Loading units…" : "Choose a unit"}
              options={unitOptions}
              error={errors.unitId?.message}
              {...register("unitId")}
            />
            <TextField
              label="Price per unit"
              required
              inputMode="decimal"
              hint="Amount with at most 2 decimal places"
              error={errors.pricePerUnit?.message}
              {...register("pricePerUnit")}
            />
            <TextField
              label="HSN code"
              inputMode="numeric"
              hint="4, 6 or 8 digits"
              error={errors.hsnCode?.message}
              {...register("hsnCode")}
            />
          </FormSection>

          {/*
            NO "GST-inclusive" CHECKBOX, and the two boxes are always shown.

            Both fields are optional: an item with no GST simply leaves them
            empty. That is what the flag used to say, and saying it twice is what
            let the two disagree. See `createItemSchema`.
          */}
          <FormSection icon={Percent} title="GST" columns={2}>
            <TextField
              label="GST percentage"
              inputMode="decimal"
              hint="5, 12, 18 or 28 — leave blank if the item has no GST"
              error={errors.gstPercent?.message}
              {...register("gstPercent")}
            />
            <TextField
              label="GST amount"
              inputMode="decimal"
              error={errors.gstAmount?.message}
              {...register("gstAmount")}
            />
            <Alert tone="info" className="sm:col-span-2">
              The GST amount is stored exactly as entered. It is not calculated
              from the price and percentage — three different calculations
              exist in the current system and which is correct has not been
              settled with the business.
            </Alert>
          </FormSection>

        </>
      )}
    </FormDialog>
  );
}

const EMPTY: FormValues = {
  name: "",
  unitId: "" as unknown as number,
  pricePerUnit: "",
  gstPercent: "",
  gstAmount: "",
  hsnCode: "",
};

const toFormValues = (detail: ItemDetail): FormValues => ({
  name: detail.name,
  unitId: detail.unitId,
  pricePerUnit: detail.pricePerUnit,
  gstPercent: text(detail.gstPercent),
  gstAmount: text(detail.gstAmount),
  hsnCode: text(detail.hsnCode),
});
