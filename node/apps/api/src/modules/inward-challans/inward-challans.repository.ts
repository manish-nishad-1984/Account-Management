import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import type {
  CreateInwardChallan,
  InwardChallanDetail,
  InwardChallanFilters,
  ListQuery,
  SortDirection,
  UpdateInwardChallan,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import {
  inwardChallanDocuments,
  inwardChallans,
  items,
  sites,
  suppliers,
  units,
} from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

/**
 * `documentDate` is deliberately absent — it is nullable, and keyset paging
 * needs a NOT NULL sort column. See the note on `INWARD_CHALLAN_SORT_FIELDS`.
 */
const SORTABLE = {
  createdAt: inwardChallans.createdAt,
  quantity: inwardChallans.quantity,
} as const;

export type InwardChallanSortKey = keyof typeof SORTABLE;

export interface InwardChallanListRow {
  id: string;
  siteId: string;
  siteName: string;
  itemId: string;
  itemName: string;
  supplierId: string | null;
  supplierName: string | null;
  unitId: number;
  unitName: string;
  quantity: string;
  invoiceNo: string | null;
  documentDate: string | null;
  vehicleNumber: string | null;
  receiverName: string | null;
  documentCount: number;
  isApproved: boolean;
  createdAt: string;
}

const DETAIL_COLUMNS = {
  id: inwardChallans.id,
  siteId: inwardChallans.siteId,
  itemId: inwardChallans.itemId,
  supplierId: inwardChallans.supplierId,
  unitId: inwardChallans.unitId,
  quantity: inwardChallans.quantity,
  invoiceNo: inwardChallans.invoiceNo,
  documentDate: inwardChallans.documentDate,
  vehicleNumber: inwardChallans.vehicleNumber,
  receiverName: inwardChallans.receiverName,
  isApproved: inwardChallans.isApproved,
  createdAt: inwardChallans.createdAt,
} as const;

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

type DetailRow = { [K in keyof typeof DETAIL_COLUMNS]: unknown };

const toDetail = (
  row: DetailRow,
  documents: InwardChallanDetail["documents"],
): InwardChallanDetail => ({
  id: row.id as string,
  siteId: row.siteId as string,
  itemId: row.itemId as string,
  supplierId: row.supplierId as string | null,
  unitId: row.unitId as number,
  quantity: row.quantity as string,
  invoiceNo: row.invoiceNo as string | null,
  documentDate: iso(row.documentDate as Date | string | null),
  vehicleNumber: row.vehicleNumber as string | null,
  receiverName: row.receiverName as string | null,
  isApproved: row.isApproved as boolean,
  createdAt: iso(row.createdAt as Date | string) as string,
  documents,
});

/**
 * `VehicleNumber.ToUpper()` in the source throws a NullReferenceException when
 * the field is blank, and the column is nullable and the form does not require
 * it. The normalisation is kept — vehicle numbers are compared by eye and mixed
 * case makes that harder — and applied only when there is something to normalise.
 */
const upperOrNull = (value: string | null | undefined): string | null | undefined =>
  value === null || value === undefined ? value : value.toUpperCase();

@Injectable()
export class InwardChallansRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /**
   * Item name, supplier name, invoice number, vehicle and receiver.
   *
   * The source searches the item name and `Quantity.ToString()` — a numeric
   * column rendered to text and matched by substring, so searching "1" matches
   * every quantity containing the digit. Not reproduced. The invoice number and
   * the vehicle number are what people actually look a challan up by, and the
   * source cannot search either.
   */
  private searchFilter(search: string | undefined) {
    if (!search) {
      return undefined;
    }
    const pattern = `%${search}%`;
    return or(
      ilike(items.name, pattern),
      ilike(suppliers.name, pattern),
      ilike(inwardChallans.invoiceNo, pattern),
      ilike(inwardChallans.vehicleNumber, pattern),
      ilike(inwardChallans.receiverName, pattern),
    );
  }

  private baseFilters(search: string | undefined, filters: InwardChallanFilters) {
    const where = [eq(inwardChallans.isDeleted, false)];

    if (filters.siteId) where.push(eq(inwardChallans.siteId, filters.siteId));
    if (filters.supplierId) where.push(eq(inwardChallans.supplierId, filters.supplierId));
    if (filters.itemId) where.push(eq(inwardChallans.itemId, filters.itemId));
    if (filters.isApproved !== undefined) {
      where.push(eq(inwardChallans.isApproved, filters.isApproved));
    }

    // `GetItemInWordList` accepts startDate and enddate and the screen never
    // sends them, so the capability exists in the source and is unreachable.
    if (filters.fromDate) where.push(gte(inwardChallans.documentDate, new Date(filters.fromDate)));
    if (filters.toDate) where.push(lte(inwardChallans.documentDate, new Date(filters.toDate)));

    const match = this.searchFilter(search);
    if (match) where.push(match);

    return where;
  }

  /**
   * The joins the list and the aggregates share.
   *
   * `suppliers` is LEFT joined: `supplier_id` is nullable, and the source's live
   * create path never writes it, so an inner join would hide every challan
   * created through `AddItemInWordDetails`. The source gets this right —
   * `DefaultIfEmpty()` — and it is the one place it does.
   */
  private countQuery(search: string | undefined, filters: InwardChallanFilters) {
    return this.db
      .select({
        rows: count(),
        // `sum` of a numeric returns numeric, so this stays a decimal STRING all
        // the way to the browser. Casting it to a float here to "make it a
        // number" is how a total of 70013.25 becomes 70013.249999999.
        quantity: sql<string>`coalesce(sum(${inwardChallans.quantity}), 0)::text`,
      })
      .from(inwardChallans)
      .innerJoin(items, eq(inwardChallans.itemId, items.id))
      .innerJoin(units, eq(inwardChallans.unitId, units.id))
      .innerJoin(sites, eq(inwardChallans.siteId, sites.id))
      .leftJoin(suppliers, eq(inwardChallans.supplierId, suppliers.id))
      .where(and(...this.baseFilters(search, filters)));
  }

  async list(
    query: ListQuery,
    filters: InwardChallanFilters = {},
  ): Promise<{ rows: InwardChallanListRow[]; nextCursor: string | null }> {
    const sortKey: InwardChallanSortKey =
      query.sortBy && query.sortBy in SORTABLE
        ? (query.sortBy as InwardChallanSortKey)
        : "createdAt";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const where = this.baseFilters(query.search, filters);

    const seek = keysetWhere(
      sortColumn,
      inwardChallans.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) where.push(seek);

    const documentCount = sql<number>`(
      select count(*)::int from ${inwardChallanDocuments}
      where ${inwardChallanDocuments.challanId} = ${inwardChallans}.id
    )`;

    const rows = await this.db
      .select({
        id: inwardChallans.id,
        siteId: inwardChallans.siteId,
        siteName: sites.name,
        itemId: inwardChallans.itemId,
        itemName: items.name,
        supplierId: inwardChallans.supplierId,
        supplierName: suppliers.name,
        unitId: inwardChallans.unitId,
        unitName: units.name,
        quantity: inwardChallans.quantity,
        invoiceNo: inwardChallans.invoiceNo,
        documentDate: inwardChallans.documentDate,
        vehicleNumber: inwardChallans.vehicleNumber,
        receiverName: inwardChallans.receiverName,
        documentCount,
        isApproved: inwardChallans.isApproved,
        createdAt: inwardChallans.createdAt,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(inwardChallans)
      .innerJoin(items, eq(inwardChallans.itemId, items.id))
      .innerJoin(units, eq(inwardChallans.unitId, units.id))
      .innerJoin(sites, eq(inwardChallans.siteId, sites.id))
      .leftJoin(suppliers, eq(inwardChallans.supplierId, suppliers.id))
      .where(and(...where))
      .orderBy(...keysetOrder(sortColumn, inwardChallans.id, direction))
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
   * The row count AND the quantity total, over the whole filtered set.
   *
   * One query for both, because they are the same aggregate. The source computes
   * them correctly and then returns them by writing `TotalRows` and
   * `TotalQuantity` onto `list[0]` — so both are LOST when the filter matches
   * nothing, which is precisely when a footer reading `0.00` would tell the user
   * their filter worked rather than that the screen broke.
   */
  async totals(
    search?: string,
    filters: InwardChallanFilters = {},
  ): Promise<{ rows: number; quantity: string }> {
    const [row] = await this.countQuery(search, filters);
    return { rows: row?.rows ?? 0, quantity: row?.quantity ?? "0" };
  }

  /**
   * The attachments on a challan, oldest first.
   *
   * `storageKey` is read and NOT returned. It is a location in the storage
   * driver, the browser has no use for it, and the only thing a client needs to
   * know is whether there are bytes behind the name — which is what
   * `isDownloadable` says. Every row the ETL carries has a name and no key,
   * because the source's own table records nothing more.
   */
  private async documentsFor(challanId: string): Promise<InwardChallanDetail["documents"]> {
    const rows = await this.db
      .select({
        id: inwardChallanDocuments.id,
        documentName: inwardChallanDocuments.documentName,
        contentType: inwardChallanDocuments.contentType,
        sizeBytes: inwardChallanDocuments.sizeBytes,
        storageKey: inwardChallanDocuments.storageKey,
        createdAt: inwardChallanDocuments.createdAt,
      })
      .from(inwardChallanDocuments)
      .where(eq(inwardChallanDocuments.challanId, challanId))
      .orderBy(inwardChallanDocuments.createdAt);

    return rows.map((row) => ({
      id: row.id,
      documentName: row.documentName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      isDownloadable: row.storageKey !== null,
      uploadedAt: iso(row.createdAt) as string,
    }));
  }

  async findById(id: string): Promise<InwardChallanDetail> {
    const [row] = await this.db
      .select(DETAIL_COLUMNS)
      .from(inwardChallans)
      .where(and(eq(inwardChallans.id, id), eq(inwardChallans.isDeleted, false)))
      .limit(1);

    if (!row) {
      throw new NotFoundException("Inward challan not found");
    }
    return toDetail(row, await this.documentsFor(id));
  }

  /**
   * ONE create path, writing every field it is given.
   *
   * The source has two. `AddItemInWordDetails` — the one in the registered
   * repository — drops `SupplierId` and `InvoiceNo` on the floor and overwrites
   * the date with `DateTime.Now`, though all three are displayed on the list it
   * feeds. `InsertMultipleItemInWordDetails`, in the same file, writes them.
   */
  async create(input: CreateInwardChallan, actorId: string): Promise<InwardChallanDetail> {
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
          .insert(inwardChallans)
          .values({
            ...input,
            itemName: item.name,
            vehicleNumber: upperOrNull(input.vehicleNumber) ?? null,
            // The date GIVEN, not the date of keying.
            documentDate: input.documentDate ? new Date(input.documentDate) : null,
            isApproved: false,
            ...createdBy(actorId),
          })
          .returning(DETAIL_COLUMNS);

        return created!;
      }),
    );

    return toDetail(row, []);
  }

  async update(
    id: string,
    input: UpdateInwardChallan,
    actorId: string,
  ): Promise<InwardChallanDetail> {
    const { documentDate, vehicleNumber, ...rest } = input;

    const [row] = await writing(() =>
      this.db
        .update(inwardChallans)
        .set({
          ...rest,
          ...(vehicleNumber === undefined ? {} : { vehicleNumber: upperOrNull(vehicleNumber) ?? null }),
          ...(documentDate === undefined
            ? {}
            : { documentDate: documentDate ? new Date(documentDate) : null }),
          ...updatedBy(actorId),
        })
        .where(and(eq(inwardChallans.id, id), eq(inwardChallans.isDeleted, false)))
        .returning(DETAIL_COLUMNS),
    );

    if (!row) {
      throw new NotFoundException("Inward challan not found");
    }
    return toDetail(row, await this.documentsFor(id));
  }

  /** Stated, not toggled. `ItemInWordIsApproved` reads the row and writes the opposite. */
  async setApproval(
    id: string,
    isApproved: boolean,
    actorId: string,
  ): Promise<InwardChallanDetail> {
    const [row] = await this.db
      .update(inwardChallans)
      .set({ isApproved, ...updatedBy(actorId) })
      .where(and(eq(inwardChallans.id, id), eq(inwardChallans.isDeleted, false)))
      .returning(DETAIL_COLUMNS);

    if (!row) {
      throw new NotFoundException("Inward challan not found");
    }
    return toDetail(row, await this.documentsFor(id));
  }

  /**
   * Bulk approval from the dashboard queue — one statement, not one per row.
   *
   * `MultipleItemInWordIsApproved` is one of the seven methods carrying finding
   * P2: it loaded every row in the table and called `Update()` on all of them,
   * so approving one challan issued an UPDATE against every challan, clobbering
   * any concurrent edit. This is the shape it should have had.
   *
   * `eq(isApproved, !isApproved)` excludes rows already in the target state, so
   * a select-all across the queue cannot flip approved rows back off.
   */
  async setApprovalMany(ids: string[], isApproved: boolean, actorId: string): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    const rows = await this.db
      .update(inwardChallans)
      .set({ isApproved, ...updatedBy(actorId) })
      .where(
        and(
          inArray(inwardChallans.id, ids),
          eq(inwardChallans.isDeleted, false),
          eq(inwardChallans.isApproved, !isApproved),
        ),
      )
      .returning({ id: inwardChallans.id });

    return rows.length;
  }

  /**
   * The challan exists and is not deleted — checked BEFORE any file is written.
   *
   * Uploading against a deleted or invented id would otherwise store bytes that
   * nothing references, and an orphaned file is one nobody knows to remove.
   */
  async assertExists(id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: inwardChallans.id })
      .from(inwardChallans)
      .where(and(eq(inwardChallans.id, id), eq(inwardChallans.isDeleted, false)))
      .limit(1);

    if (!row) {
      throw new NotFoundException("Inward challan not found");
    }
  }

  /** Records a stored file against a challan. The bytes are already written. */
  async addDocument(
    challanId: string,
    document: {
      documentName: string;
      storageKey: string;
      contentType: string;
      sizeBytes: number;
    },
    actorId: string,
  ): Promise<void> {
    await writing(() =>
      this.db.insert(inwardChallanDocuments).values({ challanId, ...document, uploadedBy: actorId }),
    );
  }

  /**
   * A document, looked up BY CHALLAN AND BY ID together.
   *
   * Both halves of the path are part of the query on purpose. Fetching by
   * document id alone would let anyone holding one id read it through any
   * challan they can see, which turns a per-challan permission into no
   * permission at all — the classic IDOR. A mismatch is a 404, not a 403: a 403
   * would confirm the id exists somewhere.
   */
  async findDocument(
    challanId: string,
    documentId: string,
  ): Promise<{
    id: string;
    documentName: string;
    contentType: string | null;
    sizeBytes: number | null;
    storageKey: string | null;
  }> {
    const [row] = await this.db
      .select({
        id: inwardChallanDocuments.id,
        documentName: inwardChallanDocuments.documentName,
        contentType: inwardChallanDocuments.contentType,
        sizeBytes: inwardChallanDocuments.sizeBytes,
        storageKey: inwardChallanDocuments.storageKey,
      })
      .from(inwardChallanDocuments)
      .innerJoin(inwardChallans, eq(inwardChallanDocuments.challanId, inwardChallans.id))
      .where(
        and(
          eq(inwardChallanDocuments.id, documentId),
          eq(inwardChallanDocuments.challanId, challanId),
          eq(inwardChallans.isDeleted, false),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException("Attachment not found");
    }
    return row;
  }

  /**
   * Removes the row and hands back the key, so the caller can remove the bytes.
   *
   * The row goes first. If the blob delete then fails, the result is an orphaned
   * file — wasted space, and nothing more. The other order risks a row pointing
   * at bytes that are gone, which is a broken download for as long as the row
   * lives. Given a choice of which failure to keep, keep the cheap one.
   */
  async removeDocument(challanId: string, documentId: string): Promise<string | null> {
    const document = await this.findDocument(challanId, documentId);

    await this.db
      .delete(inwardChallanDocuments)
      .where(eq(inwardChallanDocuments.id, document.id));

    return document.storageKey;
  }

  /** Soft delete, as the source does here — this is the module it gets right. */
  async remove(id: string, actorId: string): Promise<void> {
    const [row] = await this.db
      .update(inwardChallans)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(inwardChallans.id, id), eq(inwardChallans.isDeleted, false)))
      .returning({ id: inwardChallans.id });

    if (!row) {
      throw new NotFoundException("Inward challan not found");
    }
  }
}
