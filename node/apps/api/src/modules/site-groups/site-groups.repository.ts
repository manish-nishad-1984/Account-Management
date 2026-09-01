import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { and, count, eq, ilike, sql } from "drizzle-orm";
import type { ListQuery, SortDirection } from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { siteGroupAddresses, siteGroupSites, siteGroups, sites } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";

const SORTABLE = {
  name: siteGroups.name,
  createdAt: siteGroups.createdAt,
} as const;

export type SiteGroupSortKey = keyof typeof SORTABLE;

/** How many member names the list preview carries. The grid shows a few, not all. */
const SITE_NAME_PREVIEW = 3;

export interface SiteGroupListRow {
  id: string;
  name: string;
  siteCount: number;
  addressCount: number;
  siteNames: string[];
}

@Injectable()
export class SiteGroupsRepository {
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
    return search ? ilike(siteGroups.name, `%${search}%`) : undefined;
  }

  async list(query: ListQuery): Promise<{ rows: SiteGroupListRow[]; nextCursor: string | null }> {
    const sortKey: SiteGroupSortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as SiteGroupSortKey) : "name";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const filters = [eq(siteGroups.isDeleted, false)];
    const match = this.searchFilter(query.search);
    if (match) {
      filters.push(match);
    }

    const seek = keysetWhere(
      sortColumn,
      siteGroups.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      filters.push(seek);
    }

    /**
     * Sites and addresses are counted separately.
     *
     * In SQL Server both live in one table as a cross product, so neither count is
     * answerable without a GROUP BY and the two are not independent. Here they are
     * two subqueries over two tables, which is what the numbers always meant.
     *
     * Note the `${siteGroups}.id` form on every OUTER reference. Drizzle renders
     * `${table.column}` inside a `sql` template as a BARE column name with no table
     * qualifier, so the natural-looking `${siteGroupAddresses.groupId} = ${siteGroups.id}`
     * compiles to `where "group_id" = "id"` — and PostgreSQL resolves that `"id"`
     * against `site_group_addresses`, which has an `id` column of its own. The
     * correlation silently becomes `group_id = id`, matches almost nothing, and
     * every count comes back 0 with no error anywhere. Qualifying the outer
     * reference is what makes it correlate to the row being listed.
     */
    const siteCount = sql<number>`(
      select count(*)::int from ${siteGroupSites}
      where ${siteGroupSites.groupId} = ${siteGroups}.id
    )`;
    const addressCount = sql<number>`(
      select count(*)::int from ${siteGroupAddresses}
      where ${siteGroupAddresses.groupId} = ${siteGroups}.id
    )`;
    // A bounded preview, ordered so it is stable between requests. LIMIT lives
    // inside the subquery, so a group with 400 sites still costs 3 names. The
    // inner tables are aliased for the same qualification reason as above.
    const siteNames = sql<string[]>`(
      select coalesce(array_agg(n.name order by n.name), '{}')
      from (
        select s.name as name
        from ${siteGroupSites} gs
        join ${sites} s on s.id = gs.site_id
        where gs.group_id = ${siteGroups}.id and s.is_deleted = false
        order by s.name
        limit ${SITE_NAME_PREVIEW}
      ) n
    )`;

    const rows = await this.db
      .select({
        id: siteGroups.id,
        name: siteGroups.name,
        siteCount,
        addressCount,
        siteNames,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(siteGroups)
      .where(and(...filters))
      .orderBy(...keysetOrder(sortColumn, siteGroups.id, direction))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    return {
      rows: page.rows.map(({ sortValue: _ignored, ...row }) => row),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string): Promise<number> {
    const filters = [eq(siteGroups.isDeleted, false)];
    const match = this.searchFilter(search);
    if (match) {
      filters.push(match);
    }
    const [row] = await this.db.select({ value: count() }).from(siteGroups).where(and(...filters));
    return row?.value ?? 0;
  }
}
