import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import {
  grantsNothing,
  incoherentGrants,
  permission,
  type FormPermission,
  type UserPermissions,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { forms, userFormPermissions, users } from "../../db/schema";
import { BaseRepository } from "../../common/base.repository";

/**
 * The user-wise permission matrix.
 *
 * `UserwiseFormPermission` is the ONLY permission mechanism that works in the
 * source system. `UserRole` and `RolewiseFormPermission` exist but cannot be
 * joined — `User.RoleId` is `Guid?` against their `int` — and neither is
 * referenced anywhere in the repository layer. This repository therefore covers
 * all of it, which is a smaller surface than the schema suggests.
 */
@Injectable()
export class UserPermissionsRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /**
   * Every ACTIVE form, left-joined to what this user has been granted.
   *
   * A left join, not an inner one: a form the user has no row for must still
   * appear, unticked, or the screen can only ever remove rights and never add
   * them. Inactive forms are excluded — they are excluded from permission
   * derivation at login too, so showing them here would offer grants that do
   * nothing.
   */
  async findForUser(userId: string): Promise<UserPermissions> {
    const [user] = await this.db
      .select({ id: users.id, userName: users.userName })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isDeleted, false)))
      .limit(1);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const rows = await this.db
      .select({
        formId: forms.id,
        formName: forms.formName,
        formGroup: forms.formGroup,
        isViewAllow: userFormPermissions.isViewAllow,
        isAddAllow: userFormPermissions.isAddAllow,
        isEditAllow: userFormPermissions.isEditAllow,
        isDeleteAllow: userFormPermissions.isDeleteAllow,
        isApproved: userFormPermissions.isApproved,
      })
      .from(forms)
      .leftJoin(
        userFormPermissions,
        and(eq(userFormPermissions.formId, forms.id), eq(userFormPermissions.userId, userId)),
      )
      .where(eq(forms.isActive, true))
      .orderBy(asc(forms.orderId), asc(forms.formName));

    return {
      userId: user.id,
      userName: user.userName,
      rows: rows.map((row) => ({
        formId: row.formId,
        formName: row.formName,
        formGroup: row.formGroup,
        // The subject the booleans produce, so the screen can show what it is
        // granting rather than leaving the reader to apply the slug rule mentally.
        subject: permission(row.formName, "view").replace(/\.view$/, ""),
        isViewAllow: row.isViewAllow ?? false,
        isAddAllow: row.isAddAllow ?? false,
        isEditAllow: row.isEditAllow ?? false,
        isDeleteAllow: row.isDeleteAllow ?? false,
        isApproved: row.isApproved ?? false,
      })),
    };
  }

  /**
   * Replaces the whole matrix for one user, in a single transaction.
   *
   * Three rules, in order:
   *
   *  1. A right granted without View is refused. It is unreachable — the screen
   *     it applies to cannot be opened — so it is either a mistake or a false
   *     record of what someone can do. The matrix UI auto-ticks View to prevent
   *     it; this catches the direct API call the UI cannot cover.
   *  2. Rows granting nothing are not stored. `user_form_permissions` then says
   *     what a user HAS, rather than what they were once considered for.
   *  3. Delete-then-insert inside the transaction, so the intermediate state
   *     where the user has no permissions at all is never observable. Doing this
   *     without a transaction is how a failed save leaves an administrator
   *     locked out of the screen they were editing.
   */
  async replaceForUser(
    userId: string,
    rows: readonly FormPermission[],
    actorId: string,
  ): Promise<UserPermissions> {
    const unreachable = incoherentGrants(rows);
    if (unreachable.length > 0) {
      throw new BadRequestException({
        message:
          "Add, Edit, Delete and Approve each need View as well — without it the screen cannot be opened",
        issues: unreachable.map((formId) => ({
          path: `rows.${formId}.isViewAllow`,
          message: "View is required when any other right is granted",
        })),
      });
    }

    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isDeleted, false)))
      .limit(1);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const meaningful = rows.filter((row) => !grantsNothing(row));

    await this.db.transaction(async (tx) => {
      await tx.delete(userFormPermissions).where(eq(userFormPermissions.userId, userId));

      if (meaningful.length > 0) {
        await tx.insert(userFormPermissions).values(
          meaningful.map((row) => ({
            userId,
            formId: row.formId,
            isViewAllow: row.isViewAllow,
            isAddAllow: row.isAddAllow,
            isEditAllow: row.isEditAllow,
            isDeleteAllow: row.isDeleteAllow,
            isApproved: row.isApproved,
          })),
        );
      }

      // The grant itself is not audited per row — `user_form_permissions` has no
      // updated_by — so the change is recorded against the user instead. Losing
      // who changed a permission is exactly the kind of thing an audit asks for.
      await tx
        .update(users)
        .set({ updatedBy: actorId, updatedAt: new Date() })
        .where(eq(users.id, userId));
    });

    return this.findForUser(userId);
  }
}
