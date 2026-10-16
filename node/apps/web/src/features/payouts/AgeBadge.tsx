import clsx from "clsx";
import { todayInput } from "../../lib/dates";

const MS_PER_DAY = 86_400_000;

/** A date as a UTC day number, so two dates differ by whole days whatever the clock or DST. */
const dayNumber = (isoDay: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay);
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY);
};

/**
 * How many whole days old a bill is: today (local) minus the bill's date. Null for
 * no date. Never negative: a bill dated ahead of today is 0 days old.
 */
export function ageInDays(documentDate: string | null | undefined, today: string = todayInput()): number | null {
  if (!documentDate) return null;
  const from = dayNumber(documentDate);
  const to = dayNumber(today);
  if (from === null || to === null) return null;
  return Math.max(0, to - from);
}

/** The colour of an age: green to 30 days, amber to 60, orange to 90, red beyond. */
export function ageTone(days: number): "green" | "amber" | "orange" | "red" {
  if (days <= 30) return "green";
  if (days <= 60) return "amber";
  if (days <= 90) return "orange";
  return "red";
}

const TONE: Record<ReturnType<typeof ageTone>, string> = {
  green: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-100 text-amber-800 ring-amber-200",
  orange: "bg-orange-100 text-orange-800 ring-orange-300",
  red: "bg-red-100 text-red-800 ring-red-200",
};

export const ageLabel = (days: number): string => (days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days`);

/**
 * "How long ago was this bill" beside a bill on the payout builder (client request,
 * 17 Oct 2026), as a badge whose colour deepens with age so the old ones stand out.
 */
export function AgeBadge({ documentDate }: { documentDate: string | null | undefined }) {
  const days = ageInDays(documentDate);
  if (days === null) return null;
  return (
    <span
      title={`Billed ${ageLabel(days).toLowerCase()}${days > 1 ? " ago" : ""}`}
      className={clsx(
        "ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        TONE[ageTone(days)],
      )}
    >
      {ageLabel(days)}
    </span>
  );
}
