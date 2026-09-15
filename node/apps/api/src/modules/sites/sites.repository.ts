import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import type {
  AddressChoice,
  CreateSite,
  ListQuery,
  SaveSiteAddress,
  SiteAddress,
  SiteContact,
  SiteContactInput,
  SiteDetail,
  SiteDocumentOptions,
  SortDirection,
  UpdateSite,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import {
  siteAddresses,
  siteContacts,
  siteLocationAddresses,
  siteLocations,
  sites,
  userSites,
} from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";
import { blankToNull } from "./site-document-rules";

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
  contactCount: number;
  locationCount: number;
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

    // Independent counts, one correlated subquery each. Joining them would
    // multiply the rows together and give a site with 3 users and 2 locations a
    // count of 6 for each — the exact defect the .NET list queries carry.
    // The outer reference is table-qualified deliberately — see the note in
    // site-locations.repository.ts. Bare `${sites.id}` renders as `"id"` and binds
    // to whichever joined table happens to have one.
    const userCount = sql<number>`(
      select count(*)::int from ${userSites} where ${userSites.siteId} = ${sites}.id
    )`;
    const contactCount = sql<number>`(
      select count(*)::int from ${siteContacts} where ${siteContacts.siteId} = ${sites}.id
    )`;
    const locationCount = sql<number>`(
      select count(*)::int from ${siteLocations}
      where ${siteLocations.siteId} = ${sites}.id and ${siteLocations.isDeleted} = false
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
        contactCount,
        locationCount,
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
    return { ...row, contacts: await this.contacts(id) };
  }

  /** The contact list, in the order it was keyed. */
  private contacts(siteId: string): Promise<SiteContact[]> {
    return this.db
      .select({ id: siteContacts.id, name: siteContacts.name, phone: siteContacts.phone })
      .from(siteContacts)
      .where(eq(siteContacts.siteId, siteId))
      .orderBy(siteContacts.lineNumber);
  }

  /**
   * THE FIRST CONTACT IS ALSO WRITTEN TO THE SITE'S OWN TWO COLUMNS.
   *
   * `contact_person_name` / `contact_person_phone_no` predate the list, and the
   * Sites grid, the importer and the print data all read them. Deriving them
   * from the list — and ignoring whatever the body says for those two fields
   * when a list is sent — means the two can never disagree.
   */
  private withPrimaryContact<T extends { contacts?: SiteContactInput[] }>(input: T) {
    const { contacts, ...columns } = input;
    if (contacts === undefined) return { columns, contacts };
    const first = contacts[0];
    return {
      columns: {
        ...columns,
        contactPersonName: first?.name ?? null,
        contactPersonPhoneNo: first?.phone ?? null,
      },
      contacts,
    };
  }

  /** Replaces the whole list. Nothing references a contact, so ids need not survive. */
  private async writeContacts(tx: Database, siteId: string, contacts: SiteContactInput[]) {
    await tx.delete(siteContacts).where(eq(siteContacts.siteId, siteId));
    if (contacts.length > 0) {
      await tx.insert(siteContacts).values(
        contacts.map((contact, index) => ({
          siteId,
          name: contact.name,
          phone: contact.phone,
          lineNumber: index + 1,
        })),
      );
    }
  }

  async create(input: CreateSite, actorId: string): Promise<SiteDetail> {
    const { columns, contacts } = this.withPrimaryContact(input);
    const id = await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(sites)
          .values({ ...columns, ...createdBy(actorId) })
          .returning({ id: sites.id });
        await this.writeContacts(tx as unknown as Database, row!.id, contacts ?? []);
        return row!.id;
      }),
    );
    return this.findById(id);
  }

  async update(id: string, input: UpdateSite, actorId: string): Promise<SiteDetail> {
    const { columns, contacts } = this.withPrimaryContact(input);
    await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(sites)
          .set({ ...columns, ...updatedBy(actorId) })
          .where(and(eq(sites.id, id), eq(sites.isDeleted, false)))
          .returning({ id: sites.id });

        if (!row) {
          throw new NotFoundException("Site not found");
        }
        if (contacts !== undefined) {
          await this.writeContacts(tx as unknown as Database, id, contacts);
        }
      }),
    );
    return this.findById(id);
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
   *  - `site_locations` — documents reference a location by id, and the
   *    locations of a deleted site would stay on the Site Location screen under
   *    a site no other screen shows. Remove them there first.
   *
   * Both counts are gathered before refusing, so the message can say what is
   * actually in the way rather than making the user rediscover it one at a time.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const [[assignedUsers], [liveLocations]] = await Promise.all([
      this.db.select({ value: count() }).from(userSites).where(eq(userSites.siteId, id)),
      this.db
        .select({ value: count() })
        .from(siteLocations)
        .where(and(eq(siteLocations.siteId, id), eq(siteLocations.isDeleted, false))),
    ]);

    const blockers: string[] = [];
    const users = assignedUsers?.value ?? 0;
    const locations = liveLocations?.value ?? 0;
    if (users > 0) {
      blockers.push(`${users} assigned ${users === 1 ? "user" : "users"}`);
    }
    if (locations > 0) {
      blockers.push(`${locations} site ${locations === 1 ? "location" : "locations"}`);
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
   * What an order or invoice form needs from its site: the billing address, the
   * shipping choices and the location names.
   *
   * BILLING is the site's own address and nothing else — the business rule of
   * 15 Sep 2026. The forms show it; the document repositories copy it with
   * `billingAddressOf` below, so the rule holds whatever a client sends.
   *
   * SHIPPING is one list: the site's own address, its shipping address if that
   * differs, the Site master's delivery addresses, then the Site Location
   * screen's addresses. Blank entries are dropped rather than offered as empty
   * options, and an address that repeats one already in the list is dropped with
   * them: a site whose shipping address was filled in by copying its billing
   * address — which several have — would otherwise offer the same words twice
   * with no way to tell which is which.
   */
  async documentOptions(siteId: string): Promise<SiteDocumentOptions> {
    const site = await this.requireSite(siteId);
    const [extras, locationAddresses, locations] = await Promise.all([
      this.listAddresses(siteId),
      this.db
        .select({ id: siteLocationAddresses.id, address: siteLocationAddresses.address })
        .from(siteLocationAddresses)
        .where(eq(siteLocationAddresses.siteId, siteId))
        .orderBy(siteLocationAddresses.lineNumber),
      this.db
        .select({ id: siteLocations.id, name: siteLocations.name })
        .from(siteLocations)
        .where(and(eq(siteLocations.siteId, siteId), eq(siteLocations.isDeleted, false)))
        .orderBy(siteLocations.name),
    ]);

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
    for (const row of locationAddresses) {
      offer(`location-${row.id}`, "location", row.address);
    }

    return {
      billingAddress: blankToNull(site.address),
      // `billingAddressOf` in site-document-rules.ts applies the same rule on save.
      shippingAddresses: choices,
      locations,
    };
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
