/**
 * Bridging the gap between what a form holds and what a contract accepts.
 *
 * Every optional text field in `@accountmanagement/contracts` is
 * `string -> string | null`: it takes what the input gives it and turns "" into
 * null on the way through. So a Zod schema has two types, and forms need both:
 *
 *   z.input  — what the form holds. Strings, including "".
 *   z.output — what the API receives. Nulls where the field was left blank.
 *
 * `useForm<z.input<S>, unknown, z.output<S>>` types the two ends correctly and
 * `handleSubmit` hands over the transformed value, so no cast is needed anywhere.
 *
 * The helpers below cover the other direction — a fetched record, which holds
 * nulls, being loaded back into a form, which cannot. React logs
 * "changing an uncontrolled input to be controlled" and then stops tracking a
 * field whose value is null, so this conversion is not cosmetic.
 */

/** null and undefined become "", everything else is left alone. */
export const text = (value: string | null | undefined): string => value ?? "";

/**
 * An ISO timestamp becomes the `yyyy-mm-dd` that `<input type="date">` requires.
 * Any other format, including a full ISO string, renders as an empty date input
 * with no error — the failure is silent, which is why this exists.
 */
export const dateInput = (value: string | null | undefined): string =>
  value ? value.slice(0, 10) : "";
