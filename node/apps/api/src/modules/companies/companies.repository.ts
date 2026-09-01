import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import type {
  CompanyDetail,
  CreateCompany,
  ListQuery,
  SortDirection,
  UpdateCompany,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { companies, userCompanies } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

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

/**
 * The columns the detail payload selects.
 *
 * Written out rather than a bare `select()`, so that adding a column to the table
 * does not silently add it to an API response. `accountNo` and `ifscCode` are
 * here, and deliberately absent from the list projection below.
 */
const DETAIL_COLUMNS = {
  id: companies.id,
  name: companies.name,
  invoicePrefix: companies.invoicePrefix,
  gstNo: companies.gstNo,
  panNo: companies.panNo,
  address: companies.address,
  area: companies.area,
  cityId: companies.cityId,
  stateId: companies.stateId,
  countryId: companies.countryId,
  pincode: companies.pincode,
  bankName: companies.bankName,
  bankBranch: companies.bankBranch,
  accountNo: companies.accountNo,
  ifscCode: companies.ifscCode,
} as const;

@Injectable()
export class CompaniesRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
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

  /**
   * One company, or 404.
   *
   * A soft-deleted company is a 404, not a hidden row that still edits
   * successfully. The source filters `IsDelete` on its lists but not on its
   * fetch-by-id, so a stale browser tab can load and re-save a deleted record.
   */
  async findById(id: string): Promise<CompanyDetail> {
    const [row] = await this.db
      .select(DETAIL_COLUMNS)
      .from(companies)
      .where(and(eq(companies.id, id), eq(companies.isDeleted, false)))
      .limit(1);

    if (!row) {
      throw new NotFoundException("Company not found");
    }
    return row;
  }

  async create(input: CreateCompany, actorId: string): Promise<CompanyDetail> {
    const [row] = await writing(() =>
      this.db
        .insert(companies)
        .values({ ...normalise(input), ...createdBy(actorId) })
        .returning(DETAIL_COLUMNS),
    );
    return row!;
  }

  /**
   * A partial update: only the keys present in `input` are written, so a caller
   * that never loaded the bank details cannot blank them by omission.
   */
  async update(id: string, input: UpdateCompany, actorId: string): Promise<CompanyDetail> {
    const [row] = await writing(() =>
      this.db
        .update(companies)
        .set({ ...normalise(input), ...updatedBy(actorId) })
        .where(and(eq(companies.id, id), eq(companies.isDeleted, false)))
        .returning(DETAIL_COLUMNS),
    );

    if (!row) {
      throw new NotFoundException("Company not found");
    }
    return row;
  }

  /**
   * Soft delete, matching the source's `IsDelete` flag.
   *
   * Refused while users are still assigned. The junction row has `on delete
   * cascade`, but a SOFT delete never fires it — the assignments would survive,
   * pointing at a company no screen can show, and every affected user's access
   * token would keep carrying its id in `companyIds`. Refusing with the count is
   * more useful than silently detaching them or leaving the wreckage.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const [assigned] = await this.db
      .select({ value: count() })
      .from(userCompanies)
      .where(eq(userCompanies.companyId, id));

    const assignedCount = assigned?.value ?? 0;
    if (assignedCount > 0) {
      throw new ConflictException(
        `This company still has ${assignedCount} assigned ${
          assignedCount === 1 ? "user" : "users"
        }. Reassign them before deleting it.`,
      );
    }

    const [row] = await this.db
      .update(companies)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(companies.id, id), eq(companies.isDeleted, false)))
      .returning({ id: companies.id });

    if (!row) {
      throw new NotFoundException("Company not found");
    }
  }
}

/**
 * Upper-cases the identifiers whose unique indexes compare case-insensitively.
 *
 * `companies_gst_no_key` indexes `upper(gst_no)`, so "24aacd…" and "24AACD…"
 * collide on write but would render inconsistently on read. Storing them
 * upper-cased makes what the screen shows match what the constraint enforces.
 * PAN and IFSC follow the same rule despite having no index: both are government
 * or banking identifiers with one canonical form, and otherwise every screen
 * shows them in whichever case the person who typed them used.
 */
function normalise<T extends Partial<CreateCompany>>(input: T): T {
  const patch: Record<string, unknown> = { ...input };
  for (const key of ["gstNo", "panNo", "ifscCode"] as const) {
    if (typeof patch[key] === "string") {
      patch[key] = (patch[key] as string).toUpperCase();
    }
  }
  return patch as T;
}
