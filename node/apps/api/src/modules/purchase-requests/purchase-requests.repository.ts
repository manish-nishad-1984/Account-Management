import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type {
  CreatePurchaseRequest,
  ListQuery,
  PurchaseRequestDetail,
  SortDirection,
  UpdatePurchaseRequest,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { items, purchaseRequests, sites, units } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";
import { nextDocumentNumber, purchaseRequestNumber } from "../../common/document-number";

const SORTABLE = {
  prNo: purchaseRequests.prNo,
  createdAt: purchaseRequests.createdAt,
  quantity: purchaseRequests.quantity,
} as const;

export type PurchaseRequestSortKey = keyof typeof SORTABLE;

const DOCUMENT_TYPE = "purchase_request";

export interface PurchaseRequestListRow {
  id: string;
  prNo: string;
  siteId: string;
  siteName: string;
  itemId: string | null;
  itemLabel: string;
  itemDescription: string | null;
  unitId: number;
  unitName: string;
  quantity: string;
  documentDate: string | null;
  siteAddress: string | null;
  isApproved: boolean;
  createdAt: string;
}

/**
 * `item_id` is nullable, so the item name comes from a LEFT JOIN and falls back
 * to the request's own free text.
 *
 * The source INNER JOINs `ItemMaster` here, which silently hides every request
 * raised without a catalogue item — the rows are in the table and invisible in
 * the application. Falling back is a deliberate departure, flagged in the schema
 * for sign-off.
 */
const ITEM_LABEL = sql<string>`coalesce(${items.name}, ${purchaseRequests.itemName}, '')`;

const DETAIL_COLUMNS = {
  id: purchaseRequests.id,
  prNo: purchaseRequests.prNo,
  siteId: purchaseRequests.siteId,
  itemId: purchaseRequests.itemId,
  itemName: purchaseRequests.itemName,
  itemDescription: purchaseRequests.itemDescription,
  unitId: purchaseRequests.unitId,
  quantity: purchaseRequests.quantity,
  documentDate: purchaseRequests.documentDate,
  siteAddressId: purchaseRequests.siteAddressId,
  siteAddress: purchaseRequests.siteAddress,
  isApproved: purchaseRequests.isApproved,
  createdAt: purchaseRequests.createdAt,
} as const;

/** Timestamps cross the wire as ISO strings; `null` stays `null`. */
const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

type DetailRow = {
  [K in keyof typeof DETAIL_COLUMNS]: unknown;
};

const toDetail = (row: DetailRow): PurchaseRequestDetail => ({
  id: row.id as string,
  prNo: row.prNo as string,
  siteId: row.siteId as string,
  itemId: row.itemId as string | null,
  itemName: row.itemName as string | null,
  itemDescription: row.itemDescription as string | null,
  unitId: row.unitId as number,
  quantity: row.quantity as string,
  documentDate: iso(row.documentDate as Date | string | null),
  siteAddressId: row.siteAddressId as number | null,
  siteAddress: row.siteAddress as string | null,
  isApproved: row.isApproved as boolean,
  createdAt: iso(row.createdAt as Date | string) as string,
});

@Injectable()
export class PurchaseRequestsRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /** Request number, item name and free text — how a request is looked up. */
  private searchFilter(search: string | undefined) {
    if (!search) {
      return undefined;
    }
    const pattern = `%${search}%`;
    return or(
      ilike(purchaseRequests.prNo, pattern),
      ilike(purchaseRequests.itemName, pattern),
      ilike(items.name, pattern),
    );
  }

  async list(
    query: ListQuery,
    filters: { siteId?: string; isApproved?: boolean } = {},
  ): Promise<{ rows: PurchaseRequestListRow[]; nextCursor: string | null }> {
    const sortKey: PurchaseRequestSortKey =
      query.sortBy && query.sortBy in SORTABLE
        ? (query.sortBy as PurchaseRequestSortKey)
        : "prNo";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const where = this.baseFilters(query.search, filters);

    const seek = keysetWhere(
      sortColumn,
      purchaseRequests.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      where.push(seek);
    }

    const rows = await this.db
      .select({
        id: purchaseRequests.id,
        prNo: purchaseRequests.prNo,
        siteId: purchaseRequests.siteId,
        siteName: sites.name,
        itemId: purchaseRequests.itemId,
        itemLabel: ITEM_LABEL,
        itemDescription: purchaseRequests.itemDescription,
        unitId: purchaseRequests.unitId,
        unitName: units.name,
        quantity: purchaseRequests.quantity,
        documentDate: purchaseRequests.documentDate,
        siteAddress: purchaseRequests.siteAddress,
        isApproved: purchaseRequests.isApproved,
        createdAt: purchaseRequests.createdAt,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(purchaseRequests)
      .innerJoin(sites, eq(purchaseRequests.siteId, sites.id))
      .innerJoin(units, eq(purchaseRequests.unitId, units.id))
      .leftJoin(items, eq(purchaseRequests.itemId, items.id))
      .where(and(...where))
      .orderBy(...keysetOrder(sortColumn, purchaseRequests.id, direction))
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

  /**
   * The site is INNER JOINed but NOT filtered on `sites.is_active`.
   *
   * The source adds `c.IsActive == true`, so deactivating a site erases its
   * purchase-request history from the list rather than hiding the site. Carried
   * as a departure for the same reason as the item join: the rows exist and
   * nothing says they should not be readable.
   */
  private baseFilters(
    search: string | undefined,
    { siteId, isApproved }: { siteId?: string; isApproved?: boolean },
  ) {
    const where = [eq(purchaseRequests.isDeleted, false)];

    if (siteId) {
      where.push(eq(purchaseRequests.siteId, siteId));
    }
    if (isApproved !== undefined) {
      where.push(eq(purchaseRequests.isApproved, isApproved));
    }

    const match = this.searchFilter(search);
    if (match) {
      where.push(match);
    }
    return where;
  }

  async total(
    search?: string,
    filters: { siteId?: string; isApproved?: boolean } = {},
  ): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(purchaseRequests)
      .leftJoin(items, eq(purchaseRequests.itemId, items.id))
      .where(and(...this.baseFilters(search, filters)));
    return row?.value ?? 0;
  }

  async findById(id: string): Promise<PurchaseRequestDetail> {
    const [row] = await this.db
      .select(DETAIL_COLUMNS)
      .from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, id), eq(purchaseRequests.isDeleted, false)))
      .limit(1);

    if (!row) {
      throw new NotFoundException("Purchase request not found");
    }
    return toDetail(row);
  }

  /**
   * Allocates the next document number for a financial year, atomically.
   *
   * The mechanism moved to `common/document-number.ts` when purchase orders
   * needed the same sequence with a company dimension. Two copies of an upsert
   * that hands out document numbers is exactly the kind of duplication the source
   * has — `CheckPRNo` and `CheckPONo` are separate implementations, wrong in
   * DIFFERENT ways — so there is one here.
   *
   * A purchase request sequence is global: no company, `PR/25-26/001`.
   */
  private async nextNumber(tx: Database, now: Date): Promise<string> {
    return nextDocumentNumber(tx, {
      documentType: DOCUMENT_TYPE,
      format: purchaseRequestNumber,
      now,
    });
  }

  /**
   * Creates a request, issuing its number in the SAME transaction.
   *
   * The source asked the API for a number, put it in the form, and posted it
   * back on submit — so the number was allocated when the form opened and
   * confirmed only when it was saved, if ever. Two open forms, one number.
   */
  async create(input: CreatePurchaseRequest, actorId: string): Promise<PurchaseRequestDetail> {
    const now = new Date();

    const row = await writing(() =>
      this.db.transaction(async (tx) => {
        const prNo = await this.nextNumber(tx as unknown as Database, now);

        const [created] = await tx
          .insert(purchaseRequests)
          .values({
            ...input,
            prNo,
            documentDate: input.documentDate ? new Date(input.documentDate) : null,
            ...createdBy(actorId),
          })
          .returning(DETAIL_COLUMNS);

        return created!;
      }),
    );

    return toDetail(row);
  }

  /**
   * `prNo` is absent from `UpdatePurchaseRequest` by construction, so a number
   * cannot be reassigned here even if a client sends one.
   */
  async update(
    id: string,
    input: UpdatePurchaseRequest,
    actorId: string,
  ): Promise<PurchaseRequestDetail> {
    const { documentDate, ...rest } = input;

    const [row] = await writing(() =>
      this.db
        .update(purchaseRequests)
        .set({
          ...rest,
          ...(documentDate === undefined
            ? {}
            : { documentDate: documentDate ? new Date(documentDate) : null }),
          ...updatedBy(actorId),
        })
        .where(and(eq(purchaseRequests.id, id), eq(purchaseRequests.isDeleted, false)))
        .returning(DETAIL_COLUMNS),
    );

    if (!row) {
      throw new NotFoundException("Purchase request not found");
    }
    return toDetail(row);
  }

  /**
   * Sets approval to a stated value rather than toggling it.
   *
   * Returns the row so the caller can see what it became. The source returns the
   * entity it just mutated and a message naming the direction, which is the same
   * information — but arrived at by flipping whatever was there.
   */
  async setApproval(
    id: string,
    isApproved: boolean,
    actorId: string,
  ): Promise<PurchaseRequestDetail> {
    const [row] = await this.db
      .update(purchaseRequests)
      .set({ isApproved, ...updatedBy(actorId) })
      .where(and(eq(purchaseRequests.id, id), eq(purchaseRequests.isDeleted, false)))
      .returning(DETAIL_COLUMNS);

    if (!row) {
      throw new NotFoundException("Purchase request not found");
    }
    return toDetail(row);
  }

  /**
   * Bulk approve or unapprove, in ONE statement.
   *
   * The .NET original loaded every row it was given and called `Update()` on
   * each, and before the fix in this repository it loaded the entire table —
   * finding P2. A single UPDATE ... WHERE id = ANY(...) touches exactly the rows
   * named, takes no round trip per row, and is atomic without a transaction.
   *
   * Rows already in the target state are included in the WHERE but change
   * nothing, so `updated` reports rows that actually moved.
   */
  async setApprovalMany(ids: string[], isApproved: boolean, actorId: string): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    const rows = await this.db
      .update(purchaseRequests)
      .set({ isApproved, ...updatedBy(actorId) })
      .where(
        and(
          inArray(purchaseRequests.id, ids),
          eq(purchaseRequests.isDeleted, false),
          eq(purchaseRequests.isApproved, !isApproved),
        ),
      )
      .returning({ id: purchaseRequests.id });

    return rows.length;
  }

  /**
   * Soft delete, matching the source.
   *
   * No in-use check: purchase orders reference a request only by loose text
   * today and that table is not migrated, so a count would pass every time while
   * looking like a guard. Revisit in Phase 4, when the PO↔request link becomes
   * a real foreign key.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const [row] = await this.db
      .update(purchaseRequests)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(purchaseRequests.id, id), eq(purchaseRequests.isDeleted, false)))
      .returning({ id: purchaseRequests.id });

    if (!row) {
      throw new NotFoundException("Purchase request not found");
    }
  }
}
