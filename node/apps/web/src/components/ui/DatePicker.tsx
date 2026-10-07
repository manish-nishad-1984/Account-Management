import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { todayInput } from "../../lib/dates";

/**
 * A calendar popup for a date input (client request, 7 Oct 2026: "a good date
 * input control").
 *
 * THE REAL `<input type="date">` STAYS. It is still the field: it is typed into,
 * it is what a form library reads, and every test and screen that already
 * handles it keeps working. This adds a button beside it and a calendar the
 * button opens. Choosing a day writes the value into the input the way a person
 * typing would (the native value setter, then an `input` event), so a form that is
 * controlled by state and one that is registered with react-hook-form both hear
 * it, and neither needs to know the calendar exists.
 *
 * It is portalled and positioned `fixed`, for the same reason the item list is:
 * a record page and a dialog both scroll, and an absolutely positioned popup is
 * cut off at the edge of whatever scrolls.
 */

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = Array.from({ length: 12 }, (_, month) =>
  new Date(2000, month, 1).toLocaleString("en-IN", { month: "long" }),
);

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function parse(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

/** Writes a value into an input and tells React and any form library, as typing does. */
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function DatePickerButton({
  inputRef,
  min,
  max,
  required,
  disabled,
  label,
  compact,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  label: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<{ y: number; m: number }>({ y: 2000, m: 0 });
  const [chosen, setChosen] = useState("");
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const openCalendar = () => {
    const current = inputRef.current?.value ?? "";
    const shown = parse(current) ?? parse(todayInput()) ?? { y: 2026, m: 0, d: 1 };
    setChosen(current);
    setView({ y: shown.y, m: shown.m });
    setOpen(true);
  };

  // Placed against the input, flipped above it when there is no room below.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = (inputRef.current ?? button.current)?.getBoundingClientRect();
      if (!rect) return;
      const width = 288;
      const height = 340;
      const below = window.innerHeight - rect.bottom;
      setBox({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: below < height && rect.top > below ? Math.max(8, rect.top - height - 4) : rect.bottom + 4,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, inputRef]);

  // Click outside and Escape close it. Escape stops here, so a dialog behind it stays open.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const today = todayInput();
  const selected = parse(chosen);

  /** The six-row grid for the month in view, with the days of the months either side. */
  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const start = new Date(view.y, view.m, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { iso: toIso(day.getFullYear(), day.getMonth(), day.getDate()), day: day.getDate(), inMonth: day.getMonth() === view.m };
    });
  }, [view]);

  const years = useMemo(() => {
    const base = new Date().getFullYear();
    const from = Math.min(base - 10, view.y);
    const to = Math.max(base + 5, view.y);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }, [view.y]);

  const shift = (months: number) =>
    setView((current) => {
      const date = new Date(current.y, current.m + months, 1);
      return { y: date.getFullYear(), m: date.getMonth() };
    });

  const pick = (iso: string) => {
    if (inputRef.current) setInputValue(inputRef.current, iso);
    setOpen(false);
    inputRef.current?.focus();
  };

  const blocked = (iso: string) => (min !== undefined && min !== "" && iso < min) || (max !== undefined && max !== "" && iso > max);

  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-label="Open calendar" title={`Choose ${label.toLowerCase()} from a calendar`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openCalendar())}
        className={clsx(
          "absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded text-slate-400 transition-colors",
          "hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500",
          "disabled:pointer-events-none disabled:opacity-40",
          compact ? "size-6" : "size-7",
        )}
      >
        <CalendarDays aria-hidden className="size-4" />
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label="Calendar"
            style={{ left: box.left, top: box.top, width: 288 }}
            className="fixed z-[60] rounded-xl border border-slate-200 bg-white p-3 shadow-pop"
          >
            <div className="mb-2 flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => shift(-1)}
                className="flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
              >
                <ChevronLeft aria-hidden className="size-4" />
              </button>
              <select
                aria-label="Month"
                value={view.m}
                onChange={(event) => setView((current) => ({ ...current, m: Number(event.target.value) }))}
                className="min-w-0 flex-1 rounded-md border-0 bg-transparent py-1 pl-2 pr-6 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus:ring-2 focus:ring-brand-500"
              >
                {MONTHS.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Year"
                value={view.y}
                onChange={(event) => setView((current) => ({ ...current, y: Number(event.target.value) }))}
                className="w-[5.5rem] shrink-0 rounded-md border-0 bg-transparent py-1 pl-2 pr-6 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus:ring-2 focus:ring-brand-500"
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => shift(1)}
                className="flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
              >
                <ChevronRight aria-hidden className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 text-center text-[11px] font-medium text-slate-400">
              {WEEKDAYS.map((day) => (
                <div key={day} className="py-1">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5" role="grid">
              {cells.map((cell) => {
                const isSelected = selected !== null && cell.iso === toIso(selected.y, selected.m, selected.d);
                const isToday = cell.iso === today;
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    disabled={blocked(cell.iso)}
                    aria-label={cell.iso}
                    aria-pressed={isSelected}
                    onClick={() => pick(cell.iso)}
                    className={clsx(
                      "mx-auto flex size-8 items-center justify-center rounded-full text-sm tabular transition-colors",
                      "disabled:cursor-not-allowed disabled:text-slate-300",
                      isSelected
                        ? "bg-brand-600 font-semibold text-white hover:bg-brand-700"
                        : cell.inMonth
                          ? "text-slate-800 hover:bg-brand-50"
                          : "text-slate-300 hover:bg-slate-50",
                      isToday && !isSelected && "font-semibold text-brand-700 ring-1 ring-inset ring-brand-300",
                    )}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
              <button
                type="button"
                disabled={blocked(today)}
                onClick={() => pick(today)}
                className="rounded-md px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-40"
              >
                Today
              </button>
              {!required && (
                <button
                  type="button"
                  onClick={() => pick("")}
                  className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
