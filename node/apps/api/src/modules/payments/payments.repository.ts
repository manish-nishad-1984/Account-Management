import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import type {
  CreatePayment,
  ListQuery,
  PaymentDetail,
  PaymentDirection,
  SortDirection,
  UpdatePayment,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { companies, payments, siteGroups, sites, suppliers } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

/**
 * Payments — `/Report/ReportDetails` panel 3.
 *
 * The source has no repository for this: `AddSupplierInvoice` writes a
 * `SupplierInvoice` with no lines, `InsertSalesPayInInvoice` writes the mirror
 * of it into `SalesInvoice`, and reads pick payments back out by comparing the
 * number column to a string. See `db/schema/payments.ts` for why that is not
 * reproduced.
 */

/**
 * `paymentDate` is NOT sortable, and `createdAt` is the default.
 *
 * §7.2: a nullable keyset sort column silently drops rows, because `col >
 * cursor` is NULL for a NULL row and the WHERE excludes it while ORDER BY still
 * lists it. `payment_date` is nullable — the source never required one either.
 */
const SORTABLE = {
  createdAt: payments.createdAt,
  amount: payments.amount,
} as const;

export type PaymentSortKey = keyof typeof SORTABLE;

export interface PaymentFilters {
  direction?: PaymentDirection;
  partyId?: string;
  companyId?: string;
  siteId?: string;
}

const DETAIL_COLUMNS = {
  id: payments.id,
  direction: payments.direction,
  kind: payments.kind,
  partyId: payments.partyId,
  companyId: payments.companyId,
  siteId: payments.siteId,
  siteGroupId: payments.siteGroupId,
  paymentDate: payments.paymentDate,
  amount: payments.amount,
  description: payments.description,
  method: payments.method,
  referenceNo: payments.referenceNo,
  createdAt: payments.createdAt,
} as const;

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

/** Every timestamp leaves this repository as an ISO string, never a Date. */
const shape = <T extends { paymentDate: Date | string | null; createdAt: Date | string }>(
  row: T,
) => ({
  ...row,
  paymentDate: iso(row.paymentDate),
  createdAt: iso(row.createdAt)!,
});

export interface PaymentListRow extends PaymentDetail {
  partyName: string;
  companyName: string;
  siteName: string | null;
  siteGroupName: string | null;
}

@Injectable()
export class PaymentsRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /** Party name, description and reference — what a payment is looked up by. */
  private searchFilter(search: string | undefined) {
    if (!search) {
      return undefined;
    }
    const pattern = `%${search}%`;
    return or(
      ilike(suppliers.name, pattern),
      ilike(payments.description, pattern),
      ilike(payments.referenceNo, pattern),
    );
  }

  private conditions(search: string | undefined, options: PaymentFilters) {
    const filters = [eq(payments.isDeleted, false)];
    const match = this.searchFilter(search);
    if (match) {
      filters.push(match);
    }
    if (options.direction) {
      filters.push(eq(payments.direction, options.direction));
    }
    if (options.partyId) {
      filters.push(eq(payments.partyId, options.partyId));
    }
    if (options.companyId) {
      filters.push(eq(payments.companyId, options.companyId));
    }
    if (options.siteId) {
      filters.push(eq(payments.siteId, options.siteId));
    }
    return filters;
  }

  async list(
    query: ListQuery,
    options: PaymentFilters = {},
  ): Promise<{ rows: PaymentListRow[]; nextCursor: string | null }> {
    const sortKey: PaymentSortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as PaymentSortKey) : "createdAt";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const filters = this.conditions(query.search, options);
    const seek = keysetWhere(
      sortColumn,
      payments.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      filters.push(seek);
    }

    const rows = await this.db
      .select({
        ...DETAIL_COLUMNS,
        partyName: suppliers.name,
        companyName: companies.name,
        siteName: sites.name,
        siteGroupName: siteGroups.name,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(payments)
      .innerJoin(suppliers, eq(payments.partyId, suppliers.id))
      .innerJoin(companies, eq(payments.companyId, companies.id))
      // LEFT on both: an opening balance has no site, and a site group is
      // optional on every document in this system.
      .leftJoin(sites, eq(payments.siteId, sites.id))
      .leftJoin(siteGroups, eq(payments.siteGroupId, siteGroups.id))
      .where(and(...filters))
      .orderBy(...keysetOrder(sortColumn, payments.id, direction))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    return {
      rows: page.rows.map(({ sortValue: _ignored, ...row }) => shape(row) as PaymentListRow),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string, options: PaymentFilters = {}): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(payments)
      .innerJoin(suppliers, eq(payments.partyId, suppliers.id))
      .where(and(...this.conditions(search, options)));
    return row?.value ?? 0;
  }

  async findById(id: string): Promise<PaymentDetail> {
    const [row] = await this.db
      .select(DETAIL_COLUMNS)
      .from(payments)
      .where(and(eq(payments.id, id), eq(payments.isDeleted, false)))
      .limit(1);

    if (!row) {
      throw new NotFoundException("Payment not found");
    }
    return shape(row) as PaymentDetail;
  }

  /**
   * The repeater, in ONE transaction.
   *
   * `AddSupplierInvoice` loops the posted list adding entities and calls
   * `SaveChangesAsync` once at the end — which EF Core does wrap in a
   * transaction, so this matches. What it does not do is validate: a row with a
   * blank amount is caught in the browser and nowhere else, so a direct post
   * writes it. The contract refuses it here before the transaction opens.
   */
  async createMany(input: CreatePayment[], actorId: string): Promise<number> {
    if (input.length === 0) {
      return 0;
    }

    const rows = await writing(() =>
      this.db
        .insert(payments)
        .values(
          input.map((one) => ({
            direction: one.direction,
            kind: one.kind,
            partyId: one.partyId,
            companyId: one.companyId,
            // An opening balance carries no site — the contract enforces that a
            // payment does, so this null is only ever the deliberate case.
            siteId: one.siteId,
            siteGroupId: one.siteGroupId,
            paymentDate: one.paymentDate === null ? null : new Date(one.paymentDate),
            amount: one.amount,
            description: one.description,
            method: one.method,
            referenceNo: one.referenceNo,
            ...createdBy(actorId),
          })),
        )
        .returning({ id: payments.id }),
    );

    return rows.length;
  }

  async update(id: string, input: UpdatePayment, actorId: string): Promise<PaymentDetail> {
    const patch: Record<string, unknown> = { ...input, ...updatedBy(actorId) };
    if ("paymentDate" in input) {
      patch.paymentDate = input.paymentDate ? new Date(input.paymentDate) : null;
    }

    const [row] = await writing(() =>
      this.db
        .update(payments)
        .set(patch)
        .where(and(eq(payments.id, id), eq(payments.isDeleted, false)))
        .returning(DETAIL_COLUMNS),
    );

    if (!row) {
      throw new NotFoundException("Payment not found");
    }
    return shape(row) as PaymentDetail;
  }

  /**
   * SOFT delete — see the column comment. `DeletePayoutDetails` calls `Remove()`
   * and the row is gone, taking a supplier balance with it and leaving nothing
   * that says why the balance moved.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const [row] = await this.db
      .update(payments)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(payments.id, id), eq(payments.isDeleted, false)))
      .returning({ id: payments.id });

    if (!row) {
      throw new NotFoundException("Payment not found");
    }
  }
}
