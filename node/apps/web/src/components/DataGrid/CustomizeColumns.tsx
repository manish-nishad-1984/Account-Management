import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Lock, Search, X } from "lucide-react";
import clsx from "clsx";
import { moveGridColumn, type GridColumnDefault } from "@accountmanagement/contracts";
import { Button } from "../ui";

interface Props {
  open: boolean;
  columns: GridColumnDefault[];
  onCancel: () => void;
  onSave: (columns: GridColumnDefault[]) => void;
  onReset: () => void;
  isSaving?: boolean;
}

/**
 * Choose which columns a grid shows, and in what order.
 *
 * DRAGGING IS NOT THE ONLY WAY TO REORDER, and that is deliberate rather than
 * belt and braces. Native drag-and-drop is unreachable from a keyboard, awkward
 * with a thumb on a phone, and close to untestable in a headless DOM — so every
 * row also carries move-up and move-down buttons. Both paths call the same pure
 * `moveGridColumn`, which is tested directly in the contracts package; the drag
 * handlers below are a thin shell over it and hold no logic of their own.
 *
 * The edits are LOCAL until Save. Someone who hides six columns and then thinks
 * better of it presses Cancel and nothing has happened — which is what Cancel
 * means, and is not true of a panel that writes on every click.
 */
export function CustomizeColumns({
  open,
  columns,
  onCancel,
  onSave,
  onReset,
  isSaving = false,
}: Props) {
  const [draft, setDraft] = useState<GridColumnDefault[]>(columns);
  const [search, setSearch] = useState("");
  const dragFrom = useRef<number | null>(null);

  // Reopening shows what is actually on the grid, not the abandoned draft.
  useEffect(() => {
    if (open) {
      setDraft(columns);
      setSearch("");
    }
  }, [open, columns]);

  const term = search.trim().toLowerCase();
  const matches = useMemo(
    () =>
      draft.map(
        (column) => term === "" || (column.label || column.id).toLowerCase().includes(term),
      ),
    [draft, term],
  );

  const selected = draft.filter((column) => column.visible).length;

  if (!open) return null;

  const toggle = (id: string) =>
    setDraft((current) =>
      current.map((column) =>
        column.id === id && !column.locked ? { ...column, visible: !column.visible } : column,
      ),
    );

  /**
   * A move is expressed in terms of the FULL list, never the filtered view: with
   * a search term active the visible rows are not adjacent, and "move up" against
   * the filtered positions would jump a column past the ones being hidden by the
   * search. Reordering is therefore disabled while searching.
   */
  const move = (from: number, to: number) => {
    if (draft[from]?.locked || draft[to]?.locked) return;
    setDraft((current) => moveGridColumn(current, from, to));
  };

  /**
   * A column can move only into a neighbour that is not locked. Locked columns
   * hold the position the grid gives them — the identity column first, the row
   * actions last — so a movable column cannot slide past either end.
   */
  const canMoveUp = (index: number) => index > 0 && !draft[index - 1]?.locked;
  const canMoveDown = (index: number) =>
    index < draft.length - 1 && !draft[index + 1]?.locked;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Customize columns"
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="flex h-full w-full max-w-sm flex-col bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="heading text-base">Customize Columns</h2>
            <p className="mt-0.5 text-xs text-slate-500" data-testid="column-count">
              {selected} of {draft.length} selected
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="-mr-1 rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="border-b border-slate-200 px-4 py-3">
          <div className="relative">
            <input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search columns…"
              aria-label="Search columns"
              className="w-full rounded-lg border-0 py-2 pl-9 pr-3 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500"
            />
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            />
          </div>
          {term !== "" && (
            <p className="mt-2 text-[11px] text-slate-500">
              Clear the search to change the order.
            </p>
          )}
        </div>

        <ul className="scroll-subtle flex-1 overflow-y-auto p-3">
          {draft.map((column, index) => {
            if (!matches[index]) return null;
            const label = column.label || column.id;

            return (
              <li
                key={column.id}
                draggable={!column.locked && term === ""}
                onDragStart={() => {
                  dragFrom.current = index;
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragFrom.current !== null) move(dragFrom.current, index);
                  dragFrom.current = null;
                }}
                className={clsx(
                  "mb-1.5 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm",
                  column.visible
                    ? "border-slate-200 bg-white"
                    : "border-slate-200/70 bg-slate-50 text-slate-500",
                )}
              >
                {column.locked ? (
                  <Lock aria-hidden className="size-3.5 shrink-0 text-slate-300" />
                ) : (
                  <GripVertical
                    aria-hidden
                    className={clsx(
                      "size-4 shrink-0 text-slate-300",
                      term === "" && "cursor-grab",
                    )}
                  />
                )}

                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={column.visible}
                    disabled={column.locked}
                    onChange={() => toggle(column.id)}
                    aria-label={label}
                    className="size-3.5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-40"
                  />
                  <span className="truncate">{label}</span>
                  {column.locked && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">
                      always shown
                    </span>
                  )}
                </label>

                {!column.locked && term === "" && (
                  <span className="flex shrink-0 items-center">
                    <button
                      type="button"
                      aria-label={`Move ${label} up`}
                      disabled={!canMoveUp(index)}
                      onClick={() => move(index, index - 1)}
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${label} down`}
                      disabled={!canMoveDown(index)}
                      onClick={() => move(index, index + 1)}
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
          <Button type="button" variant="secondary" onClick={onReset} disabled={isSaving}>
            Reset to Default
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => onSave(draft)} disabled={isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
