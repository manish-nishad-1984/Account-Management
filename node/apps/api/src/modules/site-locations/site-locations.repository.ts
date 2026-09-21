import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type {
  ListQuery,
  SaveSiteLocations,
  SiteLocationDetail,
  SortDirection,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { siteLocations, sites } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

/** How many location names the list preview carries. */
const NAME_PREVIEW = 5;

export interface SiteLocationListRow {
  id: string;
  siteName: string;
  locationCount: number;
  addressCount: number;
  locationNames: string[];
}

/**
 * Site locations, one entry per site. See `db/schema/site-locations.ts` for what
 * replaced the site groups and why the shape changed.
 *
 * THERE IS NO ENTRY TABLE. A site "has an entry" when it has a live location, so
 * the list is a query over `sites` filtered on that, and deleting an entry
 * soft-deletes them all.
 *
 * ONE LIST SINCE 17 SEP 2026. A location and its address are one row — see the
 * contract for why the business reversed the two-list shape it chose on 15 Sep.
 * `site_location_addresses` is no longer read; migration 0020 copied it in here.
 *
 * Every outer reference inside a `sql` template is written `${sites}.id`, not
 * `${sites.id}`. Drizzle renders the latter unqualified, and inside a subquery
 * over `site_locations` — which has an `id` of its own — the correlation would
 * silently bind to the wrong table and match nothing. §7.1 of the handoff.
 */
@Injectable()
export class SiteLocationsRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  private hasEntry() {
    return sql`exists (
      select 1 from ${siteLocations} l where l.site_id = ${sites}.id and l.is_deleted = false
    )`;
  }

  /** A search matches the site's name, a live location name, or its address. */
  private searchFilter(search: string | undefined) {
    if (!search) return undefined;
    const pattern = `%${search}%`;
    return sql`(
      ${sites.name} ilike ${pattern}
      or exists (
        select 1 from ${siteLocations} l
        where l.site_id = ${sites}.id and l.is_deleted = false
          and (l.name ilike ${pattern} or l.address ilike ${pattern})
      )
    )`;
  }

  async list(query: ListQuery): Promise<{ rows: SiteLocationListRow[]; nextCursor: string | null }> {
    const direction: SortDirection = query.sortDir;
    const filters = [eq(sites.isDeleted, false), this.hasEntry()];
    const match = this.searchFilter(query.search);
    if (match) filters.push(match);

    const seek = keysetWhere(
      sites.name,
      sites.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) filters.push(seek);

    const locationCount = sql<number>`(
      select count(*)::int from ${siteLocations} l
      where l.site_id = ${sites}.id and l.is_deleted = false
    )`;
    /**
     * How many pairs actually have an address — a PROGRESS figure, not a second
     * list's length. After migration 0020 a site holds pairs with no address and
     * pairs with no name, and "7 locations, 3 with an address" is what somebody
     * tidying this up needs to see without opening the form.
     */
    const addressCount = sql<number>`(
      select count(*)::int from ${siteLocations} l
      where l.site_id = ${sites}.id and l.is_deleted = false
        and coalesce(l.address, '') <> ''
    )`;
    const locationNames = sql<string[]>`(
      select coalesce(array_agg(n.name order by n.name), '{}')
      from (
        select l.name from ${siteLocations} l
        where l.site_id = ${sites}.id and l.is_deleted = false and l.name <> ''
        order by l.name
        limit ${NAME_PREVIEW}
      ) n
    )`;

    const rows = await this.db
      .select({
        id: sites.id,
        siteName: sites.name,
        locationCount,
        addressCount,
        locationNames,
        sortValue: sql<string>`${sites.name}::text`,
      })
      .from(sites)
      .where(and(...filters))
      .orderBy(...keysetOrder(sites.name, sites.id, direction))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    return {
      rows: page.rows.map(({ sortValue: _ignored, ...row }) => row),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string): Promise<number> {
    const filters = [eq(sites.isDeleted, false), this.hasEntry()];
    const match = this.searchFilter(search);
    if (match) filters.push(match);
    const [row] = await this.db.select({ value: count() }).from(sites).where(and(...filters));
    return row?.value ?? 0;
  }

  /**
   * A site's pairs. An empty answer for a site with none is a real answer — the
   * form uses it to decide it is creating, not editing.
   */
  async findBySite(siteId: string, db: Database = this.db): Promise<SiteLocationDetail> {
    const [site] = await db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(and(eq(sites.id, siteId), eq(sites.isDeleted, false)))
      .limit(1);
    if (!site) {
      throw new NotFoundException("Site not found");
    }

    /**
     * BY NAME, not by `created_at`. Every location added in one save shares a
     * `created_at` — PostgreSQL's `now()` is the TRANSACTION's start time — so
     * "the order they were keyed" is not recorded, and a sort on it falls back to
     * whatever the ties happen to do. Name order is what the document forms show
     * too.
     *
     * Ascending puts the UNNAMED pairs at the top, which is where they want to
     * be: those are the migrated addresses waiting for someone to name them.
     */
    const rows = await db
      .select({
        id: siteLocations.id,
        name: siteLocations.name,
        address: siteLocations.address,
      })
      .from(siteLocations)
      .where(and(eq(siteLocations.siteId, siteId), eq(siteLocations.isDeleted, false)))
      .orderBy(siteLocations.name);

    return {
      siteId: site.id,
      siteName: site.name,
      // The column is nullable; the contract says `string`. "" is the blank.
      locations: rows.map((row) => ({ ...row, address: row.address ?? "" })),
    };
  }

  /** Refused when the site already has an entry: that is an edit, not a create. */
  async create(siteId: string, input: SaveSiteLocations, actorId: string): Promise<SiteLocationDetail> {
    const existing = await this.findBySite(siteId);
    if (existing.locations.length > 0) {
      throw new ConflictException(
        `${existing.siteName} already has locations. Open it from the list to change them.`,
      );
    }
    return this.save(siteId, input, actorId);
  }

  /**
   * Writes a site's pairs, in one transaction.
   *
   * PAIRS ARE MATCHED BY ID, because documents reference a location by id: a row
   * sent with its id is updated in place, a row sent without one is new, and a
   * stored pair left out of the list is SOFT-deleted — the orders that name it
   * keep the name they were raised with.
   *
   * Removals are written before renames and inserts, so a person who deletes
   * "Block A" and adds a new "Block A" in one save does not trip the unique
   * index on a name that is on its way out.
   */
  async save(siteId: string, input: SaveSiteLocations, actorId: string): Promise<SiteLocationDetail> {
    /**
     * A pair with BOTH halves blank is dropped rather than refused — that is what
     * a `+` pressed once too often produces, and it is not a mistake worth a
     * validation message. A pair with ONE half filled is kept: an address with no
     * name yet is the state migration 0020 left every old address in, and a name
     * with no address yet is a block somebody has just set up.
     */
    const pairs = input.locations
      .map((row) => ({ id: row.id, name: row.name.trim(), address: row.address.trim() }))
      .filter((row) => row.name !== "" || row.address !== "");

    /**
     * Only NAMED pairs are checked for duplicates. Several unnamed ones on a site
     * is the normal state after the migration — BHAVNAGAR-RAJUBHAI arrived with
     * eight — and refusing them would make that site unsaveable until every one
     * had been named in a single sitting. The unique index carries the same
     * exemption.
     */
    const named = pairs.filter((row) => row.name !== "").map((row) => row.name.toLowerCase());
    const repeated = named.find((name, index) => named.indexOf(name) !== index);
    if (repeated !== undefined) {
      const shown = pairs.find((row) => row.name.toLowerCase() === repeated)!.name;
      throw new BadRequestException(`"${shown}" is listed twice. Each location name must be different.`);
    }

    await writing(() =>
      this.db.transaction(async (tx) => {
        const handle = tx as unknown as Database;
        const current = await this.findBySite(siteId, handle);
        const currentIds = new Set(current.locations.map((row) => row.id));

        const sentIds = pairs.map((row) => row.id).filter((id): id is string => id !== null);
        const foreign = sentIds.find((id) => !currentIds.has(id));
        if (foreign !== undefined) {
          throw new BadRequestException("One of these locations does not belong to this site");
        }

        const removed = [...currentIds].filter((id) => !sentIds.includes(id));
        if (removed.length > 0) {
          await tx
            .update(siteLocations)
            .set({ isDeleted: true, ...updatedBy(actorId) })
            .where(and(eq(siteLocations.siteId, siteId), inArray(siteLocations.id, removed)));
        }

        for (const row of pairs) {
          // Stored as NULL rather than "", so "no address" is one value in the
          // database instead of two that queries have to remember to both check.
          const address = row.address === "" ? null : row.address;

          if (row.id === null) {
            await tx
              .insert(siteLocations)
              .values({ siteId, name: row.name, address, ...createdBy(actorId) });
            continue;
          }

          const before = current.locations.find((location) => location.id === row.id);
          if (before && (before.name !== row.name || before.address !== row.address)) {
            await tx
              .update(siteLocations)
              .set({ name: row.name, address, ...updatedBy(actorId) })
              .where(and(eq(siteLocations.id, row.id), eq(siteLocations.siteId, siteId)));
          }
        }
      }),
    );

    return this.findBySite(siteId);
  }

  /**
   * Empties the site's list. Pairs are SOFT-deleted, so documents keep the
   * location name they were raised with.
   *
   * `site_location_addresses` is deliberately not touched. Nothing reads it, and
   * it holds the only pre-pairing copy of these addresses — see migration 0020.
   */
  async remove(siteId: string, actorId: string): Promise<void> {
    await this.findBySite(siteId);
    await this.db
      .update(siteLocations)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(siteLocations.siteId, siteId), eq(siteLocations.isDeleted, false)));
  }
}
