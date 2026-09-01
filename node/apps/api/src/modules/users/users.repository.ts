import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import type { ListQuery, SortDirection } from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { users, userSites } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";

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
export class UsersRepository {
  constructor(@Inject(DATABASE) private readonly injected: Database | null) {}

  /**
   * DATABASE is null when DATABASE_URL is unset, which is allowed in development
   * so the API still boots for auth work. Any endpoint that genuinely needs the
   * database should say so, rather than surfacing a bare 500.
   */
  private get db(): Database {
    if (!this.injected) {
      throw new ServiceUnavailableException(
        "No database is configured. Set DATABASE_URL to use this endpoint.",
      );
    }
    return this.injected;
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
}
