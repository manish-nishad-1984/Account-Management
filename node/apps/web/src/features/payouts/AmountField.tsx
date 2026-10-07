import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { TextField } from "../../components/ui";

/**
 * Digits grouped the Indian way as they are typed: 1,25,000.50 (client request,
 * 7 Oct 2026). Only the whole-number part is grouped; a trailing point and any
 * decimals are left exactly as typed, so "100." and "100.5" do not jump.
 */
export function groupAmount(raw: string): string {
  if (raw === "") return "";
  const point = raw.indexOf(".");
  const whole = point === -1 ? raw : raw.slice(0, point);
  const rest = point === -1 ? "" : raw.slice(point);
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  const grouped = head === "" ? tail : `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${tail}`;
  return `${negative ? "-" : ""}${grouped}${rest}`;
}

/** What a pasted figure carries ("Rs 1,25,000") reduced to digits and a point. */
export const rawAmount = (value: string) => value.replace(/[,\s₹]/g, "");

type Props = Omit<ComponentProps<typeof TextField>, "value" | "onChange"> & {
  /** The plain figure ("125000.50"), as it is held and sent. */
  value: string;
  /** Called with the plain figure, never the grouped text. */
  onValue: (raw: string) => void;
};

/**
 * A money box that SHOWS commas and HOLDS none.
 *
 * The field's value stays a plain decimal string end to end (money is never a
 * float here), and the grouping exists only in what is drawn. Typing into the
 * middle of a grouped figure would normally throw the caret to the end when the
 * commas are redrawn, so the caret is put back after the same number of digits.
 */
export function AmountField({ value, onValue, ...rest }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const digitsBeforeCaret = useRef<number | null>(null);
  const shown = groupAmount(value);

  useLayoutEffect(() => {
    const element = input.current;
    const wanted = digitsBeforeCaret.current;
    if (!element || wanted === null) return;
    digitsBeforeCaret.current = null;
    let seen = 0;
    let position = 0;
    while (position < shown.length && seen < wanted) {
      if (shown[position] !== ",") seen += 1;
      position += 1;
    }
    element.setSelectionRange(position, position);
  }, [shown]);

  return (
    <TextField
      {...rest}
      ref={input}
      value={shown}
      onChange={(event) => {
        const element = event.currentTarget;
        const caret = element.selectionStart ?? element.value.length;
        digitsBeforeCaret.current = rawAmount(element.value.slice(0, caret)).length;
        onValue(rawAmount(element.value));
      }}
    />
  );
}
