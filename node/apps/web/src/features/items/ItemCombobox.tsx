import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { ChevronDown, Pencil } from "lucide-react";
import {
  CONTROL_BASE,
  LABEL_BASE,
  MESSAGE_BASE,
  ringFor,
} from "../../components/ui/fields";
import { useItemOptions } from "./api";

/**
 * Pick an item by typing part of its name.
 *
 * THE ONE CONTROL THAT REPLACED THREE, and it fixes a data bug on the way.
 *
 * Every item dropdown in the application was a native `<select>` fed by the
 * first 200 items. Production has 758. The 558 that did not fit were not
 * reachable from any screen — so the two document forms grew a SECOND control
 * beside the dropdown to type a name into, and an Alert explaining that the list
 * was incomplete. A user who could not find "Ready Mix Concrete M25" typed it,
 * and the line then recorded a string in `item_name` instead of a reference to
 * the catalogue item that existed all along. Every report that groups by item
 * silently missed those lines.
 *
 * Here the term goes to the server and the server narrows 758 rows, so the whole
 * catalogue is reachable through one box and the second control has nothing left
 * to do.
 *
 * FREE TEXT SURVIVES, because it is a real feature rather than a workaround:
 * a purchase order may legitimately name something that is not in the catalogue.
 * It is now the LAST resort rather than the first — offered at the bottom of the
 * list, after the user has seen that nothing matches, instead of sitting in a
 * box beside the dropdown inviting a guess. `allowFreeText` is off for the
 * screens whose item is a required reference (inventory, challans, requests),
 * where a typed name would have nowhere to go.
 *
 * Keyboard: arrows move, Enter picks, Escape closes. Generalised from
 * `SiteCombobox`, which answered the same request for sites on 15 Sep 2026.
 */
