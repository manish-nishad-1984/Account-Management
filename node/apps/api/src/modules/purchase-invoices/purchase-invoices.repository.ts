import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { invoiceTotal } from "@accountmanagement/domain";
import type {
  CreatePurchaseInvoice,
  ListQuery,
  PurchaseInvoiceDetail,
  PurchaseInvoiceItemRow,
  PurchaseInvoiceLineInput,
  SortDirection,
  UpdatePurchaseInvoice,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import {
  companies,
  items,
  purchaseInvoiceItems,
  purchaseInvoices,
  purchaseOrders,
  siteGroups,
  sites,
  suppliers,
  units,
} from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

/**
 * `documentDate` is deliberately absent. It is NULLABLE, and a nullable keyset
 * sort column loses rows: the cursor compares against a NULL, the comparison is
 * neither true nor false, and the page after the first silently drops them. Sort
 * on it only when the column is NOT NULL — `createdAt` is.
 */
const SORTABLE = {
  createdAt: purchaseInvoices.createdAt,
  supplierInvoiceNo: purchaseInvoices.supplierInvoiceNo,
  totalAmount: purchaseInvoices.totalAmount,
} as const;

export type PurchaseInvoiceSortKey = keyof typeof SORTABLE;

/**
 * What the list's InvoiceNo column shows.
 *
 * The source's partial is `@if (item.SupplierInvoiceNo == "")`, which a NULL
 * fails — so an invoice with no supplier number takes the else branch and
 * renders an empty link that cannot be identified or clicked. Here null, empty
 * and whitespace all mean the same thing, and there is a last resort so the
 * column is never blank.
 */
const DISPLAY_NO = sql<string>`coalesce(
  nullif(btrim(${purchaseInvoices.supplierInvoiceNo}), ''),
  nullif(btrim(${purchaseInvoices.invoiceNo}), ''),
  '(no number)'
)`;

/** See `purchase_requests`: a line with no catalogue item is labelled by its text. */
const ITEM_LABEL = sql<string>`coalesce(${items.name}, ${purchaseInvoiceItems.itemName}, '')`;

/**
 * The discount percent, DERIVED rather than stored.
 *
 * Computed in SQL with `numeric`, which is exact decimal arithmetic in
 * Postgres — not `float8`, and not read back into a JavaScript number on the
 * way. A zero price would divide by zero, and a line priced at zero has no
 * meaningful percent, so it reports 0.
 */
const DISCOUNT_PERCENT = sql<string>`case
  when ${purchaseInvoiceItems.unitPrice} = 0 then '0.00'
  else round(${purchaseInvoiceItems.discountPerUnit} / ${purchaseInvoiceItems.unitPrice} * 100, 2)::text
end`;

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

export interface PurchaseInvoiceListRow {
  id: string;
  displayNo: string;
  supplierInvoiceNo: string | null;
  invoiceNo: string | null;
  invoiceType: string;
  siteId: string | null;
  siteName: string | null;
  supplierId: string;
  supplierName: string;
  companyId: string;
  companyName: string;
  siteGroupId: string | null;
  siteGroupName: string | null;
  documentDate: string | null;
  subtotal: string;
  totalGstAmount: string;
  totalDiscount: string;
  tds: string;
  roundOff: string;
  totalAmount: string;
  lineCount: number;
  paymentStatus: string | null;
  isPaidOut: boolean;
  isApproved: boolean;
  createdAt: string;
}

const HEADER_COLUMNS = {
  id: purchaseInvoices.id,
  displayNo: DISPLAY_NO,
  supplierInvoiceNo: purchaseInvoices.supplierInvoiceNo,
  invoiceNo: purchaseInvoices.invoiceNo,
  invoiceType: purchaseInvoices.invoiceType,
  siteId: purchaseInvoices.siteId,
  supplierId: purchaseInvoices.supplierId,
  companyId: purchaseInvoices.companyId,
  siteGroupId: purchaseInvoices.siteGroupId,
  purchaseOrderId: purchaseInvoices.purchaseOrderId,
  documentDate: purchaseInvoices.documentDate,
  challanNo: purchaseInvoices.challanNo,
  lrNo: purchaseInvoices.lrNo,
  vehicleNo: purchaseInvoices.vehicleNo,
  dispatchBy: purchaseInvoices.dispatchBy,
  paymentTerms: purchaseInvoices.paymentTerms,
  description: purchaseInvoices.description,
  contactName: purchaseInvoices.contactName,
  contactNumber: purchaseInvoices.contactNumber,
  shippingAddress: purchaseInvoices.shippingAddress,
  groupAddress: purchaseInvoices.groupAddress,
  subtotal: purchaseInvoices.subtotal,
  totalGstAmount: purchaseInvoices.totalGstAmount,
  totalDiscount: purchaseInvoices.totalDiscount,
  tds: purchaseInvoices.tds,
  roundOff: purchaseInvoices.roundOff,
  totalAmount: purchaseInvoices.totalAmount,
  paymentStatus: purchaseInvoices.paymentStatus,
  isPaidOut: purchaseInvoices.isPaidOut,
  isApproved: purchaseInvoices.isApproved,
  createdAt: purchaseInvoices.createdAt,
} as const;

@Injectable()
export class PurchaseInvoicesRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /**
   * Both numbers and the supplier — how an invoice is looked up.
   *
   * The legacy screen's filters are Search, Company and a separate free-text
   * Supplier box. One search across the numbers and the supplier name does the
   * work of both without a second input, and company is a real filter below.
   */
  private searchFilter(search: string | undefined) {
    if (!search) {
      return undefined;
    }
    const pattern = `%${search}%`;
    return or(
      ilike(purchaseInvoices.supplierInvoiceNo, pattern),
      ilike(purchaseInvoices.invoiceNo, pattern),
      ilike(purchaseInvoices.challanNo, pattern),
      ilike(suppliers.name, pattern),
    );
  }

  private baseFilters(
    search: string | undefined,
    {
      siteId,
      companyId,
      supplierId,
      isApproved,
      invoiceType,
    }: {
      siteId?: string;
      companyId?: string;
      supplierId?: string;
      isApproved?: boolean;
      invoiceType?: string;
    },
  ) {
    // NO `is_deleted` TERM. `SupplierInvoice` has no soft-delete column and the
    // list screen has no Active/All filter — see the schema comment. Deleting an
    // invoice deletes it.
    const where = [];

    if (siteId) {
      where.push(eq(purchaseInvoices.siteId, siteId));
    }
    if (companyId) {
      where.push(eq(purchaseInvoices.companyId, companyId));
    }
    if (supplierId) {
      where.push(eq(purchaseInvoices.supplierId, supplierId));
    }
    if (isApproved !== undefined) {
      where.push(eq(purchaseInvoices.isApproved, isApproved));
    }
    if (invoiceType) {
      where.push(eq(purchaseInvoices.invoiceType, invoiceType));
    }

    const match = this.searchFilter(search);
    if (match) {
      where.push(match);
    }
    return where;
  }

  async list(
    query: ListQuery,
    filters: {
      siteId?: string;
      companyId?: string;
      supplierId?: string;
      isApproved?: boolean;
      invoiceType?: string;
    } = {},
  ): Promise<{ rows: PurchaseInvoiceListRow[]; nextCursor: string | null }> {
    const sortKey: PurchaseInvoiceSortKey =
      query.sortBy && query.sortBy in SORTABLE
        ? (query.sortBy as PurchaseInvoiceSortKey)
        : "createdAt";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const where = this.baseFilters(query.search, filters);

    const seek = keysetWhere(
      sortColumn,
      purchaseInvoices.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      where.push(seek);
    }

    const lineCount = sql<number>`(
      select count(*)::int from ${purchaseInvoiceItems}
      where ${purchaseInvoiceItems.purchaseInvoiceId} = ${purchaseInvoices}.id
    )`;

    const rows = await this.db
      .select({
        id: purchaseInvoices.id,
        displayNo: DISPLAY_NO,
        supplierInvoiceNo: purchaseInvoices.supplierInvoiceNo,
        invoiceNo: purchaseInvoices.invoiceNo,
        invoiceType: purchaseInvoices.invoiceType,
        siteId: purchaseInvoices.siteId,
        siteName: sites.name,
        supplierId: purchaseInvoices.supplierId,
        supplierName: suppliers.name,
        companyId: purchaseInvoices.companyId,
        companyName: companies.name,
        siteGroupId: purchaseInvoices.siteGroupId,
        siteGroupName: siteGroups.name,
        documentDate: purchaseInvoices.documentDate,
        subtotal: purchaseInvoices.subtotal,
        totalGstAmount: purchaseInvoices.totalGstAmount,
        totalDiscount: purchaseInvoices.totalDiscount,
        tds: purchaseInvoices.tds,
        roundOff: purchaseInvoices.roundOff,
        totalAmount: purchaseInvoices.totalAmount,
        lineCount,
        paymentStatus: purchaseInvoices.paymentStatus,
        isPaidOut: purchaseInvoices.isPaidOut,
        isApproved: purchaseInvoices.isApproved,
        createdAt: purchaseInvoices.createdAt,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(purchaseInvoices)
      // LEFT joins on site and group: `SiteId` is nullable on the source and
      // `SiteGroup` was a text match that need not have resolved. An inner join
      // would silently hide every invoice that has neither — which is exactly
      // how the source's own INNER JOINs lose free-text lines.
      .leftJoin(sites, eq(purchaseInvoices.siteId, sites.id))
      .leftJoin(siteGroups, eq(purchaseInvoices.siteGroupId, siteGroups.id))
      .innerJoin(suppliers, eq(purchaseInvoices.supplierId, suppliers.id))
      .innerJoin(companies, eq(purchaseInvoices.companyId, companies.id))
      .where(where.length ? and(...where) : undefined)
      .orderBy(...keysetOrder(sortColumn, purchaseInvoices.id, direction))
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
    filters: {
      siteId?: string;
      companyId?: string;
      supplierId?: string;
      isApproved?: boolean;
      invoiceType?: string;
    } = {},
  ): Promise<number> {
    const where = this.baseFilters(search, filters);
    const [row] = await this.db
      .select({ value: count() })
      .from(purchaseInvoices)
      .innerJoin(suppliers, eq(purchaseInvoices.supplierId, suppliers.id))
      .where(where.length ? and(...where) : undefined);
    return row?.value ?? 0;
  }

  private async lines(purchaseInvoiceId: string): Promise<PurchaseInvoiceItemRow[]> {
    return this.db
      .select({
        id: purchaseInvoiceItems.id,
        itemId: purchaseInvoiceItems.itemId,
        itemLabel: ITEM_LABEL,
        itemDescription: purchaseInvoiceItems.itemDescription,
        unitId: purchaseInvoiceItems.unitId,
        unitName: units.name,
        quantity: purchaseInvoiceItems.quantity,
        unitPrice: purchaseInvoiceItems.unitPrice,
        discountPerUnit: purchaseInvoiceItems.discountPerUnit,
        discountPercent: DISCOUNT_PERCENT,
        gstPercent: purchaseInvoiceItems.gstPercent,
        gstAmount: purchaseInvoiceItems.gstAmount,
        netAmount: purchaseInvoiceItems.netAmount,
        lineTotal: purchaseInvoiceItems.lineTotal,
        lineNumber: purchaseInvoiceItems.lineNumber,
      })
      .from(purchaseInvoiceItems)
      .innerJoin(units, eq(purchaseInvoiceItems.unitId, units.id))
      .leftJoin(items, eq(purchaseInvoiceItems.itemId, items.id))
      .where(eq(purchaseInvoiceItems.purchaseInvoiceId, purchaseInvoiceId))
      .orderBy(purchaseInvoiceItems.lineNumber);
  }

  async findById(id: string): Promise<PurchaseInvoiceDetail> {
    const [header] = await this.db
      .select({ ...HEADER_COLUMNS, purchaseOrderNo: purchaseOrders.poNo })
      .from(purchaseInvoices)
      .leftJoin(purchaseOrders, eq(purchaseInvoices.purchaseOrderId, purchaseOrders.id))
      .where(eq(purchaseInvoices.id, id))
      .limit(1);

    if (!header) {
      throw new NotFoundException("Purchase invoice not found");
    }

    return {
      ...header,
      documentDate: iso(header.documentDate),
      createdAt: iso(header.createdAt) as string,
      items: await this.lines(id),
    };
  }

  /**
   * Every derived money value, from `invoiceTotal.corrected()`.
   *
   * The client sends quantity, price, discount and GST percent; the server works
   * out the rest and stores it. `corrected()` is the arithmetic the business
   * believes it is getting — every line counted, discount subtracted, TDS
   * subtracted, adjustment added, and the grand total rounded to a whole rupee
   * with .50 going DOWN.
   *
   * THAT ROUNDING IS NOT A BUG BEING COPIED. It is what every invoice this
   * business has ever issued did, so it is the default; turning it off changes
   * what suppliers are paid and needs question 1 answered first. The switch is
   * `roundGrandTotalToRupee` and it lives in one place.
   */
  private priced(lines: PurchaseInvoiceLineInput[], charges: { tds?: string; roundOff?: string }) {
    const totals = invoiceTotal.corrected(
      lines.map((line) => ({
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        discountPerUnit: line.discountPerUnit ?? undefined,
        gstPercent: line.gstPercent ?? undefined,
      })),
      { tds: charges.tds ?? undefined, roundOff: charges.roundOff ?? undefined },
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
        discountPerUnit: line.discountPerUnit ?? "0",
        gstPercent: line.gstPercent,
        gstAmount: totals.lines[index]!.gstAmount,
        netAmount: totals.lines[index]!.netAmount,
        lineTotal: totals.lines[index]!.total,
        lineNumber: index + 1,
      })),
    };
  }

  /**
   * Creates an invoice and its lines in ONE transaction.
   *
   * There is no number to issue — the number on a purchase invoice is the
   * SUPPLIER's, typed in, and deliberately not checked for uniqueness. Two
   * suppliers both numbering an invoice `016` is ordinary.
   */
  async create(input: CreatePurchaseInvoice, actorId: string): Promise<PurchaseInvoiceDetail> {
    const { items: lines, tds, roundOff, ...header } = input;
    const { totals, rows } = this.priced(lines, { tds: tds ?? undefined, roundOff: roundOff ?? undefined });

    const id = await writing(() =>
      this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(purchaseInvoices)
          .values({
            ...header,
            documentDate: header.documentDate ? new Date(header.documentDate) : null,
            subtotal: totals.subtotal,
            totalGstAmount: totals.totalGst,
            totalDiscount: totals.totalDiscount,
            tds: totals.tds,
            roundOff: totals.roundOff,
            totalAmount: totals.grandTotal,
            ...createdBy(actorId),
          })
          .returning({ id: purchaseInvoices.id });

        const invoiceId = created!.id;

        await tx
          .insert(purchaseInvoiceItems)
          .values(
            rows.map((row) => ({ ...row, purchaseInvoiceId: invoiceId, ...createdBy(actorId) })),
          );

        return invoiceId;
      }),
    );

    return this.findById(id);
  }

  /**
   * Updates an invoice, replacing its lines wholesale when any are sent.
   *
   * THE TOTALS ARE RECOMPUTED WHENEVER THE LINES **OR** THE CHARGES CHANGE.
   * Missing that second half is the defect this screen is famous for: on the
   * live system the TDS box is read by a calculator that has been overwritten,
   * so typing a TDS moves nothing and the invoice saves a total that ignores it.
   * A patch touching only `tds` must still rewrite `total_amount`, which means
   * re-reading the lines that were not sent.
   */
  async update(
    id: string,
    input: UpdatePurchaseInvoice,
    actorId: string,
  ): Promise<PurchaseInvoiceDetail> {
    const now = new Date();
    const { items: lines, tds, roundOff, ...header } = input;

    await writing(() =>
      this.db.transaction(async (tx) => {
        const patch: Record<string, unknown> = { ...header, ...updatedBy(actorId) };

        if (header.documentDate !== undefined) {
          patch.documentDate = header.documentDate ? new Date(header.documentDate) : null;
        }

        const chargesChanged = tds !== undefined || roundOff !== undefined;

        if (lines !== undefined || chargesChanged) {
          const [current] = await tx
            .select({ tds: purchaseInvoices.tds, roundOff: purchaseInvoices.roundOff })
            .from(purchaseInvoices)
            .where(eq(purchaseInvoices.id, id))
            .limit(1);

          if (!current) {
            throw new NotFoundException("Purchase invoice not found");
          }

          // Lines that were not sent still have to be priced, or a charges-only
          // patch would compute a total over nothing.
          const effectiveLines: PurchaseInvoiceLineInput[] =
            lines ??
            (await this.linesForPricing(tx as unknown as Database, id));

          const { totals, rows } = this.priced(effectiveLines, {
            tds: (tds !== undefined ? tds : current.tds) ?? undefined,
            roundOff: (roundOff !== undefined ? roundOff : current.roundOff) ?? undefined,
          });

          patch.subtotal = totals.subtotal;
          patch.totalGstAmount = totals.totalGst;
          patch.totalDiscount = totals.totalDiscount;
          patch.tds = totals.tds;
          patch.roundOff = totals.roundOff;
          patch.totalAmount = totals.grandTotal;

          if (lines !== undefined) {
            await tx
              .delete(purchaseInvoiceItems)
              .where(eq(purchaseInvoiceItems.purchaseInvoiceId, id));
            await tx
              .insert(purchaseInvoiceItems)
              .values(
                rows.map((row) => ({ ...row, purchaseInvoiceId: id, ...createdBy(actorId) })),
              );
          }
        }

        const [updated] = await tx
          .update(purchaseInvoices)
          .set({ ...patch, updatedAt: now })
          .where(eq(purchaseInvoices.id, id))
          .returning({ id: purchaseInvoices.id });

        if (!updated) {
          throw new NotFoundException("Purchase invoice not found");
        }
      }),
    );

    return this.findById(id);
  }

  /** The stored lines, in the shape the calculator takes. */
  private async linesForPricing(tx: Database, id: string): Promise<PurchaseInvoiceLineInput[]> {
    const rows = await tx
      .select({
        itemId: purchaseInvoiceItems.itemId,
        itemName: purchaseInvoiceItems.itemName,
        itemDescription: purchaseInvoiceItems.itemDescription,
        unitId: purchaseInvoiceItems.unitId,
        quantity: purchaseInvoiceItems.quantity,
        unitPrice: purchaseInvoiceItems.unitPrice,
        discountPerUnit: purchaseInvoiceItems.discountPerUnit,
        gstPercent: purchaseInvoiceItems.gstPercent,
      })
      .from(purchaseInvoiceItems)
      .where(eq(purchaseInvoiceItems.purchaseInvoiceId, id))
      .orderBy(purchaseInvoiceItems.lineNumber);

    return rows as PurchaseInvoiceLineInput[];
  }

  /** States the approval rather than toggling it — see purchase requests. */
  async setApproval(
    id: string,
    isApproved: boolean,
    actorId: string,
  ): Promise<PurchaseInvoiceDetail> {
    const [updated] = await this.db
      .update(purchaseInvoices)
      .set({ isApproved, ...updatedBy(actorId) })
      .where(eq(purchaseInvoices.id, id))
      .returning({ id: purchaseInvoices.id });

    if (!updated) {
      throw new NotFoundException("Purchase invoice not found");
    }
    return this.findById(id);
  }

  /** One UPDATE for the selection, skipping rows already in the target state. */
  async setApprovalMany(ids: string[], isApproved: boolean, actorId: string): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const updated = await this.db
      .update(purchaseInvoices)
      .set({ isApproved, ...updatedBy(actorId) })
      .where(
        and(
          inArray(purchaseInvoices.id, ids),
          eq(purchaseInvoices.isApproved, !isApproved),
        ),
      )
      .returning({ id: purchaseInvoices.id });

    return updated.length;
  }

  /**
   * A REAL delete, unlike purchase orders — there is no soft-delete column to
   * set, because the source has none. The lines go with it through the FK's
   * `on delete cascade`, which is correct here for exactly the reason it would
   * be wrong on a soft delete.
   */
  async remove(id: string): Promise<void> {
    const [removed] = await this.db
      .delete(purchaseInvoices)
      .where(eq(purchaseInvoices.id, id))
      .returning({ id: purchaseInvoices.id });

    if (!removed) {
      throw new NotFoundException("Purchase invoice not found");
    }
  }
}
