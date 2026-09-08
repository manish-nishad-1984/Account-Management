import { Inject, Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { and, count, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { purchaseOrderTotal } from "@accountmanagement/domain";
import type {
  CreatePurchaseOrder,
  ListQuery,
  PurchaseOrderDetail,
  PurchaseOrderItemRow,
  PurchaseOrderLineInput,
  SortDirection,
  UpdatePurchaseOrder,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import {
  companies,
  items,
  purchaseOrderItems,
  purchaseOrders,
  sites,
  suppliers,
  units,
} from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";
import { nextDocumentNumber, purchaseOrderNumber } from "../../common/document-number";

const SORTABLE = {
  poNo: purchaseOrders.poNo,
  createdAt: purchaseOrders.createdAt,
  totalAmount: purchaseOrders.totalAmount,
} as const;

export type PurchaseOrderSortKey = keyof typeof SORTABLE;

const DOCUMENT_TYPE = "purchase_order";

export interface PurchaseOrderListRow {
  id: string;
  poNo: string;
  siteId: string;
  siteName: string;
  supplierId: string;
  supplierName: string;
  companyId: string;
  companyName: string;
  documentDate: string | null;
  buyersPurchaseNo: string | null;
  subtotal: string;
  totalGstAmount: string;
  totalAmount: string;
  lineCount: number;
  isActive: boolean;
  isApproved: boolean;
  createdAt: string;
}

/** See `purchase_requests`: a line with no catalogue item is labelled by its text. */
const ITEM_LABEL = sql<string>`coalesce(${items.name}, ${purchaseOrderItems.itemName}, '')`;

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

const HEADER_COLUMNS = {
  id: purchaseOrders.id,
  poNo: purchaseOrders.poNo,
  siteId: purchaseOrders.siteId,
  supplierId: purchaseOrders.supplierId,
  companyId: purchaseOrders.companyId,
  siteGroupId: purchaseOrders.siteGroupId,
  documentDate: purchaseOrders.documentDate,
  deliveryDate: purchaseOrders.deliveryDate,
  deliveryImmediate: purchaseOrders.deliveryImmediate,
  terms: purchaseOrders.terms,
  description: purchaseOrders.description,
  billingAddress: purchaseOrders.billingAddress,
  groupAddress: purchaseOrders.groupAddress,
  buyersPurchaseNo: purchaseOrders.buyersPurchaseNo,
  contactName: purchaseOrders.contactName,
  contactNumber: purchaseOrders.contactNumber,
  otherContactName: purchaseOrders.otherContactName,
  otherContactNumber: purchaseOrders.otherContactNumber,
  dispatchBy: purchaseOrders.dispatchBy,
  paymentTerms: purchaseOrders.paymentTerms,
  subtotal: purchaseOrders.subtotal,
  totalGstAmount: purchaseOrders.totalGstAmount,
  totalAmount: purchaseOrders.totalAmount,
  totalDiscount: purchaseOrders.totalDiscount,
  isActive: purchaseOrders.isActive,
  isApproved: purchaseOrders.isApproved,
  createdAt: purchaseOrders.createdAt,
} as const;

@Injectable()
export class PurchaseOrdersRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /** Order number, buyer's number and supplier — how an order is looked up. */
  private searchFilter(search: string | undefined) {
    if (!search) {
      return undefined;
    }
    const pattern = `%${search}%`;
    return or(
      ilike(purchaseOrders.poNo, pattern),
      ilike(purchaseOrders.buyersPurchaseNo, pattern),
      ilike(suppliers.name, pattern),
    );
  }

  /**
   * `isActive` is a FILTER here and defaults to undefined (everything).
   *
   * The legacy list defaults its status dropdown to **Active**, not All —
   * `07-purchase-orders.md`. That default belongs in the screen, which can say
   * what it is filtering, rather than in the repository, where a caller asking
   * for "all orders" would silently get some of them.
   */
  private baseFilters(
    search: string | undefined,
    {
      siteId,
      supplierId,
      isApproved,
      isActive,
    }: { siteId?: string; supplierId?: string; isApproved?: boolean; isActive?: boolean },
  ) {
    const where = [eq(purchaseOrders.isDeleted, false)];

    if (siteId) {
      where.push(eq(purchaseOrders.siteId, siteId));
    }
    if (supplierId) {
      where.push(eq(purchaseOrders.supplierId, supplierId));
    }
    if (isApproved !== undefined) {
      where.push(eq(purchaseOrders.isApproved, isApproved));
    }
    if (isActive !== undefined) {
      where.push(eq(purchaseOrders.isActive, isActive));
    }

    const match = this.searchFilter(search);
    if (match) {
      where.push(match);
    }
    return where;
  }

  async list(
    query: ListQuery,
    filters: { siteId?: string; supplierId?: string; isApproved?: boolean; isActive?: boolean } = {},
  ): Promise<{ rows: PurchaseOrderListRow[]; nextCursor: string | null }> {
    const sortKey: PurchaseOrderSortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as PurchaseOrderSortKey) : "poNo";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const where = this.baseFilters(query.search, filters);

    const seek = keysetWhere(
      sortColumn,
      purchaseOrders.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      where.push(seek);
    }

    // The line count is a correlated subquery rather than a join with a GROUP BY:
    // grouping the header by every selected column to count its children is both
    // slower and a trap the moment a nullable column joins the select list.
    const lineCount = sql<number>`(
      select count(*)::int from ${purchaseOrderItems}
      where ${purchaseOrderItems.purchaseOrderId} = ${purchaseOrders}.id
    )`;

    const rows = await this.db
      .select({
        id: purchaseOrders.id,
        poNo: purchaseOrders.poNo,
        siteId: purchaseOrders.siteId,
        siteName: sites.name,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        companyId: purchaseOrders.companyId,
        companyName: companies.name,
        documentDate: purchaseOrders.documentDate,
        buyersPurchaseNo: purchaseOrders.buyersPurchaseNo,
        subtotal: purchaseOrders.subtotal,
        totalGstAmount: purchaseOrders.totalGstAmount,
        totalAmount: purchaseOrders.totalAmount,
        lineCount,
        isActive: purchaseOrders.isActive,
        isApproved: purchaseOrders.isApproved,
        createdAt: purchaseOrders.createdAt,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(purchaseOrders)
      .innerJoin(sites, eq(purchaseOrders.siteId, sites.id))
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .innerJoin(companies, eq(purchaseOrders.companyId, companies.id))
      .where(and(...where))
      .orderBy(...keysetOrder(sortColumn, purchaseOrders.id, direction))
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
    filters: { siteId?: string; supplierId?: string; isApproved?: boolean; isActive?: boolean } = {},
  ): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(and(...this.baseFilters(search, filters)));
    return row?.value ?? 0;
  }

  private async lines(purchaseOrderId: string): Promise<PurchaseOrderItemRow[]> {
    const rows = await this.db
      .select({
        id: purchaseOrderItems.id,
        itemId: purchaseOrderItems.itemId,
        itemLabel: ITEM_LABEL,
        itemDescription: purchaseOrderItems.itemDescription,
        hsnCode: items.hsnCode,
        unitId: purchaseOrderItems.unitId,
        unitName: units.name,
        quantity: purchaseOrderItems.quantity,
        unitPrice: purchaseOrderItems.unitPrice,
        gstPercent: purchaseOrderItems.gstPercent,
        gstAmount: purchaseOrderItems.gstAmount,
        lineTotal: purchaseOrderItems.lineTotal,
        lineNumber: purchaseOrderItems.lineNumber,
      })
      .from(purchaseOrderItems)
      .innerJoin(units, eq(purchaseOrderItems.unitId, units.id))
      .leftJoin(items, eq(purchaseOrderItems.itemId, items.id))
      .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId))
      .orderBy(purchaseOrderItems.lineNumber);

    return rows;
  }

  async findById(id: string): Promise<PurchaseOrderDetail> {
    const [header] = await this.db
      .select(HEADER_COLUMNS)
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.isDeleted, false)))
      .limit(1);

    if (!header) {
      throw new NotFoundException("Purchase order not found");
    }

    return {
      ...header,
      documentDate: iso(header.documentDate),
      deliveryDate: iso(header.deliveryDate),
      createdAt: iso(header.createdAt) as string,
      items: await this.lines(id),
    };
  }

  /**
   * Computes every derived money value for a set of lines.
   *
   * The client sends quantity, price and GST percent; everything else is worked
   * out here. `purchaseOrderTotal` is the shared reproduction of the one
   * calculator this screen runs — see `packages/domain/src/purchase-order-total.ts`.
   */
  private priced(lines: PurchaseOrderLineInput[]) {
    const totals = purchaseOrderTotal.compute(
      lines.map((line) => ({
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        gstPercent: line.gstPercent ?? undefined,
      })),
    );

    return {
      totals,
      rows: lines.map((line, index) => ({
        itemId: line.itemId,
        itemName: line.itemName,
        itemDescription: line.itemDescription,
        unitId: line.unitId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        gstPercent: line.gstPercent,
        discount: line.discount,
        gstAmount: totals.lines[index]!.gstAmount,
        lineTotal: totals.lines[index]!.total,
        lineNumber: index + 1,
      })),
    };
  }

  /**
   * The company's invoice prefix leads its order numbers, so an order cannot be
   * numbered without one.
   *
   * The source reads `CompanyDetails.InvoicePef.Trim()` with no null check, which
   * is a NullReferenceException for any company that has not been given one — and
   * `invoice_prefix` is nullable. That exception is then swallowed by the same
   * catch that returns "Error generating Purchase Order number." as the number.
   * Refused here, in a sentence that says what to do about it.
   */
  private async invoicePrefix(tx: Database, companyId: string): Promise<string> {
    const [company] = await tx
      .select({ name: companies.name, invoicePrefix: companies.invoicePrefix })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    if (!company) {
      throw new NotFoundException("Company not found");
    }
    const prefix = company.invoicePrefix?.trim();
    if (!prefix) {
      throw new BadRequestException(
        `${company.name} has no invoice prefix, so its purchase orders cannot be numbered. Set one on the company first.`,
      );
    }
    return prefix;
  }

  /**
   * Creates an order and its lines, issuing the number in the SAME transaction.
   *
   * Everything is one transaction on purpose. The source writes the header, then
   * loops the detail rows with a `SaveChangesAsync` each, with no transaction
   * anywhere in 10,304 lines of repository — so a failure halfway leaves a header
   * with some of its lines and a total that matches none of them.
   */
  async create(input: CreatePurchaseOrder, actorId: string): Promise<PurchaseOrderDetail> {
    const now = new Date();
    const { totals, rows } = this.priced(input.items);

    const id = await writing(() =>
      this.db.transaction(async (tx) => {
        const handle = tx as unknown as Database;
        const prefix = await this.invoicePrefix(handle, input.companyId);

        const poNo = await nextDocumentNumber(handle, {
          documentType: DOCUMENT_TYPE,
          companyId: input.companyId,
          format: purchaseOrderNumber(prefix),
          now,
        });

        const { items: _lines, ...header } = input;

        const [created] = await tx
          .insert(purchaseOrders)
          .values({
            ...header,
            poNo,
            documentDate: header.documentDate ? new Date(header.documentDate) : null,
            deliveryDate: header.deliveryDate ? new Date(header.deliveryDate) : null,
            subtotal: totals.subtotal,
            totalGstAmount: totals.totalGst,
            totalAmount: totals.grandTotal,
            ...createdBy(actorId),
          })
          .returning({ id: purchaseOrders.id });

        const orderId = created!.id;

        await tx
          .insert(purchaseOrderItems)
          .values(rows.map((row) => ({ ...row, purchaseOrderId: orderId, ...createdBy(actorId) })));

        return orderId;
      }),
    );

    return this.findById(id);
  }

  /**
   * Updates an order, replacing its lines wholesale when any are sent.
   *
   * `items` is all-or-nothing: the grid has no stable client-side line identity,
   * so a partial update cannot say which row it means. Delete-and-reinsert inside
   * one transaction is what the source does too, minus the transaction.
   *
   * The totals are recomputed whenever the lines change. They are never taken
   * from the body — see the contract.
   */
  async update(
    id: string,
    input: UpdatePurchaseOrder,
    actorId: string,
  ): Promise<PurchaseOrderDetail> {
    const now = new Date();
    const { items: lines, ...header } = input;

    await writing(() =>
      this.db.transaction(async (tx) => {
        const patch: Record<string, unknown> = { ...header, ...updatedBy(actorId) };

        if (header.documentDate !== undefined) {
          patch.documentDate = header.documentDate ? new Date(header.documentDate) : null;
        }
        if (header.deliveryDate !== undefined) {
          patch.deliveryDate = header.deliveryDate ? new Date(header.deliveryDate) : null;
        }

        if (lines !== undefined) {
          const { totals, rows } = this.priced(lines);
          patch.subtotal = totals.subtotal;
          patch.totalGstAmount = totals.totalGst;
          patch.totalAmount = totals.grandTotal;

          await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id));
          await tx
            .insert(purchaseOrderItems)
            .values(
              rows.map((row) => ({ ...row, purchaseOrderId: id, ...createdBy(actorId) })),
            );
        }

        const [updated] = await tx
          .update(purchaseOrders)
          .set({ ...patch, updatedAt: now })
          .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.isDeleted, false)))
          .returning({ id: purchaseOrders.id });

        if (!updated) {
          throw new NotFoundException("Purchase order not found");
        }
      }),
    );

    return this.findById(id);
  }

  /** States the approval rather than toggling it — see purchase requests. */
  async setApproval(
    id: string,
    isApproved: boolean,
    actorId: string,
  ): Promise<PurchaseOrderDetail> {
    const [updated] = await this.db
      .update(purchaseOrders)
      .set({ isApproved, ...updatedBy(actorId) })
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.isDeleted, false)))
      .returning({ id: purchaseOrders.id });

    if (!updated) {
      throw new NotFoundException("Purchase order not found");
    }
    return this.findById(id);
  }

  /**
   * One UPDATE for the whole selection, skipping rows already in the target
   * state — so select-all over a queue containing approved rows does not flip
   * them off, and `updated` is what actually changed. Same shape as §5p.
   */
  async setApprovalMany(ids: string[], isApproved: boolean, actorId: string): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const updated = await this.db
      .update(purchaseOrders)
      .set({ isApproved, ...updatedBy(actorId) })
      .where(
        and(
          inArray(purchaseOrders.id, ids),
          eq(purchaseOrders.isDeleted, false),
          eq(purchaseOrders.isApproved, !isApproved),
        ),
      )
      .returning({ id: purchaseOrders.id });

    return updated.length;
  }

  /**
   * Soft delete. The lines are left in place: they carry an `on delete cascade`
   * for a REAL delete, and a soft delete must not fire it — the detail rows are
   * how a deleted order is reconstructed if the delete was a mistake.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const [removed] = await this.db
      .update(purchaseOrders)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.isDeleted, false)))
      .returning({ id: purchaseOrders.id });

    if (!removed) {
      throw new NotFoundException("Purchase order not found");
    }
  }
}