export function ItemCombobox({
  itemId,
  itemName = "",
  onPick,
  onTypeName,
  label,
  labelHidden,
  required,
  disabled,
  error,
  allowFreeText = false,
  className,
  id,
}: {
  /** The chosen catalogue item, or "" when none is. */
  itemId: string;
  /** A name typed for something not in the catalogue. Ignored unless `allowFreeText`. */
  itemName?: string;
  onPick: (itemId: string, itemLabel: string) => void;
  /** Called with the typed name when the user commits one. Required with `allowFreeText`. */
  onTypeName?: (name: string) => void;
  label: string;
  labelHidden?: boolean;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  allowFreeText?: boolean;
  className?: string;
  /** Supplied where something else focuses this box — the grid's Add-line button. */
  id?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listId = `${inputId}-list`;

  /** null = "showing the committed value"; a string = "the user is typing". */
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  /**
   * DEBOUNCED, because this reaches the server on every keystroke.
   *
   * 200ms is the same figure the item name check uses. Without it, typing
   * "cement" is six requests, five of which are already stale when they land.
   */
  const [term, setTerm] = useState("");
  useEffect(() => {
    const handle = window.setTimeout(() => setTerm(query ?? ""), 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  const options = useItemOptions(term);
  const items = useMemo(() => options.data?.rows ?? [], [options.data]);

  const chosen = items.find((item) => item.id === itemId) ?? null;

  /**
   * THE CHOSEN ITEM'S NAME HAS TO SURVIVE A SEARCH THAT NO LONGER RETURNS IT.
   *
   * `items` is whatever the current term matched. Pick "White Cement", then type
   * "steel", and the chosen item drops out of the list — so the name shown would
   * blank out and the box would look empty while a value was still stored.
   * Remembered on the way past instead.
   */
  const lastLabel = useRef("");
  if (chosen) lastLabel.current = chosen.name;
  const chosenLabel = chosen?.name ?? (itemId ? lastLabel.current : "");

  const text = query ?? chosenLabel ?? "";
  const typed = (query ?? "").trim();

  /**
   * Offered only when the term matches nothing exactly, so the option does not
   * sit there restating an item the user has already found.
   */
  const exact = items.some((item) => item.name.toLowerCase() === typed.toLowerCase());
  const offerName = allowFreeText && typed !== "" && !exact;
  const rows = offerName ? items.length + 1 : items.length;

  const close = () => {
    setOpen(false);
    setQuery(null);
  };

  /**
   * WHERE THE LIST GOES ON SCREEN, because it cannot be laid out in place.
   *
   * The line grids sit inside `overflow-x-auto`, and an element that scrolls one
   * axis clips the other — so an absolutely-positioned list was cut off at the
   * bottom of the Products card. On line 1 that hid half the matches; on the
   * last line of an order it hid nearly all of them. Seen in the browser.
   *
   * So the list is portalled to `document.body` and positioned `fixed` against
   * the input's own rect, which no ancestor can clip. Re-measured on scroll and
   * resize — `true` for the capture phase, because the thing that scrolls is an
   * inner container and a bubbling listener on `window` never hears it.
   */
  const inputRef = useRef<HTMLInputElement>(null);
  const [box, setBox] = useState<{ left: number; width: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const measure = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      // 15rem of list plus its margin. Flipped above the field when that does
      // not fit below, so the last row of a long grid is not a stub.
      const needed = 256;
      const below = window.innerHeight - rect.bottom;
      setBox({
        left: rect.left,
        width: rect.width,
        top: below < needed && rect.top > below ? rect.top - needed : rect.bottom + 4,
      });
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  const pick = (index: number) => {
    if (offerName && index === items.length) {
      onTypeName?.(typed);
      close();
      return;
    }
    const item = items[index];
    if (!item) return;
    lastLabel.current = item.name;
    onPick(item.id, item.name);
    close();
  };

  /**
   * A line saved with a typed name shows that name, with a pencil to say it is
   * text rather than a reference. Otherwise a challan naming "Bardana bags"
   * would reopen showing an empty picker and lose it on the next save.
   */
  const showingTypedName = allowFreeText && !itemId && itemName.trim() !== "" && query === null;

  return (
    <div className={clsx("relative", className)}>
      <label htmlFor={inputId} className={labelHidden ? "sr-only" : LABEL_BASE}>
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-rose-500">
            *
          </span>
        )}
      </label>

      <div className={clsx("relative", !labelHidden && "mt-1")}>
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          aria-activedescendant={open && rows > 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder="Type to search items"
          value={showingTypedName ? itemName : text}
          onFocus={() => setOpen(true)}
          /*
           * CLICK REOPENS IT, and this is not the same event as focus.
           *
           * Picking an option closes the list and leaves the cursor in the box.
           * The box never lost focus, so clicking it again fires NO focus event
           * — with `onFocus` alone the list stayed shut and the only way back to
           * it was to tab away and return. Found by a test that picked a typed
           * name and then went looking for the real item.
           */
          onClick={() => setOpen(true)}
          onBlur={() => {
            // Long enough for a click on an option to land before the list goes.
            window.setTimeout(close, 150);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
            /*
             * Typing CLEARS the stored choice, so what is on screen and what
             * would be saved can never disagree. Both are cleared: a line that
             * had a typed name and is now being searched must not keep the name
             * alongside the item that gets picked.
             */
            if (itemId) onPick("", "");
            if (allowFreeText && itemName) onTypeName?.("");
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((index) => Math.min(index + 1, rows - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              // Enter inside a form would submit it; here it picks.
              if (open && rows > 0) {
                event.preventDefault();
                pick(active);
              }
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              // Stops here: the dialog behind must not close too.
              event.stopPropagation();
              close();
            }
          }}
          className={clsx(
            CONTROL_BASE,
            ringFor(error),
            "px-2.5 pr-8 disabled:bg-slate-50 disabled:text-slate-600",
          )}
        />
        {showingTypedName ? (
          <Pencil
            aria-hidden
            className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-amber-500"
          />
        ) : (
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          />
        )}
      </div>

      {open && !disabled && box && createPortal(
        /*
          NO `aria-label` HERE. It repeated the input's own label, so the field
          and its list of suggestions had the SAME accessible name and every
          query for one matched both — `getByLabelText(/item on line 2/i)` failed
          with "found multiple elements". The listbox is reached through the
          combobox's `aria-controls` and its options are announced from there, so
          naming it again bought nothing and cost the name's uniqueness.
          `aria-controls` still resolves across the portal: it is by id.
        */
        <ul
          id={listId}
          role="listbox"
          style={{ left: box.left, top: box.top, width: Math.max(box.width, 224) }}
          className="scroll-subtle fixed z-50 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-pop"
        >
          {options.isLoading && items.length === 0 && (
            <li className="px-3 py-2 text-slate-500">Searching…</li>
          )}

          {!options.isLoading && rows === 0 && (
            <li className="px-3 py-2 text-slate-500">
              {typed === "" ? "No items yet" : `No item matches "${typed}"`}
            </li>
          )}

          {items.map((item, index) => (
            <li
              key={item.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={item.id === itemId}
              // `onMouseDown`, not `onClick`: the input's blur fires first and
              // would close the list before a click could land.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(index);
              }}
              onMouseEnter={() => setActive(index)}
              className={clsx(
                "cursor-pointer px-3 py-2",
                index === active ? "bg-brand-50 text-brand-900" : "text-slate-700",
                item.id === itemId && "font-medium",
              )}
            >
              {item.name}
            </li>
          ))}

          {offerName && (
            <li
              id={`${listId}-${items.length}`}
              role="option"
              aria-selected={false}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(items.length);
              }}
              onMouseEnter={() => setActive(items.length)}
              className={clsx(
                "cursor-pointer border-t border-slate-100 px-3 py-2",
                active === items.length ? "bg-amber-50 text-amber-900" : "text-slate-600",
              )}
            >
              Use “{typed}” as a typed name
            </li>
          )}
        </ul>,
        document.body,
      )}

      {error && (
        <p id={`${inputId}-error`} className={clsx(MESSAGE_BASE, "font-medium text-rose-600")}>
          {error}
        </p>
      )}
    </div>
  );
}
