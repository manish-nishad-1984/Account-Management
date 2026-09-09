import { Inject, Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { and, count, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { deliveryAllocation, purchaseOrderTotal } from "@accountmanagement/domain";
import { TERMS_TEMPLATE_KEYS } from "@accountmanagement/contracts";
import type {
  CreatePurchaseOrder,
  ListQuery,
  PurchaseOrderDeliveryAddressInput,
  PurchaseOrderDeliveryAddressRow,
  PurchaseOrderDeliveryOptions,
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
  purchaseOrderDeliveryAddresses,
  purchaseOrderItems,
  purchaseOrders,
  siteGroupAddresses,
  siteGroupSites,
  siteGroups,
  sites,
  suppliers,
  units,
} from "../../db/schema";
import { sanitiseTerms } from "../../common/sanitise-terms";
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

/**
 * Narrow the stored template to one the contract knows.
 *
 * The column is plain text because that is what the source's `nvarchar(100)`
 * becomes, and because a row imported from a database nobody has extracted yet
 * may carry anything. An unrecognised value reads as "no template recorded" —
 * the order keeps its terms and only loses the note about where they started,
 * which is the harmless half of the pair.
 */
const templateKey = (value: string | null): PurchaseOrderDetail["termsTemplate"] =>
  TERMS_TEMPLATE_KEYS.includes(value as never)
    ? (value as PurchaseOrderDetail["termsTemplate"])
    : null;

/**
 * One line of address from the columns a site actually has.
 *
 * The legacy version is `Address + " , " + Area + ", " + City + ", " + State +
 * ", " + Country` — string concatenation with no null handling at all, so a site
 * missing its area reads ", , Surat," with the gap left in. Empty parts are
 * dropped here, and null comes back when there is nothing to compose, because
 * an address of ", ," is not an address and should not be offered as one.
 *
 * City, state and country are absent by necessity, not by choice: they are bare
 * integer ids with no lookup table until the census runs (PLAN.md §1.4).
 */
const composeAddress = (...parts: (string | null)[]): string | null => {
  const line = parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join(", ");
  return line.length > 0 ? line : null;
};

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
  termsTemplate: purchaseOrders.termsTemplate,
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

  /**
   * The order's delivery addresses, both panels' worth, in the order they were
   * keyed.
   *
   * One query for both kinds, because they are one list in the source and one
   * table here. The screen splits them by `kind` for display; the storage does
   * not need to know that.
   */
  private async deliveries(
    purchaseOrderId: string,
  ): Promise<PurchaseOrderDeliveryAddressRow[]> {
    const rows = await this.db
      .select({
        id: purchaseOrderDeliveryAddresses.id,
        kind: purchaseOrderDeliveryAddresses.kind,
        address: purchaseOrderDeliveryAddresses.address,
        quantity: purchaseOrderDeliveryAddresses.quantity,
        lineNumber: purchaseOrderDeliveryAddresses.lineNumber,
      })
      .from(purchaseOrderDeliveryAddresses)
      .where(eq(purchaseOrderDeliveryAddresses.purchaseOrderId, purchaseOrderId))
      .orderBy(purchaseOrderDeliveryAddresses.lineNumber);

    return rows.map((row) => ({ ...row, kind: row.kind === "group" ? "group" : "site" }));
  }

  /**
   * What the two address panels offer for a given site.
   *
   * The site's own addresses and every group that site belongs to, with each
   * group's addresses, in one query pair — see the contract for why they are not
   * three separate endpoints.
   *
   * NO `group.view` PERMISSION IS INVOLVED, deliberately, and for the reason
   * §5h gives about `/sites/assignable`: `group.view` guards the site group
   * MASTER screen. A clerk who may raise a purchase order but not administer
   * groups would otherwise get an empty Group dropdown they cannot save past.
   * The route is guarded by `purchase-orders.view`, which is the right that
   * gets you to this screen at all.
   */
  async deliveryOptions(siteId: string): Promise<PurchaseOrderDeliveryOptions> {
    const [site] = await this.db
      .select({
        address: sites.address,
        area: sites.area,
        pincode: sites.pincode,
        shippingAddress: sites.shippingAddress,
        shippingArea: sites.shippingArea,
        shippingPincode: sites.shippingPincode,
      })
      .from(sites)
      .where(and(eq(sites.id, siteId), eq(sites.isDeleted, false)))
      .limit(1);

    if (!site) {
      throw new NotFoundException("Site not found");
    }

    /**
     * Shipping first, because that is what the panel is for. Deduplicated,
     * because a site whose shipping address equals its main address would
     * otherwise offer the same line twice and a user ticking both would allocate
     * the same delivery to one place under two rows.
     */
    const siteAddresses = [
      composeAddress(site.shippingAddress, site.shippingArea, site.shippingPincode),
      composeAddress(site.address, site.area, site.pincode),
    ].filter((address, index, all): address is string => address !== null && all.indexOf(address) === index);

    /**
     * The groups this site is in, each with its addresses.
     *
     * `array_agg` with a LEFT JOIN, so a group with no addresses still appears —
     * it is a real group and the Group select must be able to name it. The
     * filter on the aggregate is what keeps a null from the outer join becoming
     * an empty-string address in the list.
     */
    const groups = await this.db
      .select({
        id: siteGroups.id,
        name: siteGroups.name,
        addresses: sql<string[]>`coalesce(
          array_agg(${siteGroupAddresses.address} order by ${siteGroupAddresses.address})
            filter (where ${siteGroupAddresses.address} is not null),
          '{}'
        )`,
      })
      .from(siteGroups)
      .innerJoin(siteGroupSites, eq(siteGroupSites.groupId, siteGroups.id))
      .leftJoin(siteGroupAddresses, eq(siteGroupAddresses.groupId, siteGroups.id))
      .where(and(eq(siteGroupSites.siteId, siteId), eq(siteGroups.isDeleted, false)))
      .groupBy(siteGroups.id, siteGroups.name)
      .orderBy(siteGroups.name);

    return { siteAddresses, groups };
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

    const [items, deliveryAddresses] = await Promise.all([this.lines(id), this.deliveries(id)]);

    return {
      ...header,
      termsTemplate: templateKey(header.termsTemplate),
      documentDate: iso(header.documentDate),
      deliveryDate: iso(header.deliveryDate),
      createdAt: iso(header.createdAt) as string,
      items,
      deliveryAddresses,
    };
  }

  /**
   * Refuse an allocation that sends out more than was ordered.
   *
   * The rule is the source's; the arithmetic is `deliveryAllocation.allocate`,
   * which sums BOTH panels together where the source keeps two independent
   * counters and lets an order be delivered twice over. See that module for the
   * defect and why the departure is deliberate.
   *
   * Checked on the server even though the form checks it too. The form's version
   * is a courtesy that stops a save being attempted; this one is the rule.
   */
  private guardAllocation(
    addresses: readonly PurchaseOrderDeliveryAddressInput[],
    orderedQuantity: string,
  ): void {
    const message = deliveryAllocation.allocationError(
      deliveryAllocation.allocate(addresses, orderedQuantity),
    );
    if (message) {
      throw new BadRequestException(message);
    }
  }

  /** The delivery rows as they are stored, numbered by their position. */
  private deliveryRows(
    addresses: readonly PurchaseOrderDeliveryAddressInput[],
    purchaseOrderId: string,
    actorId: string,
  ) {
    return addresses.map((address, index) => ({
      purchaseOrderId,
      kind: address.kind,
      address: address.address,
      quantity: address.quantity,
      lineNumber: index + 1,
      ...createdBy(actorId),
    }));
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

    // Both before the transaction opens: neither needs the database, and a
    // rejection here costs no document number. `nextDocumentNumber` increments a
    // counter, so a request that was always going to fail should fail before it.
    this.guardAllocation(input.deliveryAddresses, totals.totalQuantity);
    const terms = sanitiseTerms(input.terms);

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

        const { items: _lines, deliveryAddresses, ...header } = input;

        const [created] = await tx
          .insert(purchaseOrders)
          .values({
            ...header,
            terms,
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

        if (deliveryAddresses.length > 0) {
          await tx
            .insert(purchaseOrderDeliveryAddresses)
            .values(this.deliveryRows(deliveryAddresses, orderId, actorId));
        }

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
    const { items: lines, deliveryAddresses, ...header } = input;

    /**
     * WHAT THE ALLOCATION IS CHECKED AGAINST WHEN ONLY ONE HALF IS SENT.
     *
     * The two are independent partial updates: a caller may send new delivery
     * addresses without touching the lines, or new lines without touching the
     * addresses. Either way the rule is about the pair, so the half that was not
     * sent has to be read back rather than assumed.
     *
     * Editing the lines alone is the case that would otherwise slip through:
     * halving the quantity on an order that is fully allocated leaves the
     * deliveries adding up to twice what is now ordered, and nothing in the
     * request mentions an address.
     */
    if (deliveryAddresses !== undefined || lines !== undefined) {
      const ordered =
        lines !== undefined
          ? this.priced(lines).totals.totalQuantity
          : purchaseOrderTotal.compute(
              (await this.lines(id)).map((line) => ({
                unitPrice: line.unitPrice,
                quantity: line.quantity,
                gstPercent: line.gstPercent ?? undefined,
              })),
            ).totalQuantity;

      const addresses = deliveryAddresses ?? (await this.deliveries(id));
      this.guardAllocation(addresses, ordered);
    }

    await writing(() =>
      this.db.transaction(async (tx) => {
        const patch: Record<string, unknown> = { ...header, ...updatedBy(actorId) };

        if (header.documentDate !== undefined) {
          patch.documentDate = header.documentDate ? new Date(header.documentDate) : null;
        }
        if (header.deliveryDate !== undefined) {
          patch.deliveryDate = header.deliveryDate ? new Date(header.deliveryDate) : null;
        }
        // `undefined` means "not sent" and must not become a null column; the
        // sanitiser turns an emptied editor into null, which IS a value to write.
        if (header.terms !== undefined) {
          patch.terms = sanitiseTerms(header.terms);
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

        /**
         * Replaced wholesale, for the same reason the lines are: the panels have
         * no stable client-side row identity, so a partial update cannot say
         * which address it means.
         *
         * The source instead matches existing rows BY ADDRESS TEXT and deletes
         * whatever is not in the posted list (`PurchaseOrderRepo.cs:776-808`),
         * which has two consequences it does not intend. Two addresses that are
         * the same string collapse into one row, and a group address stored with
         * the `"Group-"` prefix never matches the unprefixed string posted back,
         * so it is deleted and reinserted on every save.
         */
        if (deliveryAddresses !== undefined) {
          await tx
            .delete(purchaseOrderDeliveryAddresses)
            .where(eq(purchaseOrderDeliveryAddresses.purchaseOrderId, id));

          if (deliveryAddresses.length > 0) {
            await tx
              .insert(purchaseOrderDeliveryAddresses)
              .values(this.deliveryRows(deliveryAddresses, id, actorId));
          }
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
