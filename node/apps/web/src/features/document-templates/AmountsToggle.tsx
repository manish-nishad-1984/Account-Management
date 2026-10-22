import clsx from "clsx";

/** "With amounts" or "Without amounts", for a purchase order's preview and print (client, 22 Oct 2026). */
export function AmountsToggle({ showAmounts, onChange }: { showAmounts: boolean; onChange: (show: boolean) => void }) {
  const option = (show: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={showAmounts === show}
      onClick={() => onChange(show)}
      className={clsx(
        "px-2.5 py-1 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md",
        showAmounts === show ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Amounts" className="inline-flex rounded-md ring-1 ring-inset ring-slate-300">
      {option(true, "With amounts")}
      {option(false, "Without amounts")}
    </div>
  );
}
