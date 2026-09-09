import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  PAYOUT_INVOICE_NO,
  type ItemPriceHistory,
  type ItemPriceHistoryRow,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import {
  companies,
  items,
  purchaseInvoiceItems,
  purchaseInvoices,
  sites,
  suppliers,
} from "../../db/schema";
import { BaseRepository } from "../../common/base.repository";

/**
 * The Item Master's clock icon — every purchase invoice line for one item.
 *
 * Its own repository rather than four more methods on `ItemsRepository`,
 * because it reads none of the item's own columns beyond checking the item
 * exists: it is a query over the purchase invoice tables that happens to be
 * keyed by an item. Keeping it separate is what stops `ItemsRepository`
 * gradually becoming the place any query about an item lives.
 *
 * See `contracts/item-price-history.ts` for what the legacy panel is and the
 * four defects in its seven columns.
 */

/** Identical to the purchase invoice list's, so the two screens agree on a number. */
const DISPLAY_NO = sql<string>`coalesce(
  nullif(btrim(${purchaseInvoices.supplierInvoiceNo}), ''),
  nullif(btrim(${purchaseInvoices.invoiceNo}), ''),
  '(no number)'
)`;

/**
 * Per-unit prices, divided in SQL with `numeric` — exact decimal arithmetic,
 * never `float8` and never read back through a JavaScript number.
 *
 * A zero quantity would divide by zero. `quantity` is NOT NULL with no positive
 * constraint behind it, and a zero-quantity line is reachable through an ETL of
 * historical rows even if this application's own contract refuses one, so the
 * guard is here rather than assumed away.
 */
const perUnit = (amount: AnyPgColumn) => sql<string>`case
  when ${purchaseInvoiceItems.quantity} = 0 then '0.00'
  else round(${amount} / ${purchaseInvoiceItems.quantity}, 2)::text
end`;

@Injectable()
export class ItemPriceHistoryRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /**
   * Rows that count as a price paid for this item.
   *
   * `PayOut` is the source's own exclusion and the only magic string in its
   * query — payments live in the invoice table under that literal number. The
   * NULL branch matters: `ne()` on a NULL column is NULL, not true, so an
   * invoice with no number at all would be excluded by a bare `!=` and vanish
   * from its own history.
   */
  private matching(itemId: string) {
    return and(
      eq(purchaseInvoiceItems.itemId, itemId),
      or(isNull(purchaseInvoices.invoiceNo), ne(purchaseInvoices.invoiceNo, PAYOUT_INVOICE_NO)),
    );
  }

  /**
   * NOT site-scoped, and that is both the faithful answer and the right one.
   *
   * `GetItemHistory(Guid ItemId)` takes no site and applies none. It is also
   * what the panel is for: a buyer asking what this item has cost is asking
   * across the business, and a history narrowed to the site they happen to have
   * selected would show a fraction of the purchases while looking complete.
   *
   * The 404 is on the ITEM, not on the history. An item with no invoices has an
   * empty history, which is the legacy "No invoices found." An item id that
   * does not exist is a different answer and gets one.
   */
  async forItem(itemId: string, limit: number): Promise<ItemPriceHistory> {
    const [item] = await this.db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.isDeleted, false)))
      .limit(1);

    if (!item) {
      throw new NotFoundException("Item not found");
    }

    const where = this.matching(itemId);

    const [tally] = await this.db
      .select({ value: count() })
      .from(purchaseInvoiceItems)
      .innerJoin(purchaseInvoices, eq(purchaseInvoiceItems.purchaseInvoiceId, purchaseInvoices.id))
      .where(where);

    const rows = await this.db
      .select({
        id: purchaseInvoiceItems.id,
        invoiceId: purchaseInvoices.id,
        displayNo: DISPLAY_NO,
        invoiceType: purchaseInvoices.invoiceType,
        supplierId: purchaseInvoices.supplierId,
        supplierName: suppliers.name,
        siteId: purchaseInvoices.siteId,
        siteName: sites.name,
        companyId: purchaseInvoices.companyId,
        companyName: companies.name,
        documentDate: purchaseInvoices.documentDate,
        createdAt: purchaseInvoices.createdAt,
        quantity: purchaseInvoiceItems.quantity,
        unitPrice: purchaseInvoiceItems.unitPrice,
        discountPerUnit: purchaseInvoiceItems.discountPerUnit,
        gstPercent: purchaseInvoiceItems.gstPercent,
        gstAmount: purchaseInvoiceItems.gstAmount,
        netAmount: purchaseInvoiceItems.netAmount,
        lineTotal: purchaseInvoiceItems.lineTotal,
        effectiveUnitPrice: perUnit(purchaseInvoiceItems.netAmount),
        effectiveUnitPriceWithGst: perUnit(purchaseInvoiceItems.lineTotal),
        isApproved: purchaseInvoices.isApproved,
      })
      .from(purchaseInvoiceItems)
      .innerJoin(purchaseInvoices, eq(purchaseInvoiceItems.purchaseInvoiceId, purchaseInvoices.id))
      .innerJoin(suppliers, eq(purchaseInvoices.supplierId, suppliers.id))
      .innerJoin(companies, eq(purchaseInvoices.companyId, companies.id))
      // LEFT, where the source is INNER. `site_id` is nullable and an inner
      // join would drop every invoice raised without one.
      .leftJoin(sites, eq(purchaseInvoices.siteId, sites.id))
      .where(where)
      // NEWEST FIRST, where the source is `orderby a.Date` ascending.
      //
      // A DEPARTURE, and a presentation one. The panel exists to answer "what
      // did we last pay", and the source buries that answer at the bottom of a
      // fixed-height scroll box that shows years of older rows first. Nothing
      // about the data changes; `documentDate` nulls sort last so a document
      // with no date does not claim to be the most recent.
      .orderBy(
        sql`${purchaseInvoices.documentDate} desc nulls last`,
        desc(purchaseInvoices.createdAt),
        desc(purchaseInvoiceItems.lineNumber),
      )
      .limit(limit);

    return {
      rows: rows.map(
        (row): ItemPriceHistoryRow => ({
          ...row,
          documentDate:
            row.documentDate === null
              ? null
              : row.documentDate instanceof Date
                ? row.documentDate.toISOString()
                : row.documentDate,
          createdAt:
            row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
        }),
      ),
      total: tally?.value ?? 0,
    };
  }
}
