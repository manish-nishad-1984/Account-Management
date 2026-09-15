import { useId, useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { CONTROL_BASE, LABEL_BASE, MESSAGE_BASE, ringFor } from "../../components/ui/fields";

/**
 * Pick a site by typing part of its name.
 *
 * Asked for on 15 Sep 2026: "the user types, the matches show underneath, and
 * they select one". A native `<select>` cannot be typed into beyond its first
 * letter, and the site list is long enough that scrolling it is the slow part.
 *
 * Keyboard: arrows move through the matches, Enter picks, Escape closes. The
 * text box shows the chosen site's name once one is picked; typing again
 * reopens the list and clears the choice until another is made, so what is shown
 * and what will be saved can never disagree.
 */
export function SiteCombobox({
  sites,
  value,
  onChange,
  disabled,
  loading,
  error,
}: {
  sites: readonly { id: string; name: string }[];
  value: string | null;
  onChange: (siteId: string | null) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
}) {
  const listId = useId();
  const inputId = useId();
  const chosen = sites.find((site) => site.id === value) ?? null;

  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const text = query ?? chosen?.name ?? "";
  const matches = useMemo(() => {
    const term = (query ?? "").trim().toLowerCase();
    return term === "" ? sites : sites.filter((site) => site.name.toLowerCase().includes(term));
  }, [sites, query]);

  const pick = (siteId: string) => {
    onChange(siteId);
    setQuery(null);
    setOpen(false);
  };

  return (
    <div className="relative">
      <label htmlFor={inputId} className={LABEL_BASE}>
        Site <span className="text-rose-600">*</span>
      </label>
      <div className="relative mt-1">
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={error ? true : undefined}
          aria-activedescendant={open && matches[active] ? `${listId}-${matches[active]!.id}` : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={loading ? "Loading sites…" : "Type to search sites"}
          value={text}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Leave the list up long enough for a click on an option to land.
            window.setTimeout(() => {
              setOpen(false);
              setQuery(null);
            }, 150);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
            if (value !== null) onChange(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((index) => Math.min(index + 1, matches.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              // Enter inside a form would submit it; here it picks.
              if (open && matches[active]) {
                event.preventDefault();
                pick(matches[active]!.id);
              }
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}
          className={clsx(CONTROL_BASE, ringFor(error), "px-2.5 pr-8 disabled:bg-slate-50 disabled:text-slate-600")}
        />
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
        />
      </div>

      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          className="scroll-subtle absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-slate-500">No site matches "{query}"</li>
          ) : (
            matches.map((site, index) => (
              <li
                key={site.id}
                id={`${listId}-${site.id}`}
                role="option"
                aria-selected={site.id === value}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(site.id);
                }}
                onMouseEnter={() => setActive(index)}
                className={clsx(
                  "cursor-pointer px-3 py-2",
                  index === active ? "bg-brand-50 text-brand-900" : "text-slate-700",
                  site.id === value && "font-medium",
                )}
              >
                {site.name}
              </li>
            ))
          )}
        </ul>
      )}

      {error && (
        <p className={clsx(MESSAGE_BASE, "text-rose-600")} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
