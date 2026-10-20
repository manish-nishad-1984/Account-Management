import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Check, Search } from "lucide-react";

/**
 * A SEARCH BOX IN EVERY DROPDOWN (client, 20 Oct 2026: "har ek drop down me
 * search dena hai").
 *
 * The application has some seventy `<select>`s — `SelectField` and a dozen bare
 * ones — and a browser's own list cannot be searched: a supplier among two
 * hundred is found by scrolling. Rewriting each into a custom control would mean
 * seventy changes and seventy chances to break a form.
 *
 * So the `<select>` stays exactly what it is — the value, the form, the label,
 * the keyboard, every test that picks an option — and this one layer, mounted
 * once at the root, takes over only the LIST: a click (or Space, Enter, F4,
 * Alt+Down, or simply typing) on any single-choice select opens a list of its
 * own options with a search box on top. Picking one sets the select's value and
 * fires its `change` event, so the screen's own `onChange` runs as if the
 * browser's list had been used.
 *
 * Left alone: a multi-select, a list box (`size` > 1), a disabled select, one
 * marked `data-native-select`, and touch screens, whose own picker is better
 * than anything drawn here.
 */
export function SelectSearchLayer() {
  const [open, setOpen] = useState<{ select: HTMLSelectElement; typed: string; seq: number } | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const select = event.target;
      if (event.button !== 0 || !searchable(select)) return;
      // No browser list: this one replaces it.
      event.preventDefault();
      select.focus();
      setOpen((current) => (current?.select === select ? null : { select, typed: "", seq: ++seq.current }));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const select = event.target;
      if (!searchable(select) || event.ctrlKey || event.metaKey) return;
      const opens =
        event.key === "F4" ||
        event.key === "Enter" ||
        event.key === " " ||
        (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp"));
      // A letter typed on a closed select starts the search with that letter.
      const typed = !event.altKey && event.key.length === 1 && event.key !== " " ? event.key : "";
      if (!opens && !typed) return;
      event.preventDefault();
      setOpen({ select, typed, seq: ++seq.current });
    };

    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  if (!open) return null;
  return (
    <SelectSearchList
      key={open.seq}
      select={open.select}
      typed={open.typed}
      onClose={(refocus) => {
        const { select } = open;
        // Only this one: a click on another select has already opened that one.
        setOpen((current) => (current?.select === select ? null : current));
        if (refocus && select.isConnected) select.focus();
      }}
    />
  );
}

function searchable(target: EventTarget | null): target is HTMLSelectElement {
  if (!(target instanceof HTMLSelectElement)) return false;
  if (target.multiple || target.size > 1 || target.disabled || target.dataset.nativeSelect !== undefined) return false;
  return !window.matchMedia?.("(pointer: coarse)").matches;
}

interface Choice {
  value: string;
  label: string;
  index: number;
}

