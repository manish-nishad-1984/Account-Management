/**
 * Display formatting for values that must never become JavaScript numbers.
 *
 * THE RULES THEMSELVES MOVED TO `@accountmanagement/contracts` (`format.ts`)
 * when the report exports were built, because the server now renders the same
 * numbers into the same files, and a second copy of the grouping rule is how a
 * sheet comes to disagree with the grid it was exported from.
 *
 * They are re-exported here, unchanged, so every screen and every test that
 * imports from `lib/format` keeps working and there is still one obvious place
 * to look. Read the contracts file for why each rule is what it is — including
 * the regex that turns 10% into 1%, and why nothing here parses.
 */
export { formatMoney, formatPercent, formatQuantity } from "@accountmanagement/contracts";

/**
 * An ISO timestamp as a plain Indian-format date, for the SCREEN.
 *
 * This one stays in the browser, and the difference is the point: it renders
 * `09 Sep 2026` for a person reading a grid, using the browser's own locale
 * data. Exported files use `formatExportDate` from contracts instead, which
 * writes `09-09-2026` to match the legacy sheets and does not depend on the ICU
 * data compiled into whatever Node happens to run the server.
 */
export function formatDate(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
