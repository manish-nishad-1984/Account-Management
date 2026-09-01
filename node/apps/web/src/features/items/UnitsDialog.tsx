import { useState } from "react";
import { createUnitSchema, type UnitRow } from "@accountmanagement/contracts";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Button, Modal, TextField } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { useAllUnits, useCreateUnit, useDeleteUnit, useUpdateUnit } from "./api";

/**
 * Units of measure, managed from the Items screen rather than as a master of
 * their own.
 *
 * `UnitMaster` has no form row and no `[FormPermissionAttribute]` anywhere in
 * the .NET solution — units are edited in the database, if at all — so there is
 * no `unit` permission subject for a migrated `Form` row to grant. Rather than
 * invent one, the unit list is treated as part of the item master and guarded by
 * the ITEM rights: if you may add an item you may add the unit it is measured in.
 *
 * It is a dialog and not a page for the same reason: a nav entry implies a
 * screen someone goes to, and nobody goes to units except while defining an item.
 */
export function UnitsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const units = useAllUnits();
  const create = useCreateUnit();
  const update = useUpdateUnit();
  const remove = useDeleteUnit();

  const [name, setName] = useState("");
  const [editing, setEditing] = useState<UnitRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = units.data?.rows ?? [];
  const pending = create.isPending || update.isPending || remove.isPending;

  const reset = () => {
    setName("");
    setEditing(null);
    setError(null);
  };

  const submit = async () => {
    const parsed = createUnitSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a unit name");
      return;
    }

    setError(null);
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, body: parsed.data });
      } else {
        await create.mutateAsync(parsed.data);
      }
      reset();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save this unit");
    }
  };

  const askRemove = async (unit: UnitRow) => {
    setError(null);
    try {
      await remove.mutateAsync(unit.id);
      if (editing?.id === unit.id) reset();
    } catch (caught) {
      // The refusal is the useful part: "4 items use this unit."
      setError(caught instanceof ApiError ? caught.message : "Could not delete this unit");
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Units of measure"
      description="Used by every item. A unit in use cannot be deleted."
      size="md"
      footer={
        <Button
          variant="secondary"
          onClick={() => {
            reset();
            onClose();
          }}
        >
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <div className="flex items-end gap-2">
          <TextField
            label={editing ? `Rename "${editing.name}"` : "New unit"}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="e.g. Bag, Ton, Sq. Meter"
            className="flex-1"
          />
          <Button icon={editing ? Pencil : Plus} onClick={submit} loading={pending}>
            {editing ? "Rename" : "Add"}
          </Button>
          {editing && (
            <Button variant="secondary" onClick={reset} disabled={pending}>
              Cancel
            </Button>
          )}
        </div>

        <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-slate-200">
          {units.isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">Loading units…</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              No units yet. Add the first one above.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((unit) => (
                <li key={unit.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex-1 text-sm text-slate-800">{unit.name}</span>
                  <span
                    className="tabular rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600"
                    title="Live items using this unit"
                  >
                    {unit.itemCount}
                  </span>
                  {unit.capabilities.canEdit && (
                    <Button
                      variant="ghost"
                      icon={Pencil}
                      className="px-2 py-1 text-xs"
                      aria-label={`Rename ${unit.name}`}
                      onClick={() => {
                        setEditing(unit);
                        setName(unit.name);
                        setError(null);
                      }}
                    />
                  )}
                  {unit.capabilities.canDelete && (
                    <Button
                      variant="ghost"
                      icon={Trash2}
                      className="px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      aria-label={`Delete ${unit.name}`}
                      // No confirmation step: a unit in use is refused by the
                      // server with the count, and one that is not in use has
                      // nothing pointing at it to lose.
                      onClick={() => void askRemove(unit)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
