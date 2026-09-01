import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, ilike, sql } from "drizzle-orm";
import type { CreateUnit, ListQuery, SortDirection, UpdateUnit } from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { items, units } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

const SORTABLE = {
  name: units.name,
  createdAt: units.createdAt,
} as const;

export type UnitSortKey = keyof typeof SORTABLE;

export interface UnitListRow {
  id: number;
  name: string;
  itemCount: number;
}

/**
 * Units of measure.
 *
 * The smallest master in the system — `UnitMaster` is two columns and the live
 * table holds a couple of dozen rows — but it is still keyset-paginated and
 * still guarded, because "it is small today" is how the .NET grids ended up
 * loading whole tables.
 */
@Injectable()
export class UnitsRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  async list(query: ListQuery): Promise<{ rows: UnitListRow[]; nextCursor: string | null }> {
    const sortKey: UnitSortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as UnitSortKey) : "name";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const filters = [];
    if (query.search) {
      filters.push(ilike(units.name, `%${query.search}%`));
    }

    const seek = keysetWhere(
      sortColumn,
      units.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      filters.push(seek);
    }

    // The outer reference is table-qualified — `${units}.id`, not `${units.id}`.
    // Drizzle renders a bare column reference UNQUALIFIED inside an `sql`
    // template, so `${units.id}` becomes `"id"` and PostgreSQL binds it to the
    // subquery's own table: the correlation silently becomes `unit_id = id`,
    // matches nothing, and raises no error. See site-groups.repository.ts.
    const itemCount = sql<number>`(
      select count(*)::int from ${items}
      where ${items.unitId} = ${units}.id and ${items.isDeleted} = false
    )`;

    const rows = await this.db
      .select({
        id: units.id,
        name: units.name,
        itemCount,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(units)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(...keysetOrder(sortColumn, units.id, direction))
      .limit(query.limit + 1);

    // The cursor's tiebreaker is a string on the wire and an integer in the
    // column; `id` is serialised here and compared as text by keysetWhere against
    // `units.id`, which PostgreSQL coerces back. Integer keys sort as integers in
    // the ORDER BY, which is what determines the page, so the round trip is safe.
    const page = toPage(rows, query.limit, (row) => ({
      value: row.sortValue,
      id: String(row.id),
    }));
    return {
      rows: page.rows.map(({ sortValue: _ignored, ...row }) => row),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(units)
      .where(search ? ilike(units.name, `%${search}%`) : undefined);
    return row?.value ?? 0;
  }

  async create(input: CreateUnit, actorId: string): Promise<UnitListRow> {
    const [row] = await writing(() =>
      this.db
        .insert(units)
        .values({ ...input, ...createdBy(actorId) })
        .returning({ id: units.id, name: units.name }),
    );
    return { ...row!, itemCount: 0 };
  }

  async update(id: number, input: UpdateUnit, actorId: string): Promise<UnitListRow> {
    const [row] = await writing(() =>
      this.db
        .update(units)
        .set({ ...input, ...updatedBy(actorId) })
        .where(eq(units.id, id))
        .returning({ id: units.id, name: units.name }),
    );

    if (!row) {
      throw new NotFoundException("Unit not found");
    }
    return { ...row, itemCount: await this.itemCount(id) };
  }

  /**
   * A hard delete, refused while any live item uses the unit.
   *
   * `units` has no `is_deleted` — the source table has none either — and adding
   * one would be worse than this: an item would keep a valid `unit_id` pointing
   * at a row the UI has agreed to pretend is gone, so the item's unit column
   * would render blank with nothing to explain it. Refusing with the count says
   * what to do instead.
   *
   * The foreign key is the real guard; this check exists to produce a message
   * rather than a bare 409, and both are in place because the check alone would
   * race.
   */
  async remove(id: number): Promise<void> {
    const inUse = await this.itemCount(id);
    if (inUse > 0) {
      throw new ConflictException(
        `${inUse} ${inUse === 1 ? "item uses" : "items use"} this unit. ` +
          "Change them to another unit before deleting it.",
      );
    }

    const [row] = await writing(() =>
      this.db.delete(units).where(eq(units.id, id)).returning({ id: units.id }),
    );

    if (!row) {
      throw new NotFoundException("Unit not found");
    }
  }

  private async itemCount(unitId: number): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(items)
      .where(and(eq(items.unitId, unitId), eq(items.isDeleted, false)));
    return row?.value ?? 0;
  }
}
