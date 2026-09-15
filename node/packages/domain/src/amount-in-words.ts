import { decimal, round, type Decimal } from "./money.js";

/**
 * An amount written out in words, the Indian way: crore, lakh, thousand.
 *
 * Printed under the total on an invoice — "INR One Lakh Twenty Three Thousand
 * Four Hundred Fifty Six and Seventy Eight Paise Only".
 *
 * THE SOURCE HAS ONE (`InvoiceMasterController.NumberToWords`), and this is not
 * a copy of it, on purpose. What it does wrong, all of it visible on a printed
 * invoice:
 *
 *  - it joins parts with trailing and leading spaces both, so "Two Hundred  Five"
 *    carries a double space;
 *  - zero is "zero" in lower case among title-case words;
 *  - paise are read from `decimal - floor`, truncated rather than rounded, and
 *    spelt "paisa".
 *
 * The WORDS are the same — crore, lakh, thousand, hundred, no "and" between
 * hundreds and tens — so a printed invoice reads as it always has.
 *
 * Works from the money string, never a JavaScript number, like everything else
 * that touches money here.
 */

const UNITS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0–99, or nothing for 0. */
function belowHundred(value: bigint): string[] {
  if (value === 0n) return [];
  if (value < 20n) return [UNITS[Number(value)]!];
  const tens = TENS[Number(value / 10n)]!;
  const units = value % 10n;
  return units === 0n ? [tens] : [tens, UNITS[Number(units)]!];
}

/** 0–999, or nothing for 0. */
function belowThousand(value: bigint): string[] {
  const hundreds = value / 100n;
  return [
    ...(hundreds > 0n ? [UNITS[Number(hundreds)]!, "Hundred"] : []),
    ...belowHundred(value % 100n),
  ];
}

/**
 * A whole number in words. Crore repeats rather than going on to arab — a
 * hundred crore is "One Hundred Crore", which is how it is said and written.
 */
export function wholeNumberInWords(value: bigint): string {
  if (value < 0n) return `Minus ${wholeNumberInWords(-value)}`;
  if (value === 0n) return UNITS[0]!;

  const crore = value / 10_000_000n;
  const lakh = (value % 10_000_000n) / 100_000n;
  const thousand = (value % 100_000n) / 1_000n;
  const rest = value % 1_000n;

  return [
    ...(crore > 0n ? [wholeNumberInWords(crore), "Crore"] : []),
    ...(lakh > 0n ? [...belowHundred(lakh), "Lakh"] : []),
    ...(thousand > 0n ? [...belowHundred(thousand), "Thousand"] : []),
    ...belowThousand(rest),
  ].join(" ");
}

const PAISE_PER_RUPEE = 100n;
const WORKING_UNITS_PER_PAISA = 10_000n; // money.ts works in 10^-6

/**
 * "INR Twelve Thousand Five Hundred and Fifty Paise Only".
 *
 * Rounded half-up to the paisa first, so 10.005 reads as ten rupees and one
 * paisa rather than having its third decimal silently dropped.
 */
export function amountInWords(amount: string | Decimal, currency = "INR"): string {
  const exact = typeof amount === "bigint" ? amount : decimal(amount);
  const paiseTotal = round(exact, 2) / WORKING_UNITS_PER_PAISA;
  const negative = paiseTotal < 0n;
  const magnitude = negative ? -paiseTotal : paiseTotal;

  const rupees = magnitude / PAISE_PER_RUPEE;
  const paise = magnitude % PAISE_PER_RUPEE;

  const words = [
    currency,
    ...(negative ? ["Minus"] : []),
    wholeNumberInWords(rupees),
    ...(paise > 0n ? ["and", ...belowHundred(paise), "Paise"] : []),
    "Only",
  ];
  return words.join(" ");
}
