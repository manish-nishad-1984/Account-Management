import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "../../components/ui";
import { CONTROL_BASE, LABEL_BASE, MESSAGE_BASE, ringFor } from "../../components/ui/fields";
import { describeLoadError } from "../../lib/load-error";
import { usePermission } from "../../lib/permissions";
import { useCreateWorkType, useWorkTypes } from "./api";
import { WorkTypeTag } from "./WorkTypeTag";

/**
 * "Work nature / services — select services (multiple)", from the mockup.
 *
 * A button that opens a checkbox list, rather than `MultiSelectField`'s
 * always-open list: nineteen trades open at all times would be the tallest
 * thing on the form, for a field most agencies fill with two or three. What is
 * chosen shows as the same coloured tags the list screen uses.
 *
 * A trade that is not on the list can be added from inside the panel —
 * by anyone who may add agencies — and is ticked as soon as it exists.
 */
export function WorkTypePicker({
  value,
  onChange,
  error,
}: {
  value: number[];
  onChange: (next: number[]) => void;
  error?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const workTypes = useWorkTypes();
  const create = useCreateWorkType();
  const canAdd = usePermission("agency", "add");

  // Closes on a click anywhere else, like any dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = new Set(value);
  const all = workTypes.data ?? [];
  const chosen = all.filter((type) => selected.has(type.id));

  const toggle = (typeId: number) =>
    onChange(selected.has(typeId) ? value.filter((v) => v !== typeId) : [...value, typeId]);

  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    setAddError(null);
    try {
      const created = await create.mutateAsync(name);
      onChange([...value, created.id]);
      setDraft("");
    } catch (failure) {
      setAddError(failure instanceof Error ? failure.message : "Could not add that work type");
    }
  };

  return (
    <div ref={wrapper} className="relative">
      <span id={`${id}-label`} className={LABEL_BASE}>
        Work nature / services <span className="text-rose-600">*</span>
      </span>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-labelledby={`${id}-label`}
        onClick={() => setOpen((current) => !current)}
        className={clsx(
          CONTROL_BASE,
          ringFor(error),
          "mt-1 flex items-center justify-between gap-2 px-2.5 text-left",
        )}
      >
        <span className={clsx("truncate", chosen.length === 0 && "text-slate-400")}>
          {chosen.length === 0 ? "Select services (multiple)" : `${chosen.length} selected`}
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-slate-400" />
      </button>

      {chosen.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chosen.map((type) => (
            <WorkTypeTag key={type.id} id={type.id} name={type.name} />
          ))}
        </div>
      )}

      {open && (
        <div
          id={`${id}-panel`}
          role="group"
          aria-label="Work types"
          className="absolute z-20 mt-1 w-full rounded-md bg-white shadow-lg ring-1 ring-slate-200"
        >
          {workTypes.isError ? (
            <p className="px-3 py-2 text-sm text-rose-600">{describeLoadError(workTypes.error, "the work types")}</p>
          ) : (
            <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
              {all.map((type) => (
                <li key={type.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={selected.has(type.id)}
                      onChange={() => toggle(type.id)}
                      className="size-4 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500 focus:ring-offset-0"
                    />
                    {type.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {canAdd && (
            <div className="border-t border-slate-200 p-2">
              <div className="flex gap-2">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  // Enter here would otherwise submit the whole agency form.
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void add();
                    }
                  }}
                  aria-label="New work type"
                  placeholder="Add a new work type"
                  className={clsx(CONTROL_BASE, ringFor(addError ?? undefined), "min-w-0 flex-1 px-2.5")}
                />
                <Button variant="outline" size="sm" icon={Plus} onClick={() => void add()} disabled={create.isPending || !draft.trim()}>
                  Add
                </Button>
              </div>
              {addError && <p className={clsx(MESSAGE_BASE, "font-medium text-rose-600")}>{addError}</p>}
            </div>
          )}
        </div>
      )}

      {error && <p className={clsx(MESSAGE_BASE, "font-medium text-rose-600")}>{error}</p>}
    </div>
  );
}
