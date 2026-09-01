import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import type {
  CreateItem,
  ItemDetail,
  ListQuery,
  SortDirection,
  UpdateItem,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { items, units } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

const SORTABLE = {
  name: items.name,
  createdAt: items.createdAt,
} as const;

export type ItemSortKey = keyof typeof SORTABLE;

export interface ItemListRow {
  id: string;
  name: string;
  unitId: number;
  unitName: string;
  pricePerUnit: string;
  isWithGst: boolean;
  gstPercent: string | null;
  gstAmount: string | null;
  hsnCode: string | null;
  isApproved: boolean;
}

const DETAIL_COLUMNS = {
  id: items.id,
  name: items.name,
  unitId: items.unitId,
  pricePerUnit: items.pricePerUnit,
  isWithGst: items.isWithGst,
  gstPercent: items.gstPercent,
  gstAmount: items.gstAmount,
  hsnCode: items.hsnCode,
  isApproved: items.isApproved,
} as const;

@Injectable()
export class ItemsRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /** Item name and HSN code — the two ways an item is looked up on a PO line. */
  private searchFilter(search: string | undefined) {
    if (!search) {
      return undefined;
    }
    const pattern = `%${search}%`;
    return or(ilike(items.name, pattern), ilike(items.hsnCode, pattern));
  }

  /**
   * The unit name comes from an INNER JOIN, not a correlated subquery.
   *
   * `items.unit_id` is NOT NULL with a real foreign key, so exactly one unit row
   * matches and the join cannot multiply rows or drop any. The counts elsewhere
   * in this codebase use subqueries because they are one-to-many; this is
   * many-to-one, where a join is both correct and cheaper.
   */
  async list(query: ListQuery): Promise<{ rows: ItemListRow[]; nextCursor: string | null }> {
    const sortKey: ItemSortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as ItemSortKey) : "name";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const filters = [eq(items.isDeleted, false)];
    const match = this.searchFilter(query.search);
    if (match) {
      filters.push(match);
    }

    const seek = keysetWhere(
      sortColumn,
      items.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      filters.push(seek);
    }

    const rows = await this.db
      .select({
        ...DETAIL_COLUMNS,
        unitName: units.name,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(items)
      .innerJoin(units, eq(items.unitId, units.id))
      .where(and(...filters))
      .orderBy(...keysetOrder(sortColumn, items.id, direction))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    return {
      rows: page.rows.map(({ sortValue: _ignored, ...row }) => row),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string): Promise<number> {
    const filters = [eq(items.isDeleted, false)];
    const match = this.searchFilter(search);
    if (match) {
      filters.push(match);
    }
    const [row] = await this.db.select({ value: count() }).from(items).where(and(...filters));
    return row?.value ?? 0;
  }

  async findById(id: string): Promise<ItemDetail> {
    const [row] = await this.db
      .select(DETAIL_COLUMNS)
      .from(items)
      .where(and(eq(items.id, id), eq(items.isDeleted, false)))
      .limit(1);

    if (!row) {
      throw new NotFoundException("Item not found");
    }
    return row;
  }

  /**
   * A bad `unitId` surfaces as a 409 from the foreign key, translated by
   * `writing`. Checking the unit exists first would be two statements with a gap
   * in the middle; the constraint has no gap.
   */
  async create(input: CreateItem, actorId: string): Promise<ItemDetail> {
    const [row] = await writing(() =>
      this.db
        .insert(items)
        .values({ ...input, ...createdBy(actorId) })
        .returning(DETAIL_COLUMNS),
    );
    return row!;
  }

  async update(id: string, input: UpdateItem, actorId: string): Promise<ItemDetail> {
    const [row] = await writing(() =>
      this.db
        .update(items)
        .set({ ...input, ...updatedBy(actorId) })
        .where(and(eq(items.id, id), eq(items.isDeleted, false)))
        .returning(DETAIL_COLUMNS),
    );

    if (!row) {
      throw new NotFoundException("Item not found");
    }
    return row;
  }

  /**
   * Soft delete.
   *
   * As with suppliers there is no in-use check yet, and for the same reason:
   * `PurchaseRequest`, `ItemInword`, `InventoryInward` and `SalesInvoiceDetail`
   * all reference `ItemId`, and none of those tables has been migrated. A count
   * against an empty table would pass every time while looking like a guard.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const [row] = await this.db
      .update(items)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(items.id, id), eq(items.isDeleted, false)))
      .returning({ id: items.id });

    if (!row) {
      throw new NotFoundException("Item not found");
    }
  }
}
