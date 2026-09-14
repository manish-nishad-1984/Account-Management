import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import type {
  AddressChoice,
  CreateSite,
  ListQuery,
  SaveSiteAddress,
  SiteAddress,
  SiteDetail,
  SortDirection,
  UpdateSite,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { siteAddresses, siteGroupSites, sites, userSites } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

const SORTABLE = {
  name: sites.name,
  createdAt: sites.createdAt,
} as const;

/**
 * The detail projection. `company_id` is absent on purpose: there is no
 * Company-to-Site relationship in the source schema, the column was invented by
 * an earlier session, and nothing derives it from production data. Exposing it
 * would let a form write a relationship the business has never confirmed exists.
 */
const DETAIL_COLUMNS = {
  id: sites.id,
  name: sites.name,
  isActive: sites.isActive,
  contactPersonName: sites.contactPersonName,
  contactPersonPhoneNo: sites.contactPersonPhoneNo,
  address: sites.address,
  area: sites.area,
  cityId: sites.cityId,
  stateId: sites.stateId,
  countryId: sites.countryId,
  pincode: sites.pincode,
  shippingAddress: sites.shippingAddress,
  shippingArea: sites.shippingArea,
  shippingCityId: sites.shippingCityId,
  shippingStateId: sites.shippingStateId,
  shippingCountryId: sites.shippingCountryId,
  shippingPincode: sites.shippingPincode,
} as const;

export type SiteSortKey = keyof typeof SORTABLE;

export interface SiteListRow {
  id: string;
  name: string;
  isActive: boolean;
  contactPersonName: string | null;
  contactPersonPhoneNo: string | null;
  area: string | null;
  pincode: string | null;
  userCount: number;
  groupCount: number;
}

@Injectable()
export class SitesRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  private searchFilter(search: string | undefined) {
    if (!search) {
      return undefined;
    }
    const pattern = `%${search}%`;
    return or(
      ilike(sites.name, pattern),
      ilike(sites.area, pattern),
      ilike(sites.contactPersonName, pattern),
    );
  }

  async list(query: ListQuery): Promise<{ rows: SiteListRow[]; nextCursor: string | null }> {
    const sortKey: SiteSortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as SiteSortKey) : "name";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const filters = [eq(sites.isDeleted, false)];
    const match = this.searchFilter(query.search);
    if (match) {
      filters.push(match);
    }

    const seek = keysetWhere(
      sortColumn,
      sites.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) {
      filters.push(seek);
    }

    // Two independent counts, two correlated subqueries. Joining both would
    // multiply the rows together and give a site with 3 users and 2 groups a
    // count of 6 for each — the exact defect the .NET list queries carry.
    // The outer reference is table-qualified deliberately — see the note in
    // site-groups.repository.ts. Bare `${sites.id}` renders as `"id"` and binds
    // to whichever joined table happens to have one.
    const userCount = sql<number>`(
      select count(*)::int from ${userSites} where ${userSites.siteId} = ${sites}.id
    )`;
    const groupCount = sql<number>`(
      select count(*)::int from ${siteGroupSites} where ${siteGroupSites.siteId} = ${sites}.id
    )`;

    const rows = await this.db
      .select({
        id: sites.id,
        name: sites.name,
        isActive: sites.isActive,
        contactPersonName: sites.contactPersonName,
        contactPersonPhoneNo: sites.contactPersonPhoneNo,
        area: sites.area,
        pincode: sites.pincode,
        userCount,
        groupCount,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(sites)
      .where(and(...filters))
      .orderBy(...keysetOrder(sortColumn, sites.id, direction))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    return {
      rows: page.rows.map(({ sortValue: _ignored, ...row }) => row),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string): Promise<number> {
    const filters = [eq(sites.isDeleted, false)];
    const match = this.searchFilter(search);
    if (match) {
      filters.push(match);
    }
    const [row] = await this.db.select({ value: count() }).from(sites).where(and(...filters));
    return row?.value ?? 0;
  }

  /**
   * The sites this user may scope the application to, for the header picker.
   *
   * Two cases, matching `Main_Layout.cshtml` — see `siteScopeResponseSchema`:
   * rows in `user_sites` mean the user is assigned and gets exactly those; no
   * rows means unassigned, and the old layout falls back to every site.
   *
   * INACTIVE SITES ARE INCLUDED when they are assigned to the user, and excluded
   * from the unassigned fallback. `GetSiteNameList` filters on `IsActive`, so the
   * fallback matches it — but `UserSession.SiteData` does not, so a user assigned
   * to a site that was later deactivated still sees it. That asymmetry is the
   * source's, and dropping the assigned site would hide documents the user is
   * responsible for from the only person able to see them.
   *
   * Soft-deleted sites are excluded either way. A deleted site is gone.
   */
  async scopeFor(userId: string | undefined): Promise<{
    scope: "assigned" | "all";
    sites: { id: string; name: string }[];
  }> {
    const assigned = userId
      ? await this.db
          .select({ id: sites.id, name: sites.name })
          .from(userSites)
          .innerJoin(sites, eq(sites.id, userSites.siteId))
          .where(and(eq(userSites.userId, userId), eq(sites.isDeleted, false)))
          .orderBy(sites.name)
      : [];

    if (assigned.length > 0) {
      return { scope: "assigned", sites: assigned };
    }

    const all = await this.db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(and(eq(sites.isDeleted, false), eq(sites.isActive, true)))
      .orderBy(sites.name);

    return { scope: "all", sites: all };
  }

  /** One site, or 404. A soft-deleted site is a 404, not a hidden but editable row. */
  async findById(id: string): Promise<SiteDetail> {
    const [row] = await this.db
      .select(DETAIL_COLUMNS)
      .from(sites)
      .where(and(eq(sites.id, id), eq(sites.isDeleted, false)))
      .limit(1);

    if (!row) {
      throw new NotFoundException("Site not found");
    }
    return row;
  }

  async create(input: CreateSite, actorId: string): Promise<SiteDetail> {
    const [row] = await writing(() =>
      this.db
        .insert(sites)
        .values({ ...input, ...createdBy(actorId) })
        .returning(DETAIL_COLUMNS),
    );
    return row!;
  }

  async update(id: string, input: UpdateSite, actorId: string): Promise<SiteDetail> {
    const [row] = await writing(() =>
      this.db
        .update(sites)
        .set({ ...input, ...updatedBy(actorId) })
        .where(and(eq(sites.id, id), eq(sites.isDeleted, false)))
        .returning(DETAIL_COLUMNS),
    );

    if (!row) {
      throw new NotFoundException("Site not found");
    }
    return row;
  }

  /**
   * Soft delete, refused while anything still points at the site.
   *
   * Two references matter and neither is cleaned up by a soft delete, because a
   * soft delete fires no cascade:
   *
   *  - `user_sites` — the assignments would survive and every affected user's
   *    access token would keep carrying the id in `siteIds`, which is what site
   *    scoping is read from.
   *  - `site_group_sites` — the group would keep a member no screen can show,
   *    and site groups are read-only in this app (only `Group-View` exists), so
   *    nobody could remove it afterwards even if they noticed.
   *
   * Both counts are gathered before refusing, so the message can say what is
   * actually in the way rather than making the user rediscover it one at a time.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const [[assignedUsers], [memberOfGroups]] = await Promise.all([
      this.db.select({ value: count() }).from(userSites).where(eq(userSites.siteId, id)),
      this.db
        .select({ value: count() })
        .from(siteGroupSites)
        .where(eq(siteGroupSites.siteId, id)),
    ]);

    const blockers: string[] = [];
    const users = assignedUsers?.value ?? 0;
    const groups = memberOfGroups?.value ?? 0;
    if (users > 0) {
      blockers.push(`${users} assigned ${users === 1 ? "user" : "users"}`);
    }
    if (groups > 0) {
      blockers.push(`${groups} site ${groups === 1 ? "group" : "groups"}`);
    }

    if (blockers.length > 0) {
      throw new ConflictException(
        `This site still has ${blockers.join(" and ")}. Detach ${
          blockers.length === 1 ? "it" : "them"
        } before deleting it.`,
      );
    }

    const [row] = await this.db
      .update(sites)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(sites.id, id), eq(sites.isDeleted, false)))
      .returning({ id: sites.id });

    if (!row) {
      throw new NotFoundException("Site not found");
    }
  }

  /**
   * THE DELIVERY ADDRESSES OF ONE SITE.
   *
   * Ordered by id, which is the order they were added in: `site_addresses.id`
   * is an identity column, and the table has no name, no label and no sort
   * field of its own to order by instead.
   *
   * Soft-deleted rows are excluded here and nowhere else. A purchase order that
   * already names a deleted address keeps showing it, because the order stores
   * the address as TEXT rather than as a reference — which is the behaviour the
   * source has and the right one for a document.
   */
  async listAddresses(siteId: string): Promise<SiteAddress[]> {
    await this.requireSite(siteId);
    return this.db
      .select({
        id: siteAddresses.id,
        siteId: siteAddresses.siteId,
        address: siteAddresses.address,
      })
      .from(siteAddresses)
      .where(and(eq(siteAddresses.siteId, siteId), eq(siteAddresses.isDeleted, false)))
      .orderBy(siteAddresses.id);
  }

  async addAddress(siteId: string, input: SaveSiteAddress): Promise<SiteAddress> {
    await this.requireSite(siteId);
    const [row] = await writing(() =>
      this.db
        .insert(siteAddresses)
        .values({ siteId, address: input.address })
        .returning({
          id: siteAddresses.id,
          siteId: siteAddresses.siteId,
          address: siteAddresses.address,
        }),
    );
    return row!;
  }

  /**
   * The site id is part of the WHERE clause, not just of the URL.
   *
   * Without it, anyone who can edit any site could edit any address by number —
   * the ids are small integers, so guessing is not a feat. The route reads as
   * nested; the query has to be nested too.
   */
  async updateAddress(
    siteId: string,
    addressId: number,
    input: SaveSiteAddress,
  ): Promise<SiteAddress> {
    const [row] = await writing(() =>
      this.db
        .update(siteAddresses)
        .set({ address: input.address })
        .where(
          and(
            eq(siteAddresses.id, addressId),
            eq(siteAddresses.siteId, siteId),
            eq(siteAddresses.isDeleted, false),
          ),
        )
        .returning({
          id: siteAddresses.id,
          siteId: siteAddresses.siteId,
          address: siteAddresses.address,
        }),
    );
    if (!row) {
      throw new NotFoundException("Address not found");
    }
    return row;
  }

  /** Soft delete, matching every other delete in the application. */
  async removeAddress(siteId: string, addressId: number): Promise<void> {
    const [row] = await this.db
      .update(siteAddresses)
      .set({ isDeleted: true })
      .where(
        and(
          eq(siteAddresses.id, addressId),
          eq(siteAddresses.siteId, siteId),
          eq(siteAddresses.isDeleted, false),
        ),
      )
      .returning({ id: siteAddresses.id });

    if (!row) {
      throw new NotFoundException("Address not found");
    }
  }

  /**
   * Everywhere a delivery can go for this site, as one list for a dropdown.
   *
   * The site's own address leads, then its shipping address if it has one that
   * differs, then the extra addresses. Blank entries are dropped rather than
   * offered as empty options, and an address that repeats one already in the
   * list is dropped with them: a site whose shipping address was filled in by
   * copying its billing address — which several have — would otherwise offer
   * the same words twice with no way to tell which is which.
   */
  async addressChoices(siteId: string): Promise<AddressChoice[]> {
    const site = await this.requireSite(siteId);
    const extras = await this.listAddresses(siteId);

    const choices: AddressChoice[] = [];
    const seen = new Set<string>();
    const offer = (key: string, source: AddressChoice["source"], value: string | null) => {
      const address = (value ?? "").trim();
      if (address === "" || seen.has(address.toLowerCase())) return;
      seen.add(address.toLowerCase());
      choices.push({ key, source, address });
    };

    offer("site", "site", site.address);
    offer("site-shipping", "site-shipping", site.shippingAddress);
    for (const extra of extras) {
      offer(`extra-${extra.id}`, "extra", extra.address);
    }
    return choices;
  }

  /** 404s rather than letting a bad site id look like a site with no addresses. */
  private async requireSite(
    siteId: string,
  ): Promise<{ address: string | null; shippingAddress: string | null }> {
    const [site] = await this.db
      .select({ address: sites.address, shippingAddress: sites.shippingAddress })
      .from(sites)
      .where(and(eq(sites.id, siteId), eq(sites.isDeleted, false)))
      .limit(1);

    if (!site) {
      throw new NotFoundException("Site not found");
    }
    return site;
  }
}
