import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import type {
  CreateSite,
  ListQuery,
  SiteDetail,
  SortDirection,
  UpdateSite,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { siteGroupSites, sites, userSites } from "../../db/schema";
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
}
