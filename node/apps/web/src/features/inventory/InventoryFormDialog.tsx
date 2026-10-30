import { PackageCheck, Tags } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  INVENTORY_ARRIVAL_MAX_PIECES,
  createInventoryInwardSchema,
  type InventoryInwardDetail,
} from "@accountmanagement/contracts";
import { FormDialog, FormSection, SelectField, TextAreaField, TextField } from "../../components/ui";
import { applyServerErrors, unshownValidationMessage } from "../../lib/crud";
import { text } from "../../lib/form-values";
import {
  useCreateInventoryInward,
  useInventoryInward,
  useUpdateInventoryInward,
} from "./api";
import { useInventoryItems } from "./stock-api";
import { PhotoInput } from "./photos";
import { useAllUnits } from "../items/api";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { todayInput } from "../../lib/dates";

/**
 * NEW ARRIVAL. Since 26 Oct 2026 (client) it brings stock into the INVENTORY
 * ITEM MASTER: an item picked from it, or a name typed for the first time,
 * which the master then gets, with its unit. The quantity, and a photo of what
 * came. The purchase items (the Items master) keep a stock of their own, from
 * the inward challans.
 *
 * NO SITE FIELD, matching the source — and the site is nonetheless recorded.
 * The scope in the header supplies it, and the stock is the site's.
 *
 * NO APPROVAL FIELD either: new rows are created unapproved; approving is a
 * separate action needing the approve right.
 */
type FormValues = z.input<typeof createInventoryInwardSchema>;
type Submitted = z.output<typeof createInventoryInwardSchema>;

/** The picker's choice that opens the name and unit of a new item. */
const NEW_ITEM = "__new__";

/**
 * ONE ROW FOR EACH PIECE THAT CAME (client, 30 Oct 2026): its tag name and its
 * photo. `photoKey` undefined keeps the photo the piece has on an edit.
 */
type Piece = { tag: string; photoKey?: string | null; saved: boolean };

/** How many pieces a quantity is: a whole number, or none. */
export const pieceCount = (quantity: unknown): number => {
  const text = String(quantity ?? "").trim();
  return /^\d+(\.0+)?$/.test(text) ? Number.parseInt(text, 10) : 0;
};

