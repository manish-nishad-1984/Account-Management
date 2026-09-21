import { Columns2, Maximize2, Square } from "lucide-react";
import clsx from "clsx";
import { useRecordLayout, type RecordLayout } from "../contexts/RecordLayoutContext";

/**
 * Switches between opening a record over the list, beside it, and instead of it.
 *
 * IN THE HEADER BECAUSE THE CHOICE IS THE WHOLE APPLICATION'S, not one screen's.
 * Putting it on a screen would invite twelve different answers, which is the
 * outcome this is meant to prevent.
 *
 * It is here to be USED and then removed. `19-Business-Decisions-Required.md`
 * asks the business which layout the port should have, and a written description
 * of three layouts is a poor way to ask; this lets someone who works the screens
 * daily flip between them on their own data and answer in a minute. Whichever
 * wins, the losers and this control go with it — a permanent toggle is three
 * layouts to maintain and a question nobody ever closes.
 *
 * IT SHIPS TO PRODUCTION, and briefly did not. The redesign brief asked for
 * presentation controls to be off the client-facing screen, so this was gated on
 * `import.meta.env.DEV` and dropped out of the built bundle. The client asked
 * for it back the same day (16 Sep 2026), which settles the question the gate
 * was hedging: the people who work these screens want to choose, and taking the
 * choice away to answer doc 19 removed the only thing that could answer it.
 *
 * So the gate is gone and the chosen layout is remembered per user, in local
 * storage. Doc 19 stays open — this is now how it gets answered, from what
 * people actually pick, rather than from a written description of three
 * layouts.
 */
const OPTIONS: { value: RecordLayout; label: string; hint: string; icon: typeof Square }[] = [
  {
    value: "modal",
    label: "Dialog",
    hint: "Open a record in a dialog over the list",
    icon: Square,
  },
  {
    value: "split",
    label: "Side by side",
    hint: "Open a record beside the list, as the old system does",
    icon: Columns2,
  },
  {
    value: "page",
    label: "Full page",
    hint: "Open a record in the page itself, with a back arrow to the list",
    icon: Maximize2,
  },
];

export function RecordLayoutPicker() {
  const { layout, setLayout } = useRecordLayout();

  return (
    <div
      role="radiogroup"
      aria-label="How records open"
      className="hidden h-9 items-center gap-0.5 rounded-lg bg-slate-50 p-1 ring-1 ring-inset ring-slate-200 sm:flex"
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = layout === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.hint}
            onClick={() => setLayout(option.value)}
            className={clsx(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500",
              active
                ? "bg-white text-brand-700 shadow-card ring-1 ring-inset ring-slate-200"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <Icon aria-hidden className={active ? "size-3.5 text-brand-600" : "size-3.5"} />
            <span className="hidden lg:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
