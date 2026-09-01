import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../db/database";
import {
  forms,
  refreshTokens,
  userCompanies,
  userFormPermissions,
  users,
  userSites,
} from "../../db/schema";
import {
  UserRepository,
  type AuthUser,
  type StoredRefreshToken,
} from "./user.repository";

/**
 * PostgreSQL-backed UserRepository.
 *
 * Permission strings are derived from the per-form boolean columns the .NET
 * schema already uses, so `invoice.view` means "there is a user_form_permissions
 * row for this user and the Invoice form with is_view_allow = true". That keeps
 * the existing permission data meaningful without inventing a new model the
 * business has not agreed to.
 */
@Injectable()
export class DrizzleUserRepository extends UserRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {
    super();
  }

  async findByUserName(userName: string): Promise<AuthUser | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(
        and(sql`lower(${users.userName}) = lower(${userName})`, eq(users.isDeleted, false)),
      )
      .limit(1);

    return row ? this.hydrate(row) : null;
  }

  async findById(userId: string): Promise<AuthUser | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isDeleted, false)))
      .limit(1);

    return row ? this.hydrate(row) : null;
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .update(users)
      .set({
        password: passwordHash,
        passwordIsLegacy: false,
        passwordMigratedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async saveRefreshToken(token: StoredRefreshToken): Promise<void> {
    await this.db.insert(refreshTokens).values({
      tokenHash: token.tokenHash,
      userId: token.userId,
      expiresAt: token.expiresAt,
      revokedAt: token.revokedAt,
    });
  }

  async findRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!row) {
      return null;
    }
    return {
      tokenHash: row.tokenHash,
      userId: row.userId,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash));
  }

  async revokeAllRefreshTokensForUser(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), sql`${refreshTokens.revokedAt} is null`));
  }

  private async hydrate(row: typeof users.$inferSelect): Promise<AuthUser> {
    const [permissionRows, siteRows, companyRows] = await Promise.all([
      this.db
        .select({
          formName: forms.formName,
          controller: forms.controller,
          isViewAllow: userFormPermissions.isViewAllow,
          isAddAllow: userFormPermissions.isAddAllow,
          isEditAllow: userFormPermissions.isEditAllow,
          isDeleteAllow: userFormPermissions.isDeleteAllow,
          isApproved: userFormPermissions.isApproved,
        })
        .from(userFormPermissions)
        .innerJoin(forms, eq(forms.id, userFormPermissions.formId))
        .where(and(eq(userFormPermissions.userId, row.id), eq(forms.isActive, true))),
      this.db
        .select({ siteId: userSites.siteId })
        .from(userSites)
        .where(eq(userSites.userId, row.id)),
      this.db
        .select({ companyId: userCompanies.companyId })
        .from(userCompanies)
        .where(eq(userCompanies.userId, row.id)),
    ]);

    const permissions: string[] = [];
    for (const p of permissionRows) {
      const subject = slug(p.controller ?? p.formName);
      if (p.isViewAllow) permissions.push(`${subject}.view`);
      if (p.isAddAllow) permissions.push(`${subject}.add`);
      if (p.isEditAllow) permissions.push(`${subject}.edit`);
      if (p.isDeleteAllow) permissions.push(`${subject}.delete`);
      if (p.isApproved) permissions.push(`${subject}.approve`);
    }

    return {
      id: row.id,
      userName: row.userName,
      isActive: row.isActive,
      password: row.password,
      permissions,
      siteIds: siteRows.map((s) => s.siteId),
      companyIds: companyRows.map((c) => c.companyId),
    };
  }
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
