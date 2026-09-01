import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import type {
  CreateUser,
  ListQuery,
  SortDirection,
  UpdateUser,
  UserDetail,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { companies, sites, userCompanies, users, userSites } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";
import { PasswordService } from "../auth/password.service";

const SORTABLE = {
  userName: users.userName,
  firstName: users.firstName,
  lastName: users.lastName,
  email: users.email,
  createdAt: users.createdAt,
} as const;

export type UserSortKey = keyof typeof SORTABLE;

export interface UserListRow {
  id: string;
  userName: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNo: string;
  isActive: boolean;
  passwordIsLegacy: boolean;
  siteCount: number;
}

@Injectable()
export class UsersRepository extends BaseRepository {
  constructor(
    @Inject(DATABASE) database: Database | null,
    private readonly passwords: PasswordService,
  ) {
    super(database);
  }

  async list(query: ListQuery): Promise<{ rows: UserListRow[]; nextCursor: string | null }> {
    const sortKey: UserSortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as UserSortKey) : "userName";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const filters = [eq(users.isDeleted, false)];
    if (query.search) {
      const pattern = `%${query.search}%`;
      const match = or(
        ilike(users.userName, pattern),
        ilike(users.firstName, pattern),
        ilike(users.lastName, pattern),
        ilike(users.email, pattern),
      );
      if (match) {
        filters.push(match);
      }
    }

    const seek = keysetWhere(
      sortColumn,
      users.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      filters.push(seek);
    }

    // Site count comes from a correlated subquery rather than a join, so a user
    // with many sites still produces exactly one row. The .NET equivalents join
    // and then de-duplicate in memory after loading everything.
    const siteCount = sql<number>`(
      select count(*)::int from ${userSites} where ${userSites.userId} = ${users.id}
    )`;

    const rows = await this.db
      .select({
        id: users.id,
        userName: users.userName,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        phoneNo: users.phoneNo,
        isActive: users.isActive,
        passwordIsLegacy: users.passwordIsLegacy,
        siteCount,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(users)
      .where(and(...filters))
      .orderBy(...keysetOrder(sortColumn, users.id, direction))
      // One extra row proves whether another page exists.
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    return {
      rows: page.rows.map(({ sortValue: _ignored, ...row }) => row),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string): Promise<number> {
    const filters = [eq(users.isDeleted, false)];
    if (search) {
      const pattern = `%${search}%`;
      const match = or(
        ilike(users.userName, pattern),
        ilike(users.firstName, pattern),
        ilike(users.lastName, pattern),
        ilike(users.email, pattern),
      );
      if (match) {
        filters.push(match);
      }
    }
    const [row] = await this.db.select({ value: count() }).from(users).where(and(...filters));
    return row?.value ?? 0;
  }

  /**
   * One user with their site and company assignments.
   *
   * The password column is not selected, in any form. The .NET user detail
   * endpoint returns `User.Password` — the plaintext — straight to the browser
   * (assessment C-1); nothing here returns the credential hashed or otherwise.
   */
  async findById(id: string): Promise<UserDetail> {
    const [row] = await this.db
      .select({
        id: users.id,
        userName: users.userName,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        phoneNo: users.phoneNo,
        isActive: users.isActive,
        passwordIsLegacy: users.passwordIsLegacy,
      })
      .from(users)
      .where(and(eq(users.id, id), eq(users.isDeleted, false)))
      .limit(1);

    if (!row) {
      throw new NotFoundException("User not found");
    }

    const [siteRows, companyRows] = await Promise.all([
      this.db.select({ id: userSites.siteId }).from(userSites).where(eq(userSites.userId, id)),
      this.db
        .select({ id: userCompanies.companyId })
        .from(userCompanies)
        .where(eq(userCompanies.userId, id)),
    ]);

    return {
      ...row,
      siteIds: siteRows.map((site) => site.id),
      companyIds: companyRows.map((company) => company.id),
    };
  }

  /**
   * Creates a user with an administrator-set password, hashed before insert.
   *
   * `passwordIsLegacy` is false: a user created here has never had a plaintext
   * credential, so it must not be counted against the C-1 migration backlog that
   * `select count(*) from users where password_is_legacy` reports.
   *
   * The whole thing runs in ONE transaction — the user row and both sets of
   * assignments. `BeginTransaction` has zero matches across the 10,304 lines of
   * the .NET repository layer, which is why a failure part-way through creating a
   * user there leaves the user without their site assignments and nothing to say
   * so.
   */
  async create(input: CreateUser, actorId: string): Promise<UserDetail> {
    const passwordHash = await this.passwords.hash(input.password);

    const id = await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({
            userName: input.userName,
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email!,
            phoneNo: input.phoneNo!,
            password: passwordHash,
            passwordIsLegacy: false,
            isActive: input.isActive,
            ...createdBy(actorId),
          })
          .returning({ id: users.id });

        await this.replaceAssignments(tx, row!.id, input.siteIds, input.companyIds);
        return row!.id;
      }),
    );

    return this.findById(id);
  }

  /**
   * A partial update, in one transaction.
   *
   * Setting a password clears `passwordIsLegacy` and stamps
   * `passwordMigratedAt`, so an administrator resetting a legacy user's password
   * moves them off C-1 exactly as a successful login would. Leaving the field out
   * leaves the stored credential untouched — the update contract makes "absent"
   * and "clear it" different requests on purpose.
   */
  async update(id: string, input: UpdateUser, actorId: string): Promise<UserDetail> {
    const { password, siteIds, companyIds, ...fields } = input;

    const passwordColumns = password
      ? {
          password: await this.passwords.hash(password),
          passwordIsLegacy: false,
          passwordMigratedAt: new Date(),
        }
      : {};

    await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(users)
          .set({ ...fields, ...passwordColumns, ...updatedBy(actorId) })
          .where(and(eq(users.id, id), eq(users.isDeleted, false)))
          .returning({ id: users.id });

        if (!row) {
          throw new NotFoundException("User not found");
        }

        // Undefined means "not being changed"; an empty array means "clear them".
        if (siteIds !== undefined || companyIds !== undefined) {
          await this.replaceAssignments(tx, id, siteIds, companyIds);
        }
      }),
    );

    return this.findById(id);
  }

  /**
   * Soft delete.
   *
   * Deleting yourself is refused. It is the one delete on this screen that
   * cannot be undone by the person who made the mistake — the account they would
   * need to sign in and fix it with is the one they just removed — and an
   * administrator who is also the only administrator can lock the system out of
   * itself in a single click.
   *
   * Refresh tokens are revoked in the same transaction. A soft delete fires no
   * cascade, so without this the deleted user's existing refresh token stays
   * valid and can be exchanged for a fresh access token: the account keeps
   * working for as long as the token lives. Access tokens already issued still
   * run to expiry, which is the accepted cost of stateless auth.
   */
  async remove(id: string, actorId: string): Promise<void> {
    if (id === actorId) {
      throw new BadRequestException("You cannot delete your own account");
    }

    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ isDeleted: true, isActive: false, ...updatedBy(actorId) })
        .where(and(eq(users.id, id), eq(users.isDeleted, false)))
        .returning({ id: users.id });

      if (!row) {
        throw new NotFoundException("User not found");
      }

      await tx.execute(
        sql`update refresh_tokens set revoked_at = now()
            where user_id = ${id} and revoked_at is null`,
      );
    });
  }

  /**
   * Replaces the junction rows for whichever sides were supplied.
   *
   * Delete-then-insert rather than a diff: the sets are small, the screen holds
   * the whole selection, and inside a transaction the intermediate empty state is
   * never observable. The equivalent .NET path rewrites a CSV string on the user
   * row, which is why `User.SiteId` can hold ids of sites that no longer exist.
   */
  private async replaceAssignments(
    tx: Database,
    userId: string,
    siteIds: string[] | undefined,
    companyIds: string[] | undefined,
  ): Promise<void> {
    if (siteIds !== undefined) {
      await tx.delete(userSites).where(eq(userSites.userId, userId));
      if (siteIds.length > 0) {
        await tx.insert(userSites).values(unique(siteIds).map((siteId) => ({ userId, siteId })));
      }
    }

    if (companyIds !== undefined) {
      await tx.delete(userCompanies).where(eq(userCompanies.userId, userId));
      if (companyIds.length > 0) {
        await tx
          .insert(userCompanies)
          .values(unique(companyIds).map((companyId) => ({ userId, companyId })));
      }
    }
  }

  /**
   * Site and company options for the user form — id and name only, and only
   * live rows. Not paginated: both lists are chooser inputs that have to be
   * complete to be usable, and they are bounded by the number of sites the
   * business operates rather than by transaction volume.
   */
  async assignmentOptions(): Promise<{
    sites: { id: string; name: string }[];
    companies: { id: string; name: string }[];
  }> {
    const [siteRows, companyRows] = await Promise.all([
      this.db
        .select({ id: sites.id, name: sites.name })
        .from(sites)
        .where(eq(sites.isDeleted, false))
        .orderBy(sites.name),
      this.db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(eq(companies.isDeleted, false))
        .orderBy(companies.name),
    ]);

    return { sites: siteRows, companies: companyRows };
  }
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];
