import { z } from "zod";

/**
 * Field-level validators shared by every write endpoint.
 *
 * These exist because the .NET API performed NO server-side validation of any
 * kind — models were bound straight from the request and persisted as sent
 * (assessment §5.2). The Razor views carried some jQuery rules, so the format
 * checks below are not new policy; they are the browser's existing rules moved
 * to where they cannot be bypassed by calling the API directly.
 *
 * They apply to WRITES ONLY. Reads never re-validate stored data: production
 * holds rows that predate any rule, and a list endpoint that refuses to render a
 * badly-formatted GST number is worse than one that shows it.
 */

/** Trims, then treats "" as absent. HTML inputs submit "" for an empty field. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null);

export const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max);

/**
 * GSTIN — 15 characters: 2-digit state code, 10-character PAN, 1 entity digit,
 * a literal Z, 1 check character. Upper-cased before checking, because the form
 * lets people type lower case and rejecting that would be pedantry.
 */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

export const gstNo = optionalText(15).superRefine((value, ctx) => {
  if (value !== null && !GSTIN_PATTERN.test(value.toUpperCase())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "GST number must be 15 characters, e.g. 24AACD1234A1Z5",
    });
  }
});

/** PAN — 5 letters, 4 digits, 1 letter. */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const panNo = optionalText(10).superRefine((value, ctx) => {
  if (value !== null && !PAN_PATTERN.test(value.toUpperCase())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "PAN must be 10 characters, e.g. AAACD1234A",
    });
  }
});

/** Indian PIN code — six digits, never starting at zero. */
export const pincode = optionalText(6).superRefine((value, ctx) => {
  if (value !== null && !/^[1-9][0-9]{5}$/.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "PIN code must be 6 digits" });
  }
});

/**
 * IFSC — 4 letters, a literal 0, then 6 alphanumerics. The source column is
 * misspelled `Iffccode`; the value in it is an IFSC.
 */
export const ifscCode = optionalText(11).superRefine((value, ctx) => {
  if (value !== null && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(value.toUpperCase())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "IFSC must be 11 characters, e.g. HDFC0001234",
    });
  }
});

/**
 * Indian mobile number — 10 digits starting 6-9. Spaces, hyphens and a +91 or 0
 * prefix are stripped first, because that is how people paste them.
 */
export const mobileNo = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, "").replace(/^(\+91|0)/, ""))
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional()
  .transform((value) => value ?? null)
  .superRefine((value, ctx) => {
    if (value !== null && !/^[6-9][0-9]{9}$/.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Mobile number must be 10 digits starting 6-9",
      });
    }
  });

export const emailAddress = optionalText(200).superRefine((value, ctx) => {
  if (value !== null && !z.string().email().safeParse(value).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid email address" });
  }
});

/** HSN / SAC code — 4, 6 or 8 digits. */
export const hsnCode = optionalText(8).superRefine((value, ctx) => {
  if (value !== null && !/^([0-9]{4}|[0-9]{6}|[0-9]{8})$/.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "HSN code must be 4, 6 or 8 digits" });
  }
});

/**
 * Money, as a decimal STRING — never a number.
 *
 * `numeric` columns come back from Drizzle as strings and go in as strings, and
 * they stay strings for the whole round trip. Parsing to a JavaScript number
 * anywhere in the middle reintroduces binary floating point on values that are
 * decimal by definition, which is how a total ends up at 1234.5600000000001.
 *
 * This is the one place the migration can close finding B-2 cheaply: today every
 * amount is computed by jQuery and persisted as whatever the browser sent.
 */
const MONEY_PATTERN = /^-?\d{1,15}(\.\d{1,2})?$/;

export const money = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .regex(MONEY_PATTERN, `${label} must be an amount with at most 2 decimal places`);

export const optionalMoney = (label: string) =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null)
    .superRefine((value, ctx) => {
      if (value !== null && !MONEY_PATTERN.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be an amount with at most 2 decimal places`,
        });
      }
    });

/**
 * A quantity, as a decimal STRING — for exactly the reason `money` is one. A
 * quantity is decimal by definition (2.5 tonnes, 0.75 hours) and rounding it
 * through binary floating point is the same defect as rounding a price.
 *
 * Must be greater than zero. Requesting none of something is not a request, and
 * a negative quantity would flow into a purchase order as a credit nobody
 * intended. The check is against the digits rather than `Number(value) > 0` so
 * that the value is never parsed to a float, not even to compare it.
 */
const QUANTITY_PATTERN = /^\d{1,15}(\.\d{1,2})?$/;

export const quantity = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .regex(QUANTITY_PATTERN, `${label} must be a number with at most 2 decimal places`)
    .refine((value) => /[1-9]/.test(value), `${label} must be greater than zero`);

/** A percentage, 0 to 100, with at most 2 decimal places. Also a string. */
export const optionalPercent = (label: string) =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null)
    .superRefine((value, ctx) => {
      if (value === null) return;
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(value) || Number(value) > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be between 0 and 100`,
        });
      }
    });

export const uuidId = z.string().uuid("Not a valid identifier");

/**
 * A geography reference — city, state or country.
 *
 * Stays a bare integer with no foreign key, matching the schema. The lookup
 * tables have not been extracted and the orphan volume across them is unmeasured
 * (assessment blocker 1), so this validates shape and nothing more.
 */
export const geographyId = z.coerce
  .number()
  .int()
  .positive()
  .nullable()
  .optional()
  .transform((value) => value ?? null);

/** An ISO date the browser's `<input type="date">` produces, or nothing. */
export const optionalDate = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional()
  .transform((value) => value ?? null)
  .superRefine((value, ctx) => {
    if (value !== null && Number.isNaN(Date.parse(value))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid date" });
    }
  });
