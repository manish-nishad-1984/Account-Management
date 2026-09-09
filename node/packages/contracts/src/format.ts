/**
 * Display formatting for values that must never become JavaScript numbers.
 *
 * Money arrives as a decimal STRING — `numeric` in PostgreSQL, string through
 * Drizzle, string across the wire — and the reason is that a decimal amount put
 * into binary floating point stops being the amount. `Number("1234.56")` is not
 * 1234.56, and once a total has been through that it never recovers.
 *
 * So these format the digits themselves. Nothing here parses.
 *
 * WHY THIS SITS IN `contracts` RATHER THAN IN THE WEB APP, where it was born.
 *
 * The report exports render the same numbers as the screens, on the server. A
 * second copy of the grouping rule is how a sheet comes to disagree with the
 * grid it was exported from — and this repository has now found that same shape
 * of bug four times: two importers that disagree about their own column names
 * (§5o), three calculators that disagree about GST (finding B-2), two report
 * panels that disagree about one balance (finding D7), and a ledger whose own
 * footer is computed by different code from its rows (§5u).
 *
 * One implementation, imported by both runtimes. The web app re-exports these
 * from `lib/format.ts` so no screen had to change.
 */

/**
 * Groups the integer part the Indian way — last three digits, then pairs:
 * 1234567.89 renders as 12,34,567.89, not 1,234,567.89.
 *
 * This is not a stylistic choice. The business is Indian, the amounts are in
 * rupees, and a lakh grouped in thousands is misread at a glance by exactly the
 * people who use this system daily.
 */
function groupIndian(whole: string): string {
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + lastThree : lastThree;
}

export function formatMoney(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction] = unsigned.split(".");

  const decimals = (fraction ?? "").padEnd(2, "0").slice(0, 2);
  return `${negative ? "-" : ""}${groupIndian(whole)}.${decimals}`;
}

/**
 * A quantity, grouped like money but WITHOUT forced decimal places.
 *
 * Money always shows two — 10.00 is a price. A quantity does not: "10.00 Bag"
 * reads as a measurement taken to two decimals rather than ten bags, and the
 * column is scanned by people counting deliveries. So trailing zeros in the
 * fraction go, and a whole number renders whole: "10.00" -> "10", "2.50" ->
 * "2.5", "0.75" -> "0.75".
 *
 * Only the fraction is trimmed, never the integer part — the same trap
 * `formatPercent` documents, where a careless regex turns 10 into 1.
 */
export function formatQuantity(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction] = unsigned.split(".");

  const trimmed = (fraction ?? "").replace(/0+$/, "");
  return `${negative ? "-" : ""}${groupIndian(whole)}${trimmed ? `.${trimmed}` : ""}`;
}

/**
 * A percentage as stored — "18.00" becomes "18%", "18.50" stays "18.5%".
 *
 * Only the FRACTION is trimmed. The obvious one-liner for this,
 * `value.replace(/\.?0+$/, "")`, also eats trailing zeros off whole numbers:
 * it turns "10" into "1" and "100" into "1", so a 10% GST rate renders as 1%.
 * That stayed invisible because the API sends `numeric` as "18.00" and the
 * regex then matches the ".00" instead — the bug only appears the day a value
 * arrives without a decimal point. Guard on the point being there at all.
 */
export function formatPercent(value: string): string {
  const trimmed = value.includes(".")
    ? value.replace(/0+$/, "").replace(/\.$/, "")
    : value;
  return `${trimmed === "" ? "0" : trimmed}%`;
}

/**
 * A date for an EXPORTED FILE, as `dd-MM-yyyy`.
 *
 * Deliberately not the screen's format, and deliberately not
 * `toLocaleDateString`. Two reasons, both learned the hard way elsewhere in
 * this system:
 *
 * - It must match the legacy sheet, which writes `item.Date?.ToString(
 *   "dd-MM-yyyy")` in every one of its nine exporters. Someone reconciling a
 *   new export against an old one should not have to re-read dates.
 * - `toLocaleDateString("en-IN", …)` depends on the ICU data compiled into the
 *   running Node build. A small-icu server silently falls back to en-US and
 *   quietly writes American dates into a file nobody re-checks.
 *
 * The date part of an ISO timestamp is taken as written, WITHOUT constructing a
 * `Date`. `new Date("2026-04-01")` is midnight UTC, which in any timezone west
 * of Greenwich renders as 31 March — the off-by-one-day bug that reliably
 * appears in exports and never in the grid beside them.
 */
export function formatExportDate(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}
