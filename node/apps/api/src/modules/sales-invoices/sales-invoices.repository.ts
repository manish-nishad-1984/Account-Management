import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { invoiceTotal } from "@accountmanagement/domain";
import type {
  CreateSalesInvoice,
  ListQuery,
  SalesInvoiceDetail,
  SalesInvoiceItemRow,
  SalesInvoiceLineInput,
  SortDirection,
  UpdateSalesInvoice,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import {
  companies,
  items,
  salesInvoiceItems,
  salesInvoices,
  sites,
  suppliers,
  units,
} from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";
import { nextDocumentNumber, salesInvoiceNumber } from "../../common/document-number";

const SORTABLE = {
  createdAt: salesInvoices.createdAt,
  salesInvoiceNo: salesInvoices.salesInvoiceNo,
  totalAmount: salesInvoices.totalAmount,
} as const;

export type SalesInvoiceSortKey = keyof typeof SORTABLE;

const DOCUMENT_TYPE = "sales_invoice";

const ITEM_LABEL = sql<string>`coalesce(${items.name}, ${salesInvoiceItems.itemName}, '')`;

/** Derived, exact `numeric` division. See the purchase invoice repository. */
const DISCOUNT_PERCENT = sql<string>`case
  when ${salesInvoiceItems.unitPrice} = 0 then '0.00'
  else round(${salesInvoiceItems.discountPerUnit} / ${salesInvoiceItems.unitPrice} * 100, 2)::text
end`;

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

export interface SalesInvoiceListRow {
  id: string;
  salesInvoiceNo: string;
  customerInvoiceNo: string | null;
  invoiceType: string;
  siteId: string | null;
  siteName: string | null;
  customerId: string;
  customerName: string;
  companyId: string;
  companyName: string;
  documentDate: string | null;
  subtotal: string;
  totalGstAmount: string;
  totalDiscount: string;
  tds: string;
  roundOff: string;
  totalAmount: string;
  lineCount: number;
  paymentStatus: string | null;
  isPaidIn: boolean;
  isApproved: boolean;
  createdAt: string;
}

const HEADER_COLUMNS = {
  id: salesInvoices.id,
  salesInvoiceNo: salesInvoices.salesInvoiceNo,
  customerInvoiceNo: salesInvoices.customerInvoiceNo,
  invoiceType: salesInvoices.invoiceType,
  siteId: salesInvoices.siteId,
  customerId: salesInvoices.customerId,
  companyId: salesInvoices.companyId,
  documentDate: salesInvoices.documentDate,
  challanNo: salesInvoices.challanNo,
  lrNo: salesInvoices.lrNo,
  vehicleNo: salesInvoices.vehicleNo,
  dispatchBy: salesInvoices.dispatchBy,
  paymentTerms: salesInvoices.paymentTerms,
  description: salesInvoices.description,
  contactName: salesInvoices.contactName,
  contactNumber: salesInvoices.contactNumber,
  shippingAddress: salesInvoices.shippingAddress,
  subtotal: salesInvoices.subtotal,
  totalGstAmount: salesInvoices.totalGstAmount,
  totalDiscount: salesInvoices.totalDiscount,
  tds: salesInvoices.tds,
  roundOff: salesInvoices.roundOff,
  totalAmount: salesInvoices.totalAmount,
  paymentStatus: salesInvoices.paymentStatus,
  isPaidIn: salesInvoices.isPaidIn,
  isApproved: salesInvoices.isApproved,
  createdAt: salesInvoices.createdAt,
} as const;

@Injectable()
export class SalesInvoicesRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  private searchFilter(search: string | undefined) {
    if (!search) {
      return undefined;
    }
    const pattern = `%${search}%`;
    return or(
      ilike(salesInvoices.salesInvoiceNo, pattern),
      ilike(salesInvoices.customerInvoiceNo, pattern),
      ilike(salesInvoices.challanNo, pattern),
      // The party table is `suppliers`; on this screen its rows are customers.
      ilike(suppliers.name, pattern),
    );
  }

  private baseFilters(
    search: string | undefined,
    {
      siteId,
      companyId,
      customerId,
      isApproved,
      invoiceType,
    }: {
      siteId?: string;
      companyId?: string;
      customerId?: string;
      isApproved?: boolean;
      invoiceType?: string;
    },
  ) {
    // No `is_deleted` term — `SalesInvoice` has no soft-delete column.
    const where = [];

    if (siteId) {
      where.push(eq(salesInvoices.siteId, siteId));
    }
    if (companyId) {
      where.push(eq(salesInvoices.companyId, companyId));
    }
    if (customerId) {
      where.push(eq(salesInvoices.customerId, customerId));
    }
    if (isApproved !== undefined) {
      where.push(eq(salesInvoices.isApproved, isApproved));
    }
    if (invoiceType) {
      where.push(eq(salesInvoices.invoiceType, invoiceType));
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
      customerId?: string;
      isApproved?: boolean;
      invoiceType?: string;
    } = {},
  ): Promise<{ rows: SalesInvoiceListRow[]; nextCursor: string | null }> {
    const sortKey: SalesInvoiceSortKey =
      query.sortBy && query.sortBy in SORTABLE
        ? (query.sortBy as SalesInvoiceSortKey)
        : "createdAt";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const where = this.baseFilters(query.search, filters);

    const seek = keysetWhere(
      sortColumn,
      salesInvoices.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      where.push(seek);
    }

    const lineCount = sql<number>`(
      select count(*)::int from ${salesInvoiceItems}
      where ${salesInvoiceItems.salesInvoiceId} = ${salesInvoices}.id
    )`;

    const rows = await this.db
      .select({
        id: salesInvoices.id,
        salesInvoiceNo: salesInvoices.salesInvoiceNo,
        customerInvoiceNo: salesInvoices.customerInvoiceNo,
        invoiceType: salesInvoices.invoiceType,
        siteId: salesInvoices.siteId,
        siteName: sites.name,
        customerId: salesInvoices.customerId,
        customerName: suppliers.name,
        companyId: salesInvoices.companyId,
        companyName: companies.name,
        documentDate: salesInvoices.documentDate,
        subtotal: salesInvoices.subtotal,
        totalGstAmount: salesInvoices.totalGstAmount,
        totalDiscount: salesInvoices.totalDiscount,
        tds: salesInvoices.tds,
        roundOff: salesInvoices.roundOff,
        totalAmount: salesInvoices.totalAmount,
        lineCount,
        paymentStatus: salesInvoices.paymentStatus,
        isPaidIn: salesInvoices.isPaidIn,
        isApproved: salesInvoices.isApproved,
        createdAt: salesInvoices.createdAt,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(salesInvoices)
      // LEFT on the site, which is nullable on the source; INNER on the two
      // that are NOT NULL.
      .leftJoin(sites, eq(salesInvoices.siteId, sites.id))
      .innerJoin(suppliers, eq(salesInvoices.customerId, suppliers.id))
      .innerJoin(companies, eq(salesInvoices.companyId, companies.id))
      .where(where.length ? and(...where) : undefined)
      .orderBy(...keysetOrder(sortColumn, salesInvoices.id, direction))
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
      customerId?: string;
      isApproved?: boolean;
      invoiceType?: string;
    } = {},
  ): Promise<number> {
    const where = this.baseFilters(search, filters);
    const [row] = await this.db
      .select({ value: count() })
      .from(salesInvoices)
      .innerJoin(suppliers, eq(salesInvoices.customerId, suppliers.id))
      .where(where.length ? and(...where) : undefined);
    return row?.value ?? 0;
  }

  private async lines(salesInvoiceId: string): Promise<SalesInvoiceItemRow[]> {
    return this.db
      .select({
        id: salesInvoiceItems.id,
        itemId: salesInvoiceItems.itemId,
        itemLabel: ITEM_LABEL,
        itemDescription: salesInvoiceItems.itemDescription,
        unitId: salesInvoiceItems.unitId,
        unitName: units.name,
        quantity: salesInvoiceItems.quantity,
        unitPrice: salesInvoiceItems.unitPrice,
        discountPerUnit: salesInvoiceItems.discountPerUnit,
        discountPercent: DISCOUNT_PERCENT,
        gstPercent: salesInvoiceItems.gstPercent,
        gstAmount: salesInvoiceItems.gstAmount,
        netAmount: salesInvoiceItems.netAmount,
        lineTotal: salesInvoiceItems.lineTotal,
        lineNumber: salesInvoiceItems.lineNumber,
      })
      .from(salesInvoiceItems)
      .innerJoin(units, eq(salesInvoiceItems.unitId, units.id))
      .leftJoin(items, eq(salesInvoiceItems.itemId, items.id))
      .where(eq(salesInvoiceItems.salesInvoiceId, salesInvoiceId))
      .orderBy(salesInvoiceItems.lineNumber);
  }

  async findById(id: string): Promise<SalesInvoiceDetail> {
    const [header] = await this.db
      .select(HEADER_COLUMNS)
      .from(salesInvoices)
      .where(eq(salesInvoices.id, id))
      .limit(1);

    if (!header) {
      throw new NotFoundException("Sales invoice not found");
    }

    return {
      ...header,
      documentDate: iso(header.documentDate),
      createdAt: iso(header.createdAt) as string,
      items: await this.lines(id),
    };
  }

  /** Identical arithmetic to the purchase side — one calculator, both directions. */
  private priced(lines: SalesInvoiceLineInput[], charges: { tds?: string; roundOff?: string }) {
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
   * The company's invoice prefix leads its sales invoice numbers.
   *
   * `CheckSalesInvoiceNo` reads `CompanyDetails.InvoicePef.Trim()` with no null
   * check on a nullable column, and its catch turns the resulting exception into
   * a returned error. Refused here, by name, before anything is written.
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
        `${company.name} has no invoice prefix, so its sales invoices cannot be numbered. Set one on the company first.`,
      );
    }
    return prefix;
  }

  /** Creates an invoice, its lines and its NUMBER in one transaction. */
  async create(input: CreateSalesInvoice, actorId: string): Promise<SalesInvoiceDetail> {
    const now = new Date();
    const { items: lines, tds, roundOff, ...header } = input;
    const { totals, rows } = this.priced(lines, {
      tds: tds ?? undefined,
      roundOff: roundOff ?? undefined,
    });

    const id = await writing(() =>
      this.db.transaction(async (tx) => {
        const handle = tx as unknown as Database;
        const prefix = await this.invoicePrefix(handle, input.companyId);

        const salesInvoiceNo = await nextDocumentNumber(handle, {
          documentType: DOCUMENT_TYPE,
          companyId: input.companyId,
          format: salesInvoiceNumber(prefix),
          now,
        });

        const [created] = await tx
          .insert(salesInvoices)
          .values({
            ...header,
            salesInvoiceNo,
            documentDate: header.documentDate ? new Date(header.documentDate) : null,
            subtotal: totals.subtotal,
            totalGstAmount: totals.totalGst,
            totalDiscount: totals.totalDiscount,
            tds: totals.tds,
            roundOff: totals.roundOff,
            totalAmount: totals.grandTotal,
            ...createdBy(actorId),
          })
          .returning({ id: salesInvoices.id });

        const invoiceId = created!.id;

        await tx
          .insert(salesInvoiceItems)
          .values(
            rows.map((row) => ({ ...row, salesInvoiceId: invoiceId, ...createdBy(actorId) })),
          );

        return invoiceId;
      }),
    );

    return this.findById(id);
  }

  /**
   * The totals are recomputed when the lines OR the charges change — see the
   * purchase invoice repository for why the second half matters.
   */
  async update(
    id: string,
    input: UpdateSalesInvoice,
    actorId: string,
  ): Promise<SalesInvoiceDetail> {
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
            .select({ tds: salesInvoices.tds, roundOff: salesInvoices.roundOff })
            .from(salesInvoices)
            .where(eq(salesInvoices.id, id))
            .limit(1);

          if (!current) {
            throw new NotFoundException("Sales invoice not found");
          }

          const effectiveLines: SalesInvoiceLineInput[] =
            lines ?? (await this.linesForPricing(tx as unknown as Database, id));

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
            await tx.delete(salesInvoiceItems).where(eq(salesInvoiceItems.salesInvoiceId, id));
            await tx
              .insert(salesInvoiceItems)
              .values(rows.map((row) => ({ ...row, salesInvoiceId: id, ...createdBy(actorId) })));
          }
        }

        const [updated] = await tx
          .update(salesInvoices)
          .set({ ...patch, updatedAt: now })
          .where(eq(salesInvoices.id, id))
          .returning({ id: salesInvoices.id });

        if (!updated) {
          throw new NotFoundException("Sales invoice not found");
        }
      }),
    );

    return this.findById(id);
  }

  private async linesForPricing(tx: Database, id: string): Promise<SalesInvoiceLineInput[]> {
    const rows = await tx
      .select({
        itemId: salesInvoiceItems.itemId,
        itemName: salesInvoiceItems.itemName,
        itemDescription: salesInvoiceItems.itemDescription,
        unitId: salesInvoiceItems.unitId,
        quantity: salesInvoiceItems.quantity,
        unitPrice: salesInvoiceItems.unitPrice,
        discountPerUnit: salesInvoiceItems.discountPerUnit,
        gstPercent: salesInvoiceItems.gstPercent,
      })
      .from(salesInvoiceItems)
      .where(eq(salesInvoiceItems.salesInvoiceId, id))
      .orderBy(salesInvoiceItems.lineNumber);

    return rows as SalesInvoiceLineInput[];
  }

  async setApproval(id: string, isApproved: boolean, actorId: string): Promise<SalesInvoiceDetail> {
    const [updated] = await this.db
      .update(salesInvoices)
      .set({ isApproved, ...updatedBy(actorId) })
      .where(eq(salesInvoices.id, id))
      .returning({ id: salesInvoices.id });

    if (!updated) {
      throw new NotFoundException("Sales invoice not found");
    }
    return this.findById(id);
  }

  async setApprovalMany(ids: string[], isApproved: boolean, actorId: string): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const updated = await this.db
      .update(salesInvoices)
      .set({ isApproved, ...updatedBy(actorId) })
      .where(and(inArray(salesInvoices.id, ids), eq(salesInvoices.isApproved, !isApproved)))
      .returning({ id: salesInvoices.id });

    return updated.length;
  }

  /** A real delete — there is no soft-delete column. Lines go by cascade. */
  async remove(id: string): Promise<void> {
    const [removed] = await this.db
      .delete(salesInvoices)
      .where(eq(salesInvoices.id, id))
      .returning({ id: salesInvoices.id });

    if (!removed) {
      throw new NotFoundException("Sales invoice not found");
    }
  }
}
