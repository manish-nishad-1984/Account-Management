import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import type {
  CreateSupplier,
  ListQuery,
  SortDirection,
  SupplierDetail,
  UpdateSupplier,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { suppliers } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

const SORTABLE = {
  name: suppliers.name,
  createdAt: suppliers.createdAt,
} as const;

export type SupplierSortKey = keyof typeof SORTABLE;

export interface SupplierListRow {
  id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  gstNo: string | null;
  area: string | null;
  pincode: string | null;
  isApproved: boolean;
  openingBalance: string | null;
}

/**
 * The list projection. Bank name, branch, account number and IFSC are absent,
 * for the same reason they are absent from the company list: a grid any
 * `supplier.view` holder can open must not ship every supplier's bank account.
 */
const LIST_COLUMNS = {
  id: suppliers.id,
  name: suppliers.name,
  mobile: suppliers.mobile,
  email: suppliers.email,
  gstNo: suppliers.gstNo,
  area: suppliers.area,
  pincode: suppliers.pincode,
  isApproved: suppliers.isApproved,
  openingBalance: suppliers.openingBalance,
} as const;

const DETAIL_COLUMNS = {
  ...LIST_COLUMNS,
  buildingName: suppliers.buildingName,
  cityId: suppliers.cityId,
  stateId: suppliers.stateId,
  bankName: suppliers.bankName,
  bankBranch: suppliers.bankBranch,
  accountNo: suppliers.accountNo,
  ifscCode: suppliers.ifscCode,
  openingBalanceDate: suppliers.openingBalanceDate,
} as const;

@Injectable()
export class SuppliersRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /**
   * Name, GST, mobile and email. Mobile is included because it is how the
   * purchasing desk actually finds a supplier they have only ever phoned.
   */
  private searchFilter(search: string | undefined) {
    if (!search) {
      return undefined;
    }
    const pattern = `%${search}%`;
    return or(
      ilike(suppliers.name, pattern),
      ilike(suppliers.gstNo, pattern),
      ilike(suppliers.mobile, pattern),
      ilike(suppliers.email, pattern),
    );
  }

  async list(query: ListQuery): Promise<{ rows: SupplierListRow[]; nextCursor: string | null }> {
    const sortKey: SupplierSortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as SupplierSortKey) : "name";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const filters = [eq(suppliers.isDeleted, false)];
    const match = this.searchFilter(query.search);
    if (match) {
      filters.push(match);
    }

    const seek = keysetWhere(
      sortColumn,
      suppliers.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      filters.push(seek);
    }

    const rows = await this.db
      .select({ ...LIST_COLUMNS, sortValue: sql<string>`${sortColumn}::text` })
      .from(suppliers)
      .where(and(...filters))
      .orderBy(...keysetOrder(sortColumn, suppliers.id, direction))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    return {
      rows: page.rows.map(({ sortValue: _ignored, ...row }) => row),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string): Promise<number> {
    const filters = [eq(suppliers.isDeleted, false)];
    const match = this.searchFilter(search);
    if (match) {
      filters.push(match);
    }
    const [row] = await this.db.select({ value: count() }).from(suppliers).where(and(...filters));
    return row?.value ?? 0;
  }

  async findById(id: string): Promise<SupplierDetail> {
    const [row] = await this.db
      .select(DETAIL_COLUMNS)
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.isDeleted, false)))
      .limit(1);

    if (!row) {
      throw new NotFoundException("Supplier not found");
    }
    return toDetail(row);
  }

  async create(input: CreateSupplier, actorId: string): Promise<SupplierDetail> {
    const [row] = await writing(() =>
      this.db
        .insert(suppliers)
        .values({ ...toColumns(input), ...createdBy(actorId) })
        .returning(DETAIL_COLUMNS),
    );
    return toDetail(row!);
  }

  async update(id: string, input: UpdateSupplier, actorId: string): Promise<SupplierDetail> {
    const [row] = await writing(() =>
      this.db
        .update(suppliers)
        .set({ ...toColumns(input), ...updatedBy(actorId) })
        .where(and(eq(suppliers.id, id), eq(suppliers.isDeleted, false)))
        .returning(DETAIL_COLUMNS),
    );

    if (!row) {
      throw new NotFoundException("Supplier not found");
    }
    return toDetail(row);
  }

  /**
   * Soft delete.
   *
   * Unlike companies and sites there is no in-use check here yet, and that is a
   * gap rather than a decision: `PurchaseOrder` and `SalesInvoice` both carry a
   * `SupplierId` foreign key, so a supplier with documents against it should
   * refuse in the same way. Neither table has been migrated, so there is nothing
   * to count — a check written now would query an empty table and always pass,
   * which reads as a working guard while being none. It goes in with
   * purchase orders.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const [row] = await this.db
      .update(suppliers)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(suppliers.id, id), eq(suppliers.isDeleted, false)))
      .returning({ id: suppliers.id });

    if (!row) {
      throw new NotFoundException("Supplier not found");
    }
  }
}

/**
 * `openingBalanceDate` is a `timestamptz` in the database and an ISO date string
 * on the wire. Converting here rather than in the controller keeps every caller
 * of this repository seeing one shape.
 */
function toDetail(row: {
  openingBalanceDate: Date | null;
  [key: string]: unknown;
}): SupplierDetail {
  return {
    ...row,
    openingBalanceDate: row.openingBalanceDate?.toISOString() ?? null,
  } as SupplierDetail;
}

/**
 * Upper-cases GST and IFSC — see the matching note in companies.repository.ts —
 * and turns the ISO date string the contract carries into the `Date` the
 * `timestamptz` column takes.
 *
 * The return type drops `openingBalanceDate` from the input and re-adds it as a
 * `Date`, so the Drizzle insert still typechecks every other column rather than
 * being widened to `Record<string, unknown>` and losing the check entirely.
 */
function toColumns<T extends Partial<CreateSupplier>>(
  input: T,
): Omit<T, "openingBalanceDate"> & { openingBalanceDate?: Date | null } {
  const { openingBalanceDate, ...rest } = input;
  const patch = { ...rest } as Record<string, unknown>;

  for (const key of ["gstNo", "ifscCode"] as const) {
    if (typeof patch[key] === "string") {
      patch[key] = (patch[key] as string).toUpperCase();
    }
  }

  return {
    ...(patch as Omit<T, "openingBalanceDate">),
    ...(openingBalanceDate === undefined
      ? {}
      : { openingBalanceDate: openingBalanceDate === null ? null : new Date(openingBalanceDate) }),
  };
}
