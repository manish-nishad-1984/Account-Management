import clsx from "clsx";

/**
 * A trade as a coloured tag, as in the client's mockup.
 *
 * The colour comes from the work type's id, not its position in a list, so
 * "Plaster" is the same colour on every row and every screen.
 */
const PALETTE = [
  "bg-sky-50 text-sky-700 ring-sky-200",
  "bg-amber-50 text-amber-800 ring-amber-200",
  "bg-violet-50 text-violet-700 ring-violet-200",
  "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "bg-rose-50 text-rose-700 ring-rose-200",
  "bg-slate-100 text-slate-700 ring-slate-300",
  "bg-indigo-50 text-indigo-700 ring-indigo-200",
  "bg-orange-50 text-orange-700 ring-orange-200",
];

export function WorkTypeTag({ id, name }: { id: number; name: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        PALETTE[id % PALETTE.length],
      )}
    >
      {name}
    </span>
  );
}
