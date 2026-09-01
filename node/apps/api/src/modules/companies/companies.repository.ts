import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import type { ListQuery, SortDirection } from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { companies, userCompanies } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";

const SORTABLE = {
  name: companies.name,
  createdAt: companies.createdAt,
} as const;

export type CompanySortKey = keyof typeof SORTABLE;

export interface CompanyListRow {
  id: string;
  name: string;
  invoicePrefix: string | null;
  gstNo: string | null;
  panNo: string | null;
  area: string | null;
  pincode: string | null;
  bankName: string | null;
  userCount: number;
}

@Injectable()
export class CompaniesRepository {
  constructor(@Inject(DATABASE) private readonly injected: Database | null) {}

  private get db(): Database {
    if (!this.injected) {
      throw new ServiceUnavailableException(
        "No database is configured. Set DATABASE_URL to use this endpoint.",
      );
    }
    return this.injected;
  }

  /** Name, GST and PAN — the three things anyone actually looks a company up by. */
  private searchFilter(search: string | undefined) {
    if (!search) {
      return undefined;
    }
    const pattern = `%${search}%`;
    return or(
      ilike(companies.name, pattern),
      ilike(companies.gstNo, pattern),
      ilike(companies.panNo, pattern),
    );
  }

  async list(query: ListQuery): Promise<{ rows: CompanyListRow[]; nextCursor: string | null }> {
    const sortKey: CompanySortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as CompanySortKey) : "name";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const filters = [eq(companies.isDeleted, false)];
    const match = this.searchFilter(query.search);
    if (match) {
      filters.push(match);
    }

    const seek = keysetWhere(
      sortColumn,
      companies.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      filters.push(seek);
    }

    // Correlated subquery, not a join: a company with 30 users still produces one
    // row. Joining and de-duplicating in memory is what the .NET repositories do.
    const userCount = sql<number>`(
      select count(*)::int from ${userCompanies}
      where ${userCompanies.companyId} = ${companies}.id
    )`;

    const rows = await this.db
      .select({
        id: companies.id,
        name: companies.name,
        invoicePrefix: companies.invoicePrefix,
        gstNo: companies.gstNo,
        panNo: companies.panNo,
        area: companies.area,
        pincode: companies.pincode,
        bankName: companies.bankName,
        userCount,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(companies)
      .where(and(...filters))
      .orderBy(...keysetOrder(sortColumn, companies.id, direction))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    return {
      rows: page.rows.map(({ sortValue: _ignored, ...row }) => row),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string): Promise<number> {
    const filters = [eq(companies.isDeleted, false)];
    const match = this.searchFilter(search);
    if (match) {
      filters.push(match);
    }
    const [row] = await this.db.select({ value: count() }).from(companies).where(and(...filters));
    return row?.value ?? 0;
  }
}
