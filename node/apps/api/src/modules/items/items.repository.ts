import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, eq, ilike, inArray, or, sql } from "drizzle-orm";
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

/** The dashboard's pending queue is `isApproved: false`; the list screen passes nothing. */
export interface ItemFilters {
  isApproved?: boolean;
}

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
  async list(
    query: ListQuery,
    options: ItemFilters = {},
  ): Promise<{ rows: ItemListRow[]; nextCursor: string | null }> {
    const sortKey: ItemSortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as ItemSortKey) : "name";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const filters = [eq(items.isDeleted, false)];
    const match = this.searchFilter(query.search);
    if (match) {
      filters.push(match);
    }
    if (options.isApproved !== undefined) {
      filters.push(eq(items.isApproved, options.isApproved));
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

  async total(search?: string, options: ItemFilters = {}): Promise<number> {
    const filters = [eq(items.isDeleted, false)];
    const match = this.searchFilter(search);
    if (match) {
      filters.push(match);
    }
    if (options.isApproved !== undefined) {
      filters.push(eq(items.isApproved, options.isApproved));
    }
    const [row] = await this.db.select({ value: count() }).from(items).where(and(...filters));
    return row?.value ?? 0;
  }

  /**
   * Approve or unapprove one item, STATING the value.
   *
   * `ApproveUnapproveItem` in the source reads the row and writes the opposite,
   * so two approvers racing land wherever ordering puts them and the API cannot
   * express "approve this" at all. Same fix as purchase requests and inventory
   * inward, same reason.
   */
  async setApproval(id: string, isApproved: boolean, actorId: string): Promise<ItemDetail> {
    const [row] = await this.db
      .update(items)
      .set({ isApproved, ...updatedBy(actorId) })
      .where(and(eq(items.id, id), eq(items.isDeleted, false)))
      .returning(DETAIL_COLUMNS);

    if (!row) {
      throw new NotFoundException("Item not found");
    }
    return row;
  }

  /**
   * Bulk approval from the dashboard queue — ONE statement, not one per row.
   *
   * `eq(isApproved, !isApproved)` in the WHERE is what makes a select-all safe
   * across a queue that already contains approved rows: they are excluded
   * rather than flipped off, and the returned count is what actually changed
   * rather than how many boxes were ticked.
   *
   * The source's six bulk-approve methods loaded the WHOLE table and called
   * `Update()` on every row — finding P2, fixed on the .NET side in §5c. This
   * is the shape that defect should have had.
   */
  async setApprovalMany(ids: string[], isApproved: boolean, actorId: string): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    const rows = await this.db
      .update(items)
      .set({ isApproved, ...updatedBy(actorId) })
      .where(
        and(
          inArray(items.id, ids),
          eq(items.isDeleted, false),
          eq(items.isApproved, !isApproved),
        ),
      )
      .returning({ id: items.id });

    return rows.length;
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
   * Every item matching the search, for the spreadsheet export.
   *
   * NOT keyset-paginated, and it is the only read in the codebase that is not.
   * An export is one file of the whole filtered set by definition — a paged
   * export would hand the user page one and let them believe it is the
   * catalogue. The row cap is the guard instead, and one row beyond it is
   * fetched so that "more than the limit" is distinguishable from "exactly the
   * limit".
   *
   * Ordered by name, which is what a person reads down a price list by. The
   * list screen defaults to the same, and the legacy export inherits
   * `GetItemList`'s `CreatedOn descending` — newest first, which is the one
   * order a catalogue is never wanted in.
   */
  async exportRows(search: string | undefined, limit: number): Promise<ItemListRow[]> {
    const filters = [eq(items.isDeleted, false)];
    const match = this.searchFilter(search);
    if (match) {
      filters.push(match);
    }

    return this.db
      .select({ ...DETAIL_COLUMNS, unitName: units.name })
      .from(items)
      .innerJoin(units, eq(items.unitId, units.id))
      .where(and(...filters))
      .orderBy(asc(items.name))
      .limit(limit + 1);
  }

  /** Every unit, keyed by lower-cased name — how a sheet's "Unit Type" resolves. */
  async unitsByName(): Promise<Map<string, { id: number; name: string }>> {
    const rows = await this.db.select({ id: units.id, name: units.name }).from(units);
    return new Map(rows.map((row) => [row.name.trim().toLowerCase(), row]));
  }

  /**
   * Items already carrying any of these names, keyed by lower-cased name.
   *
   * Case-INSENSITIVE, because `items` has a `lower(name)` unique index: a
   * case-sensitive existence check would pass and the INSERT would then fail on
   * the constraint, turning a row-level message into a whole-file 409. The
   * legacy check is `x.ItemName == itemDetails.ItemName` in EF Core, which
   * against SQL Server's default case-insensitive collation behaves the way
   * this does — so matching case-insensitively reproduces it rather than
   * departing from it.
   */
  async existingByName(
    names: string[],
  ): Promise<Map<string, { id: string; isDeleted: boolean; name: string }>> {
    if (names.length === 0) return new Map();

    const lowered = [...new Set(names.map((name) => name.toLowerCase()))];
    const rows = await this.db
      .select({ id: items.id, name: items.name, isDeleted: items.isDeleted })
      .from(items)
      .where(inArray(sql`lower(${items.name})`, lowered));

    return new Map(rows.map((row) => [row.name.toLowerCase(), row]));
  }

  /**
   * Writes an import, all of it or none of it.
   *
   * One transaction for the whole file. The legacy version accumulates into two
   * lists and calls `SaveChangesAsync` once, which is atomic by accident of EF
   * Core's change tracker rather than by intent — and it returns early on the
   * first bad row, so a file that is 90% valid writes nothing while telling the
   * user about one problem out of fifteen. Every check happens before this is
   * called; by here the rows are known good.
   */
  async applyImport(
    creates: (CreateItem & { name: string })[],
    revives: { id: string; values: CreateItem }[],
    actorId: string,
  ): Promise<void> {
    await writing(() =>
      this.db.transaction(async (tx) => {
        if (creates.length > 0) {
          await tx.insert(items).values(creates.map((row) => ({ ...row, ...createdBy(actorId) })));
        }
        for (const revive of revives) {
          await tx
            .update(items)
            .set({ ...revive.values, isDeleted: false, ...updatedBy(actorId) })
            .where(eq(items.id, revive.id));
        }
      }),
    );
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
