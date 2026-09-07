/**
 * Fixed-point decimal arithmetic for money and quantities.
 *
 * Money is a STRING everywhere in this system — `numeric` in PostgreSQL, a
 * string through Drizzle, a string on the wire, a string in the form. It is
 * never a JavaScript number, because a JavaScript number cannot hold 0.1 + 0.2.
 * These helpers are the only place a money value is arithmetic rather than text,
 * and they work in BigInt, so nothing is ever approximate.
 *
 * The legacy application does the opposite: every total is computed in browser
 * IEEE-754 doubles and `.toFixed(2)`, then parsed back into SQL `decimal`. See
 * `invoice-total.ts` for what that costs and how it is reproduced.
 */

/**
 * Internal working scale — six decimal places.
 *
 * A line's GST is `price x quantity x percent / 100`. Price and quantity carry
 * two decimals each and the percentage two more, so an exact product needs six
 * before it is rounded back to two. Working at two throughout would round three
 * times per line instead of once.
 */
const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);

/** A decimal held exactly, as an integer count of 10^-6. */
export type Decimal = bigint;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * Parses "1234.56" into an exact Decimal.
 *
 * Throws on anything that is not a plain decimal. It does NOT accept "1,234.56":
 * grouped digits are a display concern, and silently parsing them is how a
 * locale-formatted string becomes a wrong number rather than an error.
 */
export function decimal(value: string | number | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return 0n;

  const text = typeof value === "number" ? String(value) : value.trim();
  if (!DECIMAL_PATTERN.test(text)) {
    throw new TypeError(`Not a decimal: ${JSON.stringify(value)}`);
  }

  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  // Pad or truncate the fraction to the working scale. Truncation loses nothing
  // in practice: no input to this system carries more than four decimals.
  const scaled = (fraction + "0".repeat(SCALE)).slice(0, SCALE);
  const magnitude = BigInt(whole + scaled);
  return negative ? -magnitude : magnitude;
}

export const add = (a: Decimal, b: Decimal): Decimal => a + b;
export const subtract = (a: Decimal, b: Decimal): Decimal => a - b;
export const multiply = (a: Decimal, b: Decimal): Decimal => (a * b) / FACTOR;
export const sum = (values: Decimal[]): Decimal => values.reduce((a, b) => a + b, 0n);

/** `a` as a percentage of `b` — i.e. `b * a / 100`. */
export const percentOf = (percent: Decimal, base: Decimal): Decimal =>
  (base * percent) / (100n * FACTOR);

/**
 * HALF-UP rounding to `places`, away from zero on a tie.
 *
 * Half-up is what Indian commercial practice expects and what `Math.Round`'s
 * `MidpointRounding.AwayFromZero` does. It is NOT JavaScript's `.toFixed`, which
 * rounds on the binary representation and so turns 1.005 into "1.00".
 */
export function round(value: Decimal, places = 2): Decimal {
  if (places >= SCALE) return value;
  const step = 10n ** BigInt(SCALE - places);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const remainder = magnitude % step;
  const rounded = remainder * 2n >= step ? magnitude - remainder + step : magnitude - remainder;
  return negative ? -rounded : rounded;
}

/** Renders a Decimal as a plain string with exactly `places` decimals. */
export function format(value: Decimal, places = 2): string {
  const rounded = round(value, places);
  const negative = rounded < 0n;
  const magnitude = negative ? -rounded : rounded;

  const whole = magnitude / FACTOR;
  const fraction = (magnitude % FACTOR).toString().padStart(SCALE, "0").slice(0, places);

  const sign = negative && (whole !== 0n || fraction.replace(/0/g, "") !== "") ? "-" : "";
  return places === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

export const isZero = (value: Decimal): boolean => value === 0n;
export const compare = (a: Decimal, b: Decimal): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The legacy grand-total round-off, reproduced exactly.
 *
 * `InvoiceMasterScript.js:1005` and `SalesInvoiceMasterScript.js:381`:
 *
 *     var decimal = grandTotal - Math.floor(grandTotal);
 *     grandTotal = (decimal <= 0.5) ? Math.floor(grandTotal) : Math.ceil(grandTotal);
 *
 * Two things follow that are worth stating out loud, because no document in the
 * assessment records them:
 *
 *  1. EVERY INVOICE TOTAL IS A WHOLE RUPEE. The paise are discarded on every
 *     document the system has ever issued.
 *  2. EXACTLY .50 ROUNDS DOWN. Commercial rounding rounds .50 up; this rounds it
 *     down, so a total of 1234.50 is charged as 1234. Always in the counterparty's
 *     favour, never in the company's.
 *
 * This is a BUSINESS RULE, not a bug to fix silently — it has been applied to
 * every issued invoice and changing it changes what customers are charged.
 * Question 1 of 19-Business-Decisions-Required.md is the one that settles it.
 */
export function roundToWholeRupeeAsProduced(value: Decimal): Decimal {
  const floor =
    value >= 0n ? (value / FACTOR) * FACTOR : ((value - (FACTOR - 1n)) / FACTOR) * FACTOR;
  const fraction = value - floor;
  // `<= 0.50` in the original, so the tie goes DOWN.
  return fraction * 2n <= FACTOR ? floor : floor + FACTOR;
}
