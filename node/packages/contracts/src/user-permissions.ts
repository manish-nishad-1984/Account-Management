import { z } from "zod";

/**
 * The user-wise permission matrix — `UserwiseFormPermission` in SQL Server, one
 * row per (user, form) with five boolean columns.
 *
 * This is the screen `/User/UserwisePermission` replaces, and it is the source of
 * every permission string the rest of the system checks: `permission(formName,
 * right)` turns "Supplier Invoice" + edit into `supplier-invoice.edit`.
 *
 * ROLE-BASED PERMISSIONS ARE NOT HERE, and their absence is deliberate. The
 * source has `UserRole` and `RolewiseFormPermission`, but `User.RoleId` is
 * `Guid?` while `UserRole.RoleId` and `RolewiseFormPermission.RoleId` are `int`
 * — they cannot join — and neither table is referenced anywhere in the 10,304
 * lines of the repository layer. Role permissions do not work today and never
 * have. Porting the dead tables would carry that forward as if it were a feature.
 */

export const RIGHT_COLUMNS = [
  "isViewAllow",
  "isAddAllow",
  "isEditAllow",
  "isDeleteAllow",
  "isApproved",
] as const;
export type RightColumn = (typeof RIGHT_COLUMNS)[number];

/** Column name to the right it grants, for rendering the matrix header. */
export const RIGHT_LABELS: Record<RightColumn, string> = {
  isViewAllow: "View",
  isAddAllow: "Add",
  isEditAllow: "Edit",
  isDeleteAllow: "Delete",
  isApproved: "Approve",
};

export const formPermissionSchema = z.object({
  formId: z.number().int(),
  isViewAllow: z.boolean(),
  isAddAllow: z.boolean(),
  isEditAllow: z.boolean(),
  isDeleteAllow: z.boolean(),
  isApproved: z.boolean(),
});
export type FormPermission = z.infer<typeof formPermissionSchema>;

/** One row of the matrix as the screen renders it — the form, plus the grants. */
export const formPermissionRowSchema = formPermissionSchema.extend({
  formName: z.string(),
  formGroup: z.string().nullable(),
  /**
   * The permission subject these booleans produce, e.g. "supplier-invoice".
   * Sent so the screen can show what it is actually granting rather than leaving
   * the reader to reproduce the slug rule in their head.
   */
  subject: z.string(),
});
export type FormPermissionRow = z.infer<typeof formPermissionRowSchema>;

export const userPermissionsSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  rows: z.array(formPermissionRowSchema),
});
export type UserPermissions = z.infer<typeof userPermissionsSchema>;

/**
 * A full replacement of one user's matrix, applied in a single transaction.
 *
 * Replacement rather than a diff, because the screen holds the whole matrix and
 * a diff would need optimistic concurrency to be safe. Rows with no rights at
 * all are deleted rather than stored as five falses, so `user_form_permissions`
 * says what someone HAS rather than what they were once considered for.
 */
export const saveUserPermissionsSchema = z.object({
  rows: z.array(formPermissionSchema).max(500),
});
export type SaveUserPermissions = z.infer<typeof saveUserPermissionsSchema>;

/**
 * A right that is granted without View is unreachable: the screen it applies to
 * cannot be opened, so the grant is either a mistake or a false record of what
 * someone can do. Both are worth refusing.
 *
 * Enforced on the server as well as auto-corrected in the matrix UI, because a
 * grant made by a direct API call is exactly the case the UI cannot cover.
 */
export const incoherentGrants = (rows: readonly FormPermission[]): number[] =>
  rows
    .filter(
      (row) =>
        !row.isViewAllow &&
        (row.isAddAllow || row.isEditAllow || row.isDeleteAllow || row.isApproved),
    )
    .map((row) => row.formId);

/** True when the row grants nothing, and so should not be stored at all. */
export const grantsNothing = (row: FormPermission): boolean =>
  !row.isViewAllow &&
  !row.isAddAllow &&
  !row.isEditAllow &&
  !row.isDeleteAllow &&
  !row.isApproved;
