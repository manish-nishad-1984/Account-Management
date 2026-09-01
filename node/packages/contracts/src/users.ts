import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";
import { emailAddress, mobileNo, requiredText, uuidId } from "./fields";

export const userRowSchema = z.object({
  id: z.string(),
  userName: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phoneNo: z.string(),
  isActive: z.boolean(),
  /**
   * True while this user's password is still the plaintext value carried over
   * from SQL Server. Surfaced deliberately: it turns the C-1 remediation into
   * something an administrator can see and chase, not a silent background state.
   */
  passwordIsLegacy: z.boolean(),
  siteCount: z.number().int().nonnegative(),
  capabilities: rowCapabilitiesSchema,
});
export type UserRow = z.infer<typeof userRowSchema>;

/**
 * The full record, for the edit form.
 *
 * There is no password field of any kind on the way OUT, hashed or otherwise.
 * The .NET app's user list returned `User.Password` in plaintext to the browser
 * (assessment C-1); nothing here returns the column in any form.
 */
export const userDetailSchema = z.object({
  id: z.string(),
  userName: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phoneNo: z.string(),
  isActive: z.boolean(),
  passwordIsLegacy: z.boolean(),
  /** Junction tables, replacing the CSV `User.SiteId` / `User.CompanyId`. */
  siteIds: z.array(z.string()),
  companyIds: z.array(z.string()),
});
export type UserDetail = z.infer<typeof userDetailSchema>;

/**
 * Password policy for administrator-set passwords.
 *
 * Twelve characters with three of the four character classes. The source has no
 * policy at all — `UserController` accepts any string and stores it in plaintext
 * — so there is nothing to preserve here and no reason to be timid.
 *
 * Length is weighted over composition deliberately: it is the only factor that
 * reliably resists an offline attack against the argon2id hash. The class rule
 * exists to stop `aaaaaaaaaaaa`, not to be the security.
 */
const CHARACTER_CLASSES = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(200, "Password must be at most 200 characters")
  .superRefine((value, ctx) => {
    const used = CHARACTER_CLASSES.filter((pattern) => pattern.test(value)).length;
    if (used < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Use at least three of: lower case, upper case, digits, symbols",
      });
    }
  });

/**
 * `userName` is matched case-insensitively at login and uniquely indexed on
 * `lower(user_name)`, so the format rule here only has to keep it typeable.
 */
export const userNameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(50)
  .regex(/^[A-Za-z0-9._-]+$/, "Username may use letters, digits, dot, underscore and hyphen");

export const createUserSchema = z.object({
  userName: userNameSchema,
  firstName: requiredText("First name", 100),
  lastName: requiredText("Last name", 100),
  email: emailAddress.refine((value) => value !== null, "Email is required"),
  phoneNo: mobileNo.refine((value) => value !== null, "Phone number is required"),
  /**
   * Set by an administrator and hashed with argon2id before it touches the
   * database. It is never stored, logged or returned — `password` is in the Pino
   * redaction list, and no read path selects the column.
   */
  password: passwordSchema,
  isActive: z.boolean().default(true),
  siteIds: z.array(uuidId).default([]),
  companyIds: z.array(uuidId).default([]),
});
export type CreateUser = z.infer<typeof createUserSchema>;

/**
 * The password on an update: absent means "leave it alone".
 *
 * `passwordSchema.optional()` is NOT enough, and the difference is the whole
 * reason this exists. An HTML input has no concept of absent — an untouched
 * password field submits `""`, not `undefined` — so the optional schema runs the
 * 12-character policy against the empty string and fails. The effect is that
 * editing a user without changing their password is impossible, and the error
 * points at a field the person never touched.
 *
 * So `""` is normalised to `undefined` first, and only a non-empty value is held
 * to the policy. The real messages are forwarded rather than collapsed into
 * "Invalid input", which is what a `z.union([z.literal(""), passwordSchema])`
 * would produce.
 */
const optionalPassword = z
  .string()
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .superRefine((value, ctx) => {
    if (value === undefined) return;
    const result = passwordSchema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message });
      }
    }
  });

/**
 * Update omits the password, then adds it back as optional. `.partial()` alone
 * would make "absent" and "clear it" the same request.
 */
export const updateUserSchema = createUserSchema
  .omit({ password: true })
  .partial()
  .extend({ password: optionalPassword });
export type UpdateUser = z.infer<typeof updateUserSchema>;

export const USER_SORT_FIELDS = ["userName", "firstName", "lastName", "email", "createdAt"] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];
