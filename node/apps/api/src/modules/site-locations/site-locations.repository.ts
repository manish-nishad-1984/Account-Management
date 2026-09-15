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
import { siteLocationAddresses, siteLocations, sites } from "../../db/schema";
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
 * THERE IS NO ENTRY TABLE. A site "has an entry" when it has a live location or
 * a location address, so the list is a query over `sites` filtered on those, and
 * deleting an entry empties both lists.
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
    return sql`(
      exists (select 1 from ${siteLocations} l where l.site_id = ${sites}.id and l.is_deleted = false)
      or exists (select 1 from ${siteLocationAddresses} a where a.site_id = ${sites}.id)
    )`;
  }

  /** A search matches the site's name or any of its live location names. */
  private searchFilter(search: string | undefined) {
    if (!search) return undefined;
    const pattern = `%${search}%`;
    return sql`(
      ${sites.name} ilike ${pattern}
      or exists (
        select 1 from ${siteLocations} l
        where l.site_id = ${sites}.id and l.is_deleted = false and l.name ilike ${pattern}
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
    const addressCount = sql<number>`(
      select count(*)::int from ${siteLocationAddresses} a where a.site_id = ${sites}.id
    )`;
    const locationNames = sql<string[]>`(
      select coalesce(array_agg(n.name order by n.name), '{}')
      from (
        select l.name from ${siteLocations} l
        where l.site_id = ${sites}.id and l.is_deleted = false
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
   * A site's locations and addresses. An empty answer for a site with neither is
   * a real answer — the form uses it to decide it is creating, not editing.
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

    const [locations, addresses] = await Promise.all([
      /**
       * BY NAME, not by `created_at`. Every location added in one save shares a
       * `created_at` — PostgreSQL's `now()` is the TRANSACTION's start time — so
       * "the order they were keyed" is not recorded, and a sort on it falls back
       * to whatever the ties happen to do. Name order is what the document forms
       * show too.
       */
      db
        .select({ id: siteLocations.id, name: siteLocations.name })
        .from(siteLocations)
        .where(and(eq(siteLocations.siteId, siteId), eq(siteLocations.isDeleted, false)))
        .orderBy(siteLocations.name),
      db
        .select({ id: siteLocationAddresses.id, address: siteLocationAddresses.address })
        .from(siteLocationAddresses)
        .where(eq(siteLocationAddresses.siteId, siteId))
        .orderBy(siteLocationAddresses.lineNumber),
    ]);

    return { siteId: site.id, siteName: site.name, locations, addresses };
  }

  /** Refused when the site already has an entry: that is an edit, not a create. */
  async create(siteId: string, input: SaveSiteLocations, actorId: string): Promise<SiteLocationDetail> {
    const existing = await this.findBySite(siteId);
    if (existing.locations.length > 0 || existing.addresses.length > 0) {
      throw new ConflictException(
        `${existing.siteName} already has locations. Open it from the list to change them.`,
      );
    }
    return this.save(siteId, input, actorId);
  }

  /**
   * Writes a site's two lists, in one transaction.
   *
   * LOCATIONS ARE MATCHED BY ID, because documents reference them by id: a row
   * sent with its id is renamed in place, a row sent without one is new, and a
   * stored location left out of the list is SOFT-deleted — the orders that name
   * it keep the name they were raised with.
   *
   * Removals are written before renames and inserts, so a person who deletes
   * "Block A" and adds a new "Block A" in one save does not trip the unique
   * index on a name that is on its way out.
   *
   * ADDRESSES ARE REPLACED outright. Nothing references them.
   */
  async save(siteId: string, input: SaveSiteLocations, actorId: string): Promise<SiteLocationDetail> {
    const names = input.locations.map((row) => row.name.trim().toLowerCase());
    const repeated = names.find((name, index) => names.indexOf(name) !== index);
    if (repeated !== undefined) {
      const shown = input.locations[names.indexOf(repeated)]!.name.trim();
      throw new BadRequestException(`"${shown}" is listed twice. Each location name must be different.`);
    }

    await writing(() =>
      this.db.transaction(async (tx) => {
        const handle = tx as unknown as Database;
        const current = await this.findBySite(siteId, handle);
        const currentIds = new Set(current.locations.map((row) => row.id));

        const sentIds = input.locations
          .map((row) => row.id)
          .filter((id): id is string => id !== null);
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

        for (const row of input.locations) {
          const name = row.name.trim();
          if (row.id === null) {
            await tx.insert(siteLocations).values({ siteId, name, ...createdBy(actorId) });
            continue;
          }
          const before = current.locations.find((location) => location.id === row.id);
          if (before && before.name !== name) {
            await tx
              .update(siteLocations)
              .set({ name, ...updatedBy(actorId) })
              .where(and(eq(siteLocations.id, row.id), eq(siteLocations.siteId, siteId)));
          }
        }

        await tx.delete(siteLocationAddresses).where(eq(siteLocationAddresses.siteId, siteId));
        const addresses = [...new Set(input.addresses.map((value) => value.trim()))].filter(
          (value) => value !== "",
        );
        if (addresses.length > 0) {
          await tx
            .insert(siteLocationAddresses)
            .values(addresses.map((address, index) => ({ siteId, address, lineNumber: index + 1 })));
        }
      }),
    );

    return this.findBySite(siteId);
  }

  /** Empties both lists. Locations are soft-deleted, so documents keep their names. */
  async remove(siteId: string, actorId: string): Promise<void> {
    await this.findBySite(siteId);
    await this.db.transaction(async (tx) => {
      await tx
        .update(siteLocations)
        .set({ isDeleted: true, ...updatedBy(actorId) })
        .where(and(eq(siteLocations.siteId, siteId), eq(siteLocations.isDeleted, false)));
      await tx.delete(siteLocationAddresses).where(eq(siteLocationAddresses.siteId, siteId));
    });
  }
}
