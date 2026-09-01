import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import type { ListQuery, SortDirection } from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { siteGroupSites, sites, userSites } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";

const SORTABLE = {
  name: sites.name,
  createdAt: sites.createdAt,
} as const;

export type SiteSortKey = keyof typeof SORTABLE;

export interface SiteListRow {
  id: string;
  name: string;
  isActive: boolean;
  contactPersonName: string | null;
  contactPersonPhoneNo: string | null;
  area: string | null;
  pincode: string | null;
  userCount: number;
  groupCount: number;
}

@Injectable()
export class SitesRepository {
  constructor(@Inject(DATABASE) private readonly injected: Database | null) {}

  private get db(): Database {
    if (!this.injected) {
      throw new ServiceUnavailableException(
        "No database is configured. Set DATABASE_URL to use this endpoint.",
      );
    }
    return this.injected;
  }

  private searchFilter(search: string | undefined) {
    if (!search) {
      return undefined;
    }
    const pattern = `%${search}%`;
    return or(
      ilike(sites.name, pattern),
      ilike(sites.area, pattern),
      ilike(sites.contactPersonName, pattern),
    );
  }

  async list(query: ListQuery): Promise<{ rows: SiteListRow[]; nextCursor: string | null }> {
    const sortKey: SiteSortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as SiteSortKey) : "name";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const filters = [eq(sites.isDeleted, false)];
    const match = this.searchFilter(query.search);
    if (match) {
      filters.push(match);
    }

    const seek = keysetWhere(
      sortColumn,
      sites.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      filters.push(seek);
    }

    // Two independent counts, two correlated subqueries. Joining both would
    // multiply the rows together and give a site with 3 users and 2 groups a
    // count of 6 for each — the exact defect the .NET list queries carry.
    // The outer reference is table-qualified deliberately — see the note in
    // site-groups.repository.ts. Bare `${sites.id}` renders as `"id"` and binds
    // to whichever joined table happens to have one.
    const userCount = sql<number>`(
      select count(*)::int from ${userSites} where ${userSites.siteId} = ${sites}.id
    )`;
    const groupCount = sql<number>`(
      select count(*)::int from ${siteGroupSites} where ${siteGroupSites.siteId} = ${sites}.id
    )`;

    const rows = await this.db
      .select({
        id: sites.id,
        name: sites.name,
        isActive: sites.isActive,
        contactPersonName: sites.contactPersonName,
        contactPersonPhoneNo: sites.contactPersonPhoneNo,
        area: sites.area,
        pincode: sites.pincode,
        userCount,
        groupCount,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(sites)
      .where(and(...filters))
      .orderBy(...keysetOrder(sortColumn, sites.id, direction))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    return {
      rows: page.rows.map(({ sortValue: _ignored, ...row }) => row),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string): Promise<number> {
    const filters = [eq(sites.isDeleted, false)];
    const match = this.searchFilter(search);
    if (match) {
      filters.push(match);
    }
    const [row] = await this.db.select({ value: count() }).from(sites).where(and(...filters));
    return row?.value ?? 0;
  }
}