export function InventoryFormDialog({
  open,
  recordId,
  onClose,
}: {
  open: boolean;
  recordId: string | null;
  onClose: () => void;
}) {
  const isEdit = recordId !== null;
  const detail = useInventoryInward(open && isEdit ? recordId : null);
  const scope = useSiteScope();
  const itemsQuery = useInventoryItems(scope.siteId);
  const create = useCreateInventoryInward();
  const update = useUpdateInventoryInward();
  const [formError, setFormError] = useState<string | null>(null);
  // "+ New item" chosen: the name and unit open.
  const [typingNew, setTypingNew] = useState(false);
  const units = useAllUnits();
  const [pieces, setPieces] = useState<Piece[]>([]);
  // A new opening starts the photo boxes afresh.
  const [opening, setOpening] = useState(0);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues, unknown, Submitted>({
    resolver: zodResolver(createInventoryInwardSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setTypingNew(false);
    setOpening((n) => n + 1);
    if (!isEdit) {
      setPieces([]);
      // Dated today unless the person says otherwise. Computed on open, never at
      // module load: a tab left open overnight would otherwise offer yesterday.
      reset({ ...EMPTY, documentDate: todayInput(), siteId: scope.siteId ?? null });
    } else if (detail.data) {
      reset(toFormValues(detail.data));
      setPieces(detail.data.pieces.map((piece) => ({ tag: piece.tag, photoKey: undefined, saved: piece.hasPhoto })));
    }
  }, [open, isEdit, detail.data, reset, scope.siteId]);

  const pending = create.isPending || update.isPending;

  const onSubmit = handleSubmit(
    async (values) => {
      setFormError(null);
      // As many pieces as the quantity, in order.
      const body = {
        ...values,
        pieces: pieces.slice(0, Math.min(pieceCount(values.quantity), INVENTORY_ARRIVAL_MAX_PIECES)).map((piece) => ({
          tag: piece.tag.trim(),
          photoKey: piece.photoKey,
        })),
      };
      try {
        if (isEdit) {
          await update.mutateAsync({ id: recordId, body });
        } else {
          await create.mutateAsync(body);
        }
        onClose();
      } catch (error) {
        setFormError(applyServerErrors(error, setError));
      }
    },
    (invalid) => setFormError(unshownValidationMessage(invalid)),
  );

  const inventoryItemId = useWatch({ control, name: "inventoryItemId" });
  const quantity = useWatch({ control, name: "quantity" });
  const count = pieceCount(quantity);
  const shownPieces = Math.min(count, INVENTORY_ARRIVAL_MAX_PIECES);
  const pieceAt = (n: number): Piece => pieces[n] ?? { tag: "", photoKey: undefined, saved: false };
  const setPiece = (n: number, change: Partial<Piece>) =>
    setPieces((current) => {
      const next = [...current];
      for (let i = next.length; i <= n; i++) next.push({ tag: "", photoKey: undefined, saved: false });
      next[n] = { ...next[n]!, ...change };
      return next;
    });
  const items = itemsQuery.data?.rows ?? [];
  const picked = items.find((item) => item.id === inventoryItemId);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit arrival" : "New arrival"}
      description={
        isEdit
          ? "What arrived, and how much"
          : scope.siteName
            ? `Into the stock of ${scope.siteName}`
            : "Recorded against every site — choose a site in the header to narrow it"
      }
      formError={formError}
      pending={pending}
      submitLabel={isEdit ? "Save changes" : "Record arrival"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading arrival…</p>
      ) : (
        <FormSection icon={PackageCheck} title="What arrived" columns={3}>
          <SelectField
            label="Inventory item"
            required
            className="sm:col-span-2"
            value={typingNew ? NEW_ITEM : String(inventoryItemId ?? "")}
            placeholder={itemsQuery.isLoading ? "Loading items…" : "Choose the item"}
            options={[
              ...items.map((item) => ({ value: item.id, label: `${item.name} (${item.unit})` })),
              { value: NEW_ITEM, label: "+ New item…" },
            ]}
            error={typingNew ? undefined : errors.inventoryItemId?.message}
            onChange={(event) => {
              const value = event.target.value;
              if (value === NEW_ITEM) {
                setTypingNew(true);
                setValue("inventoryItemId", null, { shouldDirty: true });
              } else {
                setTypingNew(false);
                setValue("newItemName", undefined, { shouldDirty: true });
                setValue("inventoryItemId", value || null, { shouldDirty: true, shouldValidate: true });
              }
            }}
          />
          <p className="self-end pb-2 text-xs text-slate-500">
            {picked ? `In stock here: ${Number(picked.stock)} ${picked.unit}` : ""}
          </p>

          {typingNew && (
            <>
              <TextField
                label="New item name"
                required
                className="sm:col-span-2"
                placeholder="e.g. Drill machine"
                error={errors.inventoryItemId?.message ?? errors.newItemName?.message}
                {...register("newItemName")}
              />
              <SelectField
                label="Unit"
                placeholder={units.isLoading ? "Loading units…" : "Choose a unit"}
                options={(units.data?.rows ?? []).map((unit) => ({ value: unit.name, label: unit.name }))}
                error={errors.unit?.message}
                {...register("unit")}
              />
            </>
          )}

          <TextField
            label="Quantity"
            required
            inputMode="decimal"
            error={errors.quantity?.message}
            {...register("quantity")}
          />
          <TextField
            label="Date"
            type="date"
            error={errors.documentDate?.message}
            {...register("documentDate")}
          />
          <TextAreaField
            label="Details"
            rows={1}
            error={errors.details?.message}
            {...register("details")}
          />

          {/* The one photo of an arrival from before the pieces had their own. */}
          {isEdit && detail.data?.hasPhoto && (
            <div className="sm:col-span-3">
              <PhotoInput
                label="Photo"
                currentPath={`/inventory-issues/arrivals/${recordId}/photo`}
                onChange={(photoKey) => setValue("photoKey", photoKey, { shouldDirty: true })}
              />
            </div>
          )}
        </FormSection>
      )}

      {!(isEdit && detail.isLoading) && (
        <FormSection icon={Tags} title="Tag name and photo of each piece" columns={1}>
          {shownPieces === 0 ? (
            <p className="text-sm text-slate-500">
              {String(quantity ?? "").trim() && count === 0
                ? "Tags and photos are for a whole quantity."
                : "Type the quantity: a row for each piece opens here."}
            </p>
          ) : (
            <div className="space-y-2">
              {count > INVENTORY_ARRIVAL_MAX_PIECES && (
                <p className="text-xs text-slate-500">The first {INVENTORY_ARRIVAL_MAX_PIECES} pieces are tagged here.</p>
              )}
              {Array.from({ length: shownPieces }, (_, n) => {
                const piece = pieceAt(n);
                return (
                  <div key={`${opening}-${n}`} className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 sm:grid-cols-[2rem_minmax(12rem,24rem)_minmax(0,1fr)]">
                    <span className="tabular text-sm text-slate-500">{n + 1}</span>
                    <TextField
                      label={`Tag name of piece ${n + 1}`}
                      labelHidden
                      placeholder={`Tag name ${n + 1}`}
                      value={piece.tag}
                      onChange={(event) => setPiece(n, { tag: event.target.value })}
                    />
                    <div className="col-start-2 sm:col-start-3">
                      <PhotoInput
                        label={`Photo of piece ${n + 1}`}
                        hideLabel
                        currentPath={isEdit && piece.saved ? `/inventory-issues/arrivals/${recordId}/pieces/${n}/photo` : null}
                        onChange={(photoKey) => setPiece(n, { photoKey })}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </FormSection>
      )}
    </FormDialog>
  );
}

const EMPTY: FormValues = {
  siteId: null,
  inventoryItemId: null,
  newItemName: undefined,
  unit: undefined,
  quantity: "",
  documentDate: "",
  details: "",
  photoKey: undefined,
  pieces: [],
};

/** `<input type="date">` wants `yyyy-mm-dd`; the API sends a full ISO timestamp. */
const dateInput = (value: string | null): string => (value ? value.slice(0, 10) : "");

/**
 * An edit KEEPS the row's own site, including a null one. Reassigning an old
 * arrival to whatever site the editor happens to be looking at would rewrite
 * history as a side effect of opening a form. An arrival from before 26 Oct 2026
 * has no inventory item: its item is picked again.
 */
const toFormValues = (detail: InventoryInwardDetail): FormValues => ({
  siteId: detail.siteId,
  inventoryItemId: detail.inventoryItemId,
  newItemName: undefined,
  unit: undefined,
  quantity: detail.quantity,
  documentDate: dateInput(detail.documentDate),
  details: text(detail.details),
  photoKey: undefined,
  pieces: [],
});
