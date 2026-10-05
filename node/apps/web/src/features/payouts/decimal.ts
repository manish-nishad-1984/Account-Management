/**
 * Exact money arithmetic for the payout screens, on whole PAISE held in a BigInt.
 *
 * A list total is added up in the browser while the person ticks, and it is the
 * number the owner reads out ("40 lakh"). `Number.parseFloat("0.1") + 0.2` is
 * 0.30000000000000004, and a 15-digit rupee amount with paise does not even fit
 * a double - so nothing here ever becomes a JavaScript number.
 */

const AMOUNT = /^\d{1,15}(\.\d{1,2})?$/;

/** Whole paise for "1250.5", or null when it is not an amount the contract accepts. */
export function toPaise(value: string): bigint | null {
  const trimmed = value.trim();
  if (!AMOUNT.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

/** "1250.50" from paise. The inverse of `toPaise`, always with two decimals. */
export function fromPaise(paise: bigint): string {
  const negative = paise < 0n;
  const magnitude = negative ? -paise : paise;
  const whole = magnitude / 100n;
  const fraction = (magnitude % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Sum of decimal strings; a value that is not an amount counts as nothing. */
export function sumAmounts(values: readonly string[]): string {
  return fromPaise(values.reduce((sum, value) => sum + (toPaise(value) ?? 0n), 0n));
}
