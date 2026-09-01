/**
 * Display formatting for values that must never become JavaScript numbers.
 *
 * Money arrives as a decimal STRING — `numeric` in PostgreSQL, string through
 * Drizzle, string across the wire — and the reason is that a decimal amount put
 * into binary floating point stops being the amount. `Number("1234.56")` is not
 * 1234.56, and once a total has been through that it never recovers.
 *
 * So these format the digits themselves. Nothing here parses.
 */

/**
 * Groups the integer part the Indian way — last three digits, then pairs:
 * 1234567.89 renders as 12,34,567.89, not 1,234,567.89.
 *
 * This is not a stylistic choice. The business is Indian, the amounts are in
 * rupees, and a lakh grouped in thousands is misread at a glance by exactly the
 * people who use this system daily.
 */
export function formatMoney(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction] = unsigned.split(".");

  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest
    ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + lastThree
    : lastThree;

  const decimals = (fraction ?? "").padEnd(2, "0").slice(0, 2);
  return `${negative ? "-" : ""}${grouped}.${decimals}`;
}

/** A percentage as stored — "18.00" becomes "18%", "18.50" stays "18.5%". */
export function formatPercent(value: string): string {
  const trimmed = value.replace(/\.?0+$/, "");
  return `${trimmed === "" ? "0" : trimmed}%`;
}

/** An ISO timestamp as a plain Indian-format date. Empty for null. */
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
