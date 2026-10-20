/**
 * The date ranges people actually ask for, one click each. Financial years run
 * 1 April to 31 March. Days are `yyyy-mm-dd` in local time.
 */
export const DATE_PRESETS = [
  { key: "fy", label: "This FY" },
  { key: "lastFy", label: "Last FY" },
  { key: "month", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "all", label: "All dates" },
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number]["key"];

const day = (year: number, monthIndex: number, date: number): string => {
  const at = new Date(year, monthIndex, date);
  const mm = String(at.getMonth() + 1).padStart(2, "0");
  const dd = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${mm}-${dd}`;
};

export function presetDates(preset: DatePreset, today: Date): { fromDate: string; toDate: string } {
  const year = today.getFullYear();
  const month = today.getMonth();
  const fyStart = month >= 3 ? year : year - 1;
  switch (preset) {
    case "fy":
      return { fromDate: day(fyStart, 3, 1), toDate: day(fyStart + 1, 2, 31) };
    case "lastFy":
      return { fromDate: day(fyStart - 1, 3, 1), toDate: day(fyStart, 2, 31) };
    case "month":
      return { fromDate: day(year, month, 1), toDate: day(year, month + 1, 0) };
    case "lastMonth":
      return { fromDate: day(year, month - 1, 1), toDate: day(year, month, 0) };
    case "all":
      return { fromDate: "", toDate: "" };
  }
}

/** The preset the dates are, if they are one — so its chip shows as chosen. */
export function presetOf(fromDate: string, toDate: string, today: Date): DatePreset | null {
  return DATE_PRESETS.find(({ key }) => {
    const range = presetDates(key, today);
    return range.fromDate === fromDate && range.toDate === toDate;
  })?.key ?? null;
}

/** `2026-04-01` as `01-04-2026`, the way every sheet writes a date. */
export const showDay = (value: string): string => (value ? value.split("-").reverse().join("-") : "");

export function describeRange(fromDate: string, toDate: string): string {
  if (fromDate && toDate) return `${showDay(fromDate)} to ${showDay(toDate)}`;
  if (fromDate) return `From ${showDay(fromDate)}`;
  if (toDate) return `Up to ${showDay(toDate)}`;
  return "All dates";
}
