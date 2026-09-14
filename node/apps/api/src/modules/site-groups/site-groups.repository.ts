import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, count, eq, ilike, sql } from "drizzle-orm";
import type {
  CreateSiteGroup,
  ListQuery,
  SiteGroupDetail,
  SortDirection,
  UpdateSiteGroup,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import {
  purchaseInvoices,
  purchaseOrders,
  siteGroupAddresses,
  siteGroupSites,
  siteGroups,
  sites,
} from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

const SORTABLE = {
  name: siteGroups.name,
  createdAt: siteGroups.createdAt,
} as const;

export type SiteGroupSortKey = keyof typeof SORTABLE;

/** How many member names the list preview carries. The grid shows a few, not all. */
const SITE_NAME_PREVIEW = 3;

export interface SiteGroupListRow {
  id: string;
  name: string;
  siteCount: number;
  addressCount: number;
  siteNames: string[];
}

@Injectable()
export class SiteGroupsRepository {
  constructor(@Inject(DATABASE) private readonly injected: Database | null) {}

  private get db(): Database {
    if (!this.injected) {
      throw new ServiceUnavailableException(
        "No database is configured. Set DATABASE_URL to use this endpoint.",
      );
    }
    return this.injected;
  }

  private searchFilter(search: string | undefined) {
    return search ? ilike(siteGroups.name, `%${search}%`) : undefined;
  }

  async list(query: ListQuery): Promise<{ rows: SiteGroupListRow[]; nextCursor: string | null }> {
    const sortKey: SiteGroupSortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as SiteGroupSortKey) : "name";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const filters = [eq(siteGroups.isDeleted, false)];
    const match = this.searchFilter(query.search);
    if (match) {
      filters.push(match);
    }

    const seek = keysetWhere(
      sortColumn,
      siteGroups.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      filters.push(seek);
    }

    /**
     * Sites and addresses are counted separately.
     *
     * In SQL Server both live in one table as a cross product, so neither count is
     * answerable without a GROUP BY and the two are not independent. Here they are
     * two subqueries over two tables, which is what the numbers always meant.
     *
     * Note the `${siteGroups}.id` form on every OUTER reference. Drizzle renders
     * `${table.column}` inside a `sql` template as a BARE column name with no table
     * qualifier, so the natural-looking `${siteGroupAddresses.groupId} = ${siteGroups.id}`
     * compiles to `where "group_id" = "id"` — and PostgreSQL resolves that `"id"`
     * against `site_group_addresses`, which has an `id` column of its own. The
     * correlation silently becomes `group_id = id`, matches almost nothing, and
     * every count comes back 0 with no error anywhere. Qualifying the outer
     * reference is what makes it correlate to the row being listed.
     */
    const siteCount = sql<number>`(
      select count(*)::int from ${siteGroupSites}
      where ${siteGroupSites.groupId} = ${siteGroups}.id
    )`;
    const addressCount = sql<number>`(
      select count(*)::int from ${siteGroupAddresses}
      where ${siteGroupAddresses.groupId} = ${siteGroups}.id
    )`;
    // A bounded preview, ordered so it is stable between requests. LIMIT lives
    // inside the subquery, so a group with 400 sites still costs 3 names. The
    // inner tables are aliased for the same qualification reason as above.
    const siteNames = sql<string[]>`(
      select coalesce(array_agg(n.name order by n.name), '{}')
      from (
        select s.name as name
        from ${siteGroupSites} gs
        join ${sites} s on s.id = gs.site_id
        where gs.group_id = ${siteGroups}.id and s.is_deleted = false
        order by s.name
        limit ${SITE_NAME_PREVIEW}
      ) n
    )`;

    const rows = await this.db
      .select({
        id: siteGroups.id,
        name: siteGroups.name,
        siteCount,
        addressCount,
        siteNames,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(siteGroups)
      .where(and(...filters))
      .orderBy(...keysetOrder(sortColumn, siteGroups.id, direction))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    return {
      rows: page.rows.map(({ sortValue: _ignored, ...row }) => row),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string): Promise<number> {
    const filters = [eq(siteGroups.isDeleted, false)];
    const match = this.searchFilter(search);
    if (match) {
      filters.push(match);
    }
    const [row] = await this.db.select({ value: count() }).from(siteGroups).where(and(...filters));
    return row?.value ?? 0;
  }

  /**
   * One group, with its members and addresses.
   *
   * Three queries rather than a join: a join across both child tables is the
   * cross product the source stores and this schema exists to undo — 4 sites and
   * 3 addresses would come back as 12 rows to be grouped again in JavaScript.
   */
  async findById(id: string): Promise<SiteGroupDetail> {
    const [group] = await this.db
      .select({ id: siteGroups.id, name: siteGroups.name })
      .from(siteGroups)
      .where(and(eq(siteGroups.id, id), eq(siteGroups.isDeleted, false)))
      .limit(1);

    if (!group) {
      throw new NotFoundException("Site group not found");
    }

    const [members, addresses] = await Promise.all([
      this.db
        .select({ siteId: siteGroupSites.siteId })
        .from(siteGroupSites)
        .where(eq(siteGroupSites.groupId, id)),
      this.db
        .select({ id: siteGroupAddresses.id, address: siteGroupAddresses.address })
        .from(siteGroupAddresses)
        .where(eq(siteGroupAddresses.groupId, id))
        .orderBy(siteGroupAddresses.address),
    ]);

    return {
      ...group,
      siteIds: members.map((row) => row.siteId),
      addresses,
    };
  }

  async create(input: CreateSiteGroup, actorId: string): Promise<SiteGroupDetail> {
    const id = await writing(() =>
      this.db.transaction(async (tx) => {
        const [group] = await tx
          .insert(siteGroups)
          .values({ name: input.name, ...createdBy(actorId) })
          .returning({ id: siteGroups.id });

        await this.writeChildren(tx as unknown as Database, group!.id, input);
        return group!.id;
      }),
    );

    return this.findById(id);
  }

  /**
   * A save REPLACES the members and the addresses it is given.
   *
   * Not a merge, and the difference is visible: the form sends the whole list it
   * is showing, so a site the person removed has to disappear. A key left OUT of
   * the payload is untouched, which is what makes a rename a rename.
   */
  async update(id: string, input: UpdateSiteGroup, actorId: string): Promise<SiteGroupDetail> {
    await writing(() =>
      this.db.transaction(async (tx) => {
        if (input.name !== undefined) {
          const [row] = await tx
            .update(siteGroups)
            .set({ name: input.name, ...updatedBy(actorId) })
            .where(and(eq(siteGroups.id, id), eq(siteGroups.isDeleted, false)))
            .returning({ id: siteGroups.id });
          if (!row) {
            throw new NotFoundException("Site group not found");
          }
        }

        if (input.siteIds !== undefined) {
          await tx.delete(siteGroupSites).where(eq(siteGroupSites.groupId, id));
        }
        if (input.addresses !== undefined) {
          await tx.delete(siteGroupAddresses).where(eq(siteGroupAddresses.groupId, id));
        }
        await this.writeChildren(tx as unknown as Database, id, input);
      }),
    );

    return this.findById(id);
  }

  /**
   * Soft delete, REFUSED while a document still points at the group.
   *
   * `purchase_orders.site_group_id` and `purchase_invoices.site_group_id` are
   * real foreign keys in this schema — the source matched on the group's NAME as
   * a string, which is why renaming one there silently detached its documents.
   * A soft delete fires no cascade, so those rows would keep a reference to a
   * group that no list shows, and the order screen would render a blank where
   * the group belongs.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const [orders, invoices] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.siteGroupId, id), eq(purchaseOrders.isDeleted, false)))
        .then((rows) => rows[0]?.value ?? 0),
      this.db
        .select({ value: count() })
        .from(purchaseInvoices)
        // No `is_deleted` on purchase invoices: the table has no soft delete, by
        // design — see the schema. Deleting an invoice deletes it.
        .where(eq(purchaseInvoices.siteGroupId, id))
        .then((rows) => rows[0]?.value ?? 0),
    ]);

    const blockers: string[] = [];
    if (orders > 0) blockers.push(`${orders} purchase ${orders === 1 ? "order" : "orders"}`);
    if (invoices > 0) {
      blockers.push(`${invoices} purchase ${invoices === 1 ? "invoice" : "invoices"}`);
    }

    if (blockers.length > 0) {
      throw new ConflictException(
        `This group is used by ${blockers.join(" and ")}. Change ${
          blockers.length === 1 ? "it" : "them"
        } before deleting the group.`,
      );
    }

    const [row] = await this.db
      .update(siteGroups)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(siteGroups.id, id), eq(siteGroups.isDeleted, false)))
      .returning({ id: siteGroups.id });

    if (!row) {
      throw new NotFoundException("Site group not found");
    }
  }

  /**
   * The members and addresses, written the same way by create and update.
   *
   * Both lists are de-duplicated first. `site_group_sites` has a composite
   * primary key, so the same site twice is a constraint violation rather than a
   * harmless repeat — and a multi-select that sends a duplicate is a bug in the
   * browser, not something the person did wrong.
   */
  private async writeChildren(
    tx: Database,
    groupId: string,
    input: { siteIds?: string[]; addresses?: string[] },
  ): Promise<void> {
    const siteIds = [...new Set(input.siteIds ?? [])];
    if (siteIds.length > 0) {
      await tx.insert(siteGroupSites).values(siteIds.map((siteId) => ({ groupId, siteId })));
    }

    const addresses = [...new Set((input.addresses ?? []).map((value) => value.trim()))].filter(
      (value) => value !== "",
    );
    if (addresses.length > 0) {
      await tx.insert(siteGroupAddresses).values(addresses.map((address) => ({ groupId, address })));
    }
  }
}
