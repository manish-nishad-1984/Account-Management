import { Columns2, Square } from "lucide-react";
import clsx from "clsx";
import { useRecordLayout, type RecordLayout } from "../contexts/RecordLayoutContext";

/**
 * Switches between opening a record over the list and beside it.
 *
 * IN THE HEADER BECAUSE THE CHOICE IS THE WHOLE APPLICATION'S, not one screen's.
 * Putting it on a screen would invite twelve different answers, which is the
 * outcome this is meant to prevent.
 *
 * It is here to be USED and then removed. `19-Business-Decisions-Required.md`
 * asks the business which layout the port should have, and a written description
 * of two layouts is a poor way to ask; this lets someone who works the screens
 * daily flip between them on their own data and answer in a minute. Whichever
 * wins, the loser and this control go with it — a permanent toggle is two
 * layouts to maintain and a question nobody ever closes.
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
];

export function RecordLayoutPicker() {
  const { layout, setLayout } = useRecordLayout();

  return (
    <div
      role="radiogroup"
      aria-label="How records open"
      className="hidden items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 ring-1 ring-inset ring-slate-200 sm:flex"
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
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500",
              active
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            <span className="hidden lg:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
