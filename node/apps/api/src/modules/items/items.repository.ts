import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import {
  ITEM_NAME_CHECK_LIMIT,
  duplicateItemNameMessage,
  normalizeItemName,
  type CreateItem,
  type ItemDetail,
  type ItemNameCheck,
  type ItemPriceChangeSource,
  type ListQuery,
  type SortDirection,
  type UpdateItem,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { itemPriceChanges, items, units } from "../../db/schema";
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

/**
 * An item's name as `normalizeItemName` would write it, lower-cased, in SQL.
 *
 * The pattern goes in as a PARAMETER. Written inline, the backslash has to
 * survive a JavaScript template literal and then SQL string rules, and a lost
 * backslash turns it into the letter s — which matches every name containing
 * one.
 */
const WHITESPACE_RUN = "\\s+";
const NORMALIZED_NAME = sql`lower(regexp_replace(btrim(${items.name}), ${WHITESPACE_RUN}, ' ', 'g'))`;

/** A typed fragment for LIKE, with its own wildcards made literal. */
const likeFragment = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The two columns a price history row records, either side of a save. */
interface PriceState {
  pricePerUnit: string;
  gstPercent: string | null;
}

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
    const name = normalizeItemName(input.name);
    await this.refuseDuplicateName(name, null);

    return writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(items)
          .values({ ...input, name, ...createdBy(actorId) })
          .returning(DETAIL_COLUMNS);

        await this.recordPriceChange(tx as unknown as Database, row!.id, "created", null, row!, actorId);
        return row!;
      }),
    );
  }

  /**
   * A save that changes the price or the GST rate writes a history row, in the
   * same transaction. The current row is read `FOR UPDATE` first, so two people
   * saving at once each record the price they actually replaced.
   */
  async update(id: string, input: UpdateItem, actorId: string): Promise<ItemDetail> {
    const values =
      input.name === undefined ? input : { ...input, name: normalizeItemName(input.name) };
    if (values.name !== undefined) {
      await this.refuseDuplicateName(values.name, id);
    }

    return writing(() =>
      this.db.transaction(async (tx) => {
        const [before] = await tx
          .select({ pricePerUnit: items.pricePerUnit, gstPercent: items.gstPercent })
          .from(items)
          .where(and(eq(items.id, id), eq(items.isDeleted, false)))
          .for("update");

        if (!before) {
          throw new NotFoundException("Item not found");
        }

        const [row] = await tx
          .update(items)
          .set({ ...values, ...updatedBy(actorId) })
          .where(eq(items.id, id))
          .returning(DETAIL_COLUMNS);

        await this.recordPriceChange(tx as unknown as Database, id, "edited", before, row!, actorId);
        return row!;
      }),
    );
  }

  /**
   * THE DUPLICATE CHECK, ahead of the unique index.
   *
   * The index on `lower(name)` stays the guarantee under concurrency. This check
   * exists for what the index cannot see — two names that differ only in
   * spacing — and to name the item that is already there, which a constraint
   * violation cannot.
   */
  private async refuseDuplicateName(name: string, excludeId: string | null): Promise<void> {
    const existing = await this.exactNameMatch(name, excludeId);
    if (existing) {
      const message = duplicateItemNameMessage(existing.name);
      throw new ConflictException({ message, issues: [{ path: "name", message }] });
    }
  }

  private async exactNameMatch(name: string, excludeId: string | null) {
    const filters: SQL[] = [
      eq(items.isDeleted, false),
      sql`${NORMALIZED_NAME} = lower(${normalizeItemName(name)})`,
    ];
    if (excludeId) filters.push(ne(items.id, excludeId));

    const [row] = await this.db
      .select({ id: items.id, name: items.name })
      .from(items)
      .where(and(...filters))
      .limit(1);
    return row ?? null;
  }

  /**
   * What the item form shows under the name box as it is typed.
   *
   * `similar` matches items containing EVERY word typed, anywhere in the name,
   * so word order does not hide a near-duplicate. The exact match is reported
   * once, as `exact`, and left out of `similar`.
   */
  async nameCheck(name: string, excludeId: string | null): Promise<ItemNameCheck> {
    const normalized = normalizeItemName(name);
    const exact = await this.exactNameMatch(normalized, excludeId);

    const words = normalized.split(" ").filter(Boolean).slice(0, 6);
    const filters: SQL[] = [eq(items.isDeleted, false)];
    for (const word of words) {
      filters.push(ilike(items.name, likeFragment(word)));
    }
    if (excludeId) filters.push(ne(items.id, excludeId));
    if (exact) filters.push(ne(items.id, exact.id));

    const similar = await this.db
      .select({ id: items.id, name: items.name })
      .from(items)
      .where(and(...filters))
      .orderBy(asc(items.name))
      .limit(ITEM_NAME_CHECK_LIMIT);

    return { exact, similar };
  }

  /**
   * One history row, or none when neither the price nor the GST rate moved.
   *
   * Compared by value, not as strings: `numeric` hands back "18.00" where a form
   * may send "18", and those are the same rate.
   */
  private async recordPriceChange(
    tx: Database,
    itemId: string,
    source: ItemPriceChangeSource,
    before: PriceState | null,
    after: PriceState,
    actorId: string,
  ): Promise<void> {
    const same = (a: string | null, b: string | null) =>
      a === null || b === null ? a === b : Number(a) === Number(b);

    if (
      before &&
      same(before.pricePerUnit, after.pricePerUnit) &&
      same(before.gstPercent, after.gstPercent)
    ) {
      return;
    }

    await tx.insert(itemPriceChanges).values({
      itemId,
      source,
      oldPrice: before?.pricePerUnit ?? null,
      newPrice: after.pricePerUnit,
      oldGstPercent: before?.gstPercent ?? null,
      newGstPercent: after.gstPercent,
      changedBy: actorId,
    });
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

    // Keyed and matched on the NORMALISED name, the same rule the item form uses,
    // so "OPC  Cement" in a sheet finds the "OPC Cement" already in the catalogue.
    const key = (name: string) => normalizeItemName(name).toLowerCase();
    const lowered = [...new Set(names.map(key))];
    const rows = await this.db
      .select({ id: items.id, name: items.name, isDeleted: items.isDeleted })
      .from(items)
      .where(inArray(NORMALIZED_NAME, lowered));

    // A live item wins over a deleted one with the same name, so the import
    // reports the duplicate rather than reviving the deleted row beside it.
    const found = new Map<string, { id: string; isDeleted: boolean; name: string }>();
    for (const row of rows) {
      const current = found.get(key(row.name));
      if (!current || (current.isDeleted && !row.isDeleted)) found.set(key(row.name), row);
    }
    return found;
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
          const made = await tx
            .insert(items)
            .values(creates.map((row) => ({ ...row, ...createdBy(actorId) })))
            .returning({ id: items.id, pricePerUnit: items.pricePerUnit, gstPercent: items.gstPercent });
          // Every imported item's first price goes into its history too.
          await tx.insert(itemPriceChanges).values(
            made.map((row) => ({
              itemId: row.id,
              source: "imported",
              newPrice: row.pricePerUnit,
              newGstPercent: row.gstPercent,
              changedBy: actorId,
            })),
          );
        }
        for (const revive of revives) {
          const [before] = await tx
            .select({ pricePerUnit: items.pricePerUnit, gstPercent: items.gstPercent })
            .from(items)
            .where(eq(items.id, revive.id));
          const [after] = await tx
            .update(items)
            .set({ ...revive.values, isDeleted: false, ...updatedBy(actorId) })
            .where(eq(items.id, revive.id))
            .returning({ pricePerUnit: items.pricePerUnit, gstPercent: items.gstPercent });
          await this.recordPriceChange(
            tx as unknown as Database,
            revive.id,
            "imported",
            before ?? null,
            after!,
            actorId,
          );
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
