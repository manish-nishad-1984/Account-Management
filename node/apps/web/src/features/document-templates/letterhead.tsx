import { useCallback, useState } from "react";

/**
 * SPACE LEFT FOR A LETTERHEAD (client request, 17 Oct 2026): a bill printed on
 * paper that already carries the company's letterhead needs the top (and the
 * foot) of every page left empty. The two figures are extra to the layout's own
 * margin, in millimetres, and apply to Print and to the PDF alike.
 *
 * KEPT IN THIS BROWSER, NOT IN THE TEMPLATE. It is a fact about the paper in the
 * printer on this desk, not about the invoice: the same template is printed on
 * plain paper from another machine. So it is remembered here and never saved.
 */
export interface LetterheadSpace {
  topMm: number;
  bottomMm: number;
}

const KEY = "letterhead-space";
export const LETTERHEAD_MAX_MM = 150;

const clamp = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(LETTERHEAD_MAX_MM, Math.max(0, Math.round(n))) : 0;
};

export function readLetterheadSpace(): LetterheadSpace {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<LetterheadSpace> | null;
    return { topMm: clamp(stored?.topMm), bottomMm: clamp(stored?.bottomMm) };
  } catch {
    return { topMm: 0, bottomMm: 0 };
  }
}

function writeLetterheadSpace(space: LetterheadSpace): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(space));
  } catch {
    // A browser that will not remember it still uses it for this page.
  }
}

export function useLetterheadSpace(): [LetterheadSpace, (change: Partial<LetterheadSpace>) => void] {
  const [space, setSpace] = useState<LetterheadSpace>(readLetterheadSpace);
  const update = useCallback((change: Partial<LetterheadSpace>) => {
    setSpace((current) => {
      const next = {
        topMm: clamp(change.topMm ?? current.topMm),
        bottomMm: clamp(change.bottomMm ?? current.bottomMm),
      };
      writeLetterheadSpace(next);
      return next;
    });
  }, []);
  return [space, update];
}

const box =
  "h-8 w-16 rounded-md border-0 bg-white px-2 text-right text-sm text-slate-800 ring-1 ring-inset ring-slate-300 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500";

/** "Leave space for a letterhead": the top and foot, in millimetres. */
export function LetterheadSpaceControl({
  space,
  onChange,
}: {
  space: LetterheadSpace;
  onChange: (change: Partial<LetterheadSpace>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Letterhead space">
      <span className="text-xs font-medium text-slate-600">Letterhead space (mm)</span>
      <label className="flex items-center gap-1 text-xs text-slate-600">
        Top
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={LETTERHEAD_MAX_MM}
          aria-label="Space at the top, in millimetres"
          className={box}
          value={space.topMm}
          onChange={(event) => onChange({ topMm: Number(event.target.value) })}
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-slate-600">
        Bottom
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={LETTERHEAD_MAX_MM}
          aria-label="Space at the bottom, in millimetres"
          className={box}
          value={space.bottomMm}
          onChange={(event) => onChange({ bottomMm: Number(event.target.value) })}
        />
      </label>
    </div>
  );
}
