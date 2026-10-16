import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { ItemDetail } from "@accountmanagement/contracts";
import { usePermission } from "../../lib/permissions";
import { ItemFormDialog } from "./ItemFormDialog";

/**
 * "Add new item", beside the Product heading of a document's line grid
 * (client request, 14 Oct 2026): a popup with the item form, so a new item can be
 * created without leaving the invoice. Shown only to a user who may add items.
 */
export function AddItemLink({ onSaved }: { onSaved: (item: ItemDetail) => void }) {
  const canAdd = usePermission("item", "add");
  const [open, setOpen] = useState(false);
  if (!canAdd) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-2 inline-flex items-center gap-0.5 align-middle text-xs font-medium normal-case tracking-normal text-brand-700 hover:underline"
      >
        <Plus aria-hidden className="size-3.5" />
        Add new item
      </button>
      <ItemFormDialog popup open={open} itemId={null} onClose={() => setOpen(false)} onSaved={onSaved} />
    </>
  );
}

/**
 * Where an item added from the heading goes: the first line that has no item yet,
 * or else a NEW line after the last one. The item is then picked on that line the
 * way choosing it from the list would — which also fills its unit and price.
 *
 * A new line cannot be filled in the same breath that it is inserted: it only has
 * fields once the form has rendered it. So the item waits, and goes on when the
 * list of lines next changes.
 */
export function useItemIntoLine({
  lines,
  lineCount,
  insertAfter,
  assign,
}: {
  lines: ReadonlyArray<{ itemId?: unknown; itemName?: unknown } | undefined> | undefined;
  /** How many lines the form has now; a change means the inserted line exists. */
  lineCount: number;
  insertAfter: (index: number) => void;
  assign: (index: number, itemId: string) => void;
}): (item: Pick<ItemDetail, "id">) => void {
  const waiting = useRef<string | null>(null);

  useEffect(() => {
    if (waiting.current === null) return;
    assign(lineCount - 1, waiting.current);
    waiting.current = null;
    // `assign` is the caller's closure, new every render; only a change in the
    // number of lines is the signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineCount]);

  return (item) => {
    const empty = (lines ?? []).findIndex(
      (line) => !String(line?.itemId ?? "").trim() && !String(line?.itemName ?? "").trim(),
    );
    if (empty >= 0) {
      assign(empty, item.id);
      return;
    }
    waiting.current = item.id;
    insertAfter(Math.max(lineCount - 1, 0));
  };
}