/** Every word typed must appear in the label, in any order: "pipe al" finds "AL BURHAN PIPES". */
export function matchesSearch(label: string, search: string): boolean {
  const text = label.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

/** The select's value set as the browser's own list would set it: `input`, then `change`. */
function choose(select: HTMLSelectElement, value: string) {
  if (select.value === value) return;
  select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function SelectSearchList({
  select,
  typed,
  onClose,
}: {
  select: HTMLSelectElement;
  typed: string;
  onClose: (refocus: boolean) => void;
}) {
  const choices = useMemo<Choice[]>(
    () =>
      Array.from(select.options)
        .filter((option) => !option.disabled && !option.hidden)
        .map((option) => ({ value: option.value, label: option.text, index: option.index })),
    [select],
  );
  const [search, setSearch] = useState(typed);
  const shown = useMemo(() => choices.filter((choice) => matchesSearch(choice.label, search)), [choices, search]);
  const [active, setActive] = useState(() => Math.max(0, typed ? 0 : shown.findIndex((choice) => choice.value === select.value)));
  const list = useRef<HTMLUListElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = `${select.id || "select"}-search-list`;

  const pick = (choice: Choice | undefined) => {
    if (!choice) return;
    choose(select, choice.value);
    onClose(true);
  };

  // Where the list goes: under the select, or above it when it does not fit below.
  const [box, setBox] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      if (!select.isConnected) {
        onClose(false);
        return;
      }
      const rect = select.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const wanted = 320;
      const flip = below < Math.min(wanted, 200) && above > below;
      const maxHeight = Math.max(160, Math.min(wanted, flip ? above : below));
      const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 16);
      setBox({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: flip ? rect.top - 4 - maxHeight : rect.bottom + 4,
        width,
        maxHeight,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    // Capture: the thing that scrolls is usually a dialog, not the window.
    const onScroll = (event: Event) => {
      if (panel.current?.contains(event.target as Node)) return;
      measure();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [select]);

  useEffect(() => {
    input.current?.focus();
    if (typed) input.current?.setSelectionRange(typed.length, typed.length);

    // A click anywhere else closes it; a click on the select is the layer's toggle.
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || target === select) return;
      onClose(false);
    };
    // The value changed some other way — a test, a reset — so this list is stale.
    const onChange = () => onClose(false);
    // Window, capture: ahead of a dialog's own Escape, which would close the form.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
      } else if (event.key === "Tab" && panel.current?.contains(event.target as Node)) {
        // Back to the select, and Tab carries on from there to the next field.
        onClose(true);
      }
    };
    document.addEventListener("mousedown", onMouseDown, true);
    select.addEventListener("change", onChange);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      select.removeEventListener("change", onChange);
      window.removeEventListener("keydown", onKeyDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [select]);

  useEffect(() => {
    list.current?.querySelector(`[data-at="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, shown]);

  const label = select.labels?.[0]?.textContent?.replace(/\*$/, "").trim() || select.title || select.getAttribute("aria-label") || "options";

  return createPortal(
    <div
      ref={panel}
      style={box ? { left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight } : { visibility: "hidden" }}
      className="fixed z-[60] flex flex-col overflow-hidden rounded-lg bg-white shadow-pop ring-1 ring-slate-300"
    >
      <div className="relative border-b border-slate-200 p-1.5">
        <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
          aria-label={`Search ${label}`}
          autoComplete="off"
          placeholder="Type to search…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((at) => Math.min(at + 1, shown.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((at) => Math.max(at - 1, 0));
            } else if (event.key === "PageDown") {
              event.preventDefault();
              setActive((at) => Math.min(at + 8, shown.length - 1));
            } else if (event.key === "PageUp") {
              event.preventDefault();
              setActive((at) => Math.max(at - 8, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              pick(shown[active]);
            }
          }}
          className="block w-full rounded-md border-0 py-1.5 pl-7 pr-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>
      <ul ref={list} id={listId} role="listbox" aria-label={label} className="scroll-subtle min-h-0 flex-1 overflow-y-auto py-1 text-sm">
        {shown.length === 0 && <li className="px-3 py-2 text-slate-500">Nothing matches “{search.trim()}”</li>}
        {shown.map((choice, at) => {
          const chosen = choice.value === select.value;
          return (
            <li
              key={choice.index}
              id={`${listId}-${at}`}
              data-at={at}
              role="option"
              aria-selected={chosen}
              // mousedown, so the search box does not lose focus before the pick lands.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(choice);
              }}
              onMouseMove={() => setActive(at)}
              className={clsx(
                "flex cursor-pointer items-center gap-2 px-3 py-1.5",
                at === active ? "bg-brand-600 text-white" : chosen ? "bg-brand-100 font-medium text-brand-900" : "text-slate-700",
              )}
            >
              <span className="min-w-0 flex-1 truncate" title={choice.label}>
                {choice.label || " "}
              </span>
              {chosen && <Check aria-hidden className={clsx("size-3.5 shrink-0", at === active ? "text-white" : "text-brand-700")} />}
            </li>
          );
        })}
      </ul>
      {search.trim() !== "" && (
        <p className="border-t border-slate-100 px-3 py-1 text-[11px] text-slate-500">
          {shown.length} of {choices.length}
        </p>
      )}
    </div>,
    document.body,
  );
}
