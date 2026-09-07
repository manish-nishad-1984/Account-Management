import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type {
  CreateInventoryInward,
  InventoryInwardDetail,
  ListQuery,
  SortDirection,
  UpdateInventoryInward,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { inventoryInward, items, sites, units } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

/**
 * `item` is NOT sortable: it lives on the joined master, and keyset paging needs
 * a NOT NULL column on the table being paged (§7.2). The source sorts by it and
 * pages the result in memory — affordable at three rows, not at three thousand.
 */
const SORTABLE = {
  createdAt: inventoryInward.createdAt,
  quantity: inventoryInward.quantity,
} as const;

export type InventoryInwardSortKey = keyof typeof SORTABLE;

export interface InventoryInwardListRow {
  id: string;
  siteId: string | null;
  siteName: string | null;
  itemId: string;
  itemName: string;
  unitId: number;
  unitName: string;
  quantity: string;
  documentDate: string | null;
  details: string | null;
  isApproved: boolean;
  createdAt: string;
}

const DETAIL_COLUMNS = {
  id: inventoryInward.id,
  siteId: inventoryInward.siteId,
  itemId: inventoryInward.itemId,
  unitId: inventoryInward.unitId,
  quantity: inventoryInward.quantity,
  documentDate: inventoryInward.documentDate,
  details: inventoryInward.details,
  isApproved: inventoryInward.isApproved,
  createdAt: inventoryInward.createdAt,
} as const;

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

type DetailRow = { [K in keyof typeof DETAIL_COLUMNS]: unknown };

const toDetail = (row: DetailRow): InventoryInwardDetail => ({
  id: row.id as string,
  siteId: row.siteId as string | null,
  itemId: row.itemId as string,
  unitId: row.unitId as number,
  quantity: row.quantity as string,
  documentDate: iso(row.documentDate as Date | string | null),
  details: row.details as string | null,
  isApproved: row.isApproved as boolean,
  createdAt: iso(row.createdAt as Date | string) as string,
});

@Injectable()
export class InventoryInwardRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /** Item name, unit name and the free text — the source searches the first two. */
  private searchFilter(search: string | undefined) {
    if (!search) {
      return undefined;
    }
    const pattern = `%${search}%`;
    return or(ilike(items.name, pattern), ilike(units.name, pattern), ilike(inventoryInward.details, pattern));
  }

  /**
   * A SITE FILTER MUST NOT EXCLUDE UNALLOCATED ROWS.
   *
   * `InventoryInward.SiteId` exists and nothing in the .NET application ever
   * writes it — the create form has six fields and none of them is a site. So
   * every row imported from production has `site_id IS NULL`, and a plain
   * `site_id = :siteId` would show an empty screen to every user under every
   * scope. Rows created here do carry a site, so the two populations coexist and
   * the filter has to admit both: this site, or not yet allocated.
   *
   * The consequence is stated on screen rather than hidden — see the note the
   * web page renders when unallocated rows are present. It stops being needed
   * once the history is backfilled, and `select count(*) where site_id is null`
   * says when that is.
   */
  private baseFilters(
    search: string | undefined,
    { siteId, isApproved }: { siteId?: string; isApproved?: boolean },
  ) {
    const where = [eq(inventoryInward.isDeleted, false)];

    if (siteId) {
      where.push(or(eq(inventoryInward.siteId, siteId), isNull(inventoryInward.siteId))!);
    }
    if (isApproved !== undefined) {
      where.push(eq(inventoryInward.isApproved, isApproved));
    }

    const match = this.searchFilter(search);
    if (match) {
      where.push(match);
    }
    return where;
  }

  async list(
    query: ListQuery,
    filters: { siteId?: string; isApproved?: boolean } = {},
  ): Promise<{ rows: InventoryInwardListRow[]; nextCursor: string | null }> {
    const sortKey: InventoryInwardSortKey =
      query.sortBy && query.sortBy in SORTABLE
        ? (query.sortBy as InventoryInwardSortKey)
        : "createdAt";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const where = this.baseFilters(query.search, filters);

    const seek = keysetWhere(
      sortColumn,
      inventoryInward.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      where.push(seek);
    }

    const rows = await this.db
      .select({
        id: inventoryInward.id,
        siteId: inventoryInward.siteId,
        siteName: sites.name,
        itemId: inventoryInward.itemId,
        itemName: items.name,
        unitId: inventoryInward.unitId,
        unitName: units.name,
        quantity: inventoryInward.quantity,
        documentDate: inventoryInward.documentDate,
        details: inventoryInward.details,
        isApproved: inventoryInward.isApproved,
        createdAt: inventoryInward.createdAt,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(inventoryInward)
      .innerJoin(items, eq(inventoryInward.itemId, items.id))
      .innerJoin(units, eq(inventoryInward.unitId, units.id))
      // LEFT, not INNER: `site_id` is null on every imported row, and an inner
      // join would return nothing at all for the whole table.
      .leftJoin(sites, eq(inventoryInward.siteId, sites.id))
      .where(and(...where))
      .orderBy(...keysetOrder(sortColumn, inventoryInward.id, direction))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    return {
      rows: page.rows.map(({ sortValue: _ignored, ...row }) => ({
        ...row,
        documentDate: iso(row.documentDate),
        createdAt: iso(row.createdAt) as string,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async total(
    search?: string,
    filters: { siteId?: string; isApproved?: boolean } = {},
  ): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(inventoryInward)
      .innerJoin(items, eq(inventoryInward.itemId, items.id))
      .innerJoin(units, eq(inventoryInward.unitId, units.id))
      .where(and(...this.baseFilters(search, filters)));
    return row?.value ?? 0;
  }

  /** How many live rows have no site yet. The backfill's progress bar. */
  async unallocatedCount(): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(inventoryInward)
      .where(and(eq(inventoryInward.isDeleted, false), isNull(inventoryInward.siteId)));
    return row?.value ?? 0;
  }

  async findById(id: string): Promise<InventoryInwardDetail> {
    const [row] = await this.db
      .select(DETAIL_COLUMNS)
      .from(inventoryInward)
      .where(and(eq(inventoryInward.id, id), eq(inventoryInward.isDeleted, false)))
      .limit(1);

    if (!row) {
      throw new NotFoundException("Inventory record not found");
    }
    return toDetail(row);
  }

  /**
   * Created UNAPPROVED, unlike the source.
   *
   * `InsertInventoryDetails` hard-codes `IsApproved = true`, so the Approve
   * column has never gated anything — every arrival posted already approved and
   * the toggle only ever took approval away. Flagged for sign-off in the schema.
   *
   * `item_name` is written as a snapshot of the master's name at this instant,
   * because the source stores one. Nothing reads it: both the list and the form
   * take the name from the master, so the two can never disagree.
   */
  async create(input: CreateInventoryInward, actorId: string): Promise<InventoryInwardDetail> {
    const row = await writing(() =>
      this.db.transaction(async (tx) => {
        const [item] = await tx
          .select({ name: items.name })
          .from(items)
          .where(eq(items.id, input.itemId))
          .limit(1);

        if (!item) {
          throw new NotFoundException("Item not found");
        }

        const [created] = await tx
          .insert(inventoryInward)
          .values({
            ...input,
            itemName: item.name,
            documentDate: input.documentDate ? new Date(input.documentDate) : null,
            isApproved: false,
            ...createdBy(actorId),
          })
          .returning(DETAIL_COLUMNS);

        return created!;
      }),
    );

    return toDetail(row);
  }

  async update(
    id: string,
    input: UpdateInventoryInward,
    actorId: string,
  ): Promise<InventoryInwardDetail> {
    const { documentDate, ...rest } = input;

    const [row] = await writing(() =>
      this.db
        .update(inventoryInward)
        .set({
          ...rest,
          ...(documentDate === undefined
            ? {}
            : { documentDate: documentDate ? new Date(documentDate) : null }),
          ...updatedBy(actorId),
        })
        .where(and(eq(inventoryInward.id, id), eq(inventoryInward.isDeleted, false)))
        .returning(DETAIL_COLUMNS),
    );

    if (!row) {
      throw new NotFoundException("Inventory record not found");
    }
    return toDetail(row);
  }

  /**
   * Sets approval to a stated value. `ApproveInventoryDetails` reads the row and
   * writes the opposite, so two approvers racing land wherever ordering puts
   * them and the API cannot express "approve this" at all.
   */
  async setApproval(
    id: string,
    isApproved: boolean,
    actorId: string,
  ): Promise<InventoryInwardDetail> {
    const [row] = await this.db
      .update(inventoryInward)
      .set({ isApproved, ...updatedBy(actorId) })
      .where(and(eq(inventoryInward.id, id), eq(inventoryInward.isDeleted, false)))
      .returning(DETAIL_COLUMNS);

    if (!row) {
      throw new NotFoundException("Inventory record not found");
    }
    return toDetail(row);
  }

  /**
   * A REAL soft delete.
   *
   * `DeleteInventoryDetails` sets `IsDeleted = true` and then calls `Remove()`
   * on the same entity, so the row leaves the table and the flag write goes
   * nowhere. The list filters on `IsDeleted == false` as if it were a soft
   * delete, which is why nobody has noticed that deleting an inventory row in
   * the old system is unrecoverable.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const [row] = await this.db
      .update(inventoryInward)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(inventoryInward.id, id), eq(inventoryInward.isDeleted, false)))
      .returning({ id: inventoryInward.id });

    if (!row) {
      throw new NotFoundException("Inventory record not found");
    }
  }
}
