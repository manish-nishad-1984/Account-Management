import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type {
  AgencyPerson,
  CreateAgencyPerson,
  CreateInventoryIssue,
  InventoryIssueQuery,
  InventoryIssueRow,
  InventoryItemRow,
  IssueStatus,
  PurchaseStockRow,
  ReceiveInventoryIssue,
  SaveInventoryItem,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import {
  agencies,
  agencyContacts,
  agencyPersons,
  inventoryInward,
  inventoryIssues,
  inventoryItems,
  units,
} from "../../db/schema";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { rawRows } from "../../common/raw-rows";
import { writing } from "../../common/db-errors";

type ItemOut = Omit<InventoryItemRow, "capabilities">;
type IssueOut = Omit<InventoryIssueRow, "capabilities">;

/** Exact decimal on hundredths: a quantity never goes through a float here. */
const toHundredths = (value: string | number | null | undefined): bigint => {
  const text = String(value ?? "0").trim();
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  return (negative ? -1n : 1n) * (BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2)));
};
const fromHundredths = (value: bigint): string => {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
};

/**
 * AN ITEM'S PHOTO (client, 30 Oct 2026): its own, or else the latest taken on an
 * arrival of it - the arrival's photo, then its pieces' in order - so an item
 * shows as a picture in the stock and the issues once any arrival of it has one.
 */
const itemPhotoKey = (itemId: SQL) => sql`coalesce(
  (select photo_key from inventory_items where id = ${itemId}),
  (select k.key from inventory_inward a
    cross join lateral (
      select a.photo_key as key, 0::bigint as n
      union all
      select p.value->>'photoKey', p.n from jsonb_array_elements(a.pieces) with ordinality as p(value, n)
    ) k
    where a.inventory_item_id = ${itemId} and a.is_deleted = false and k.key is not null
    order by a.created_at desc, k.n
    limit 1)
)`;

const iso = (value: unknown): string | null => (value === null || value === undefined ? null : new Date(String(value)).toISOString());

/**
 * An arrival names its item by id, or by a name typed for the first time: then
 * the master gets it, with its unit and the arrival's photo (client, 26 Oct 2026).
 * A name already in the master, in any case, is that item, not a second one.
 */
export async function resolveInventoryItem(
  db: Database,
  input: { inventoryItemId?: string | null; newItemName?: string; unit?: string; photoKey?: string | null },
  actorId: string,
): Promise<{ id: string; name: string }> {
  if (input.inventoryItemId) {
    const [found] = await db
      .select({ id: inventoryItems.id, name: inventoryItems.name, photoKey: inventoryItems.photoKey })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.id, input.inventoryItemId), eq(inventoryItems.isDeleted, false)));
    if (!found) throw new NotFoundException("Inventory item not found");
    // The first photo of an item that has none becomes the item's photo.
    if (!found.photoKey && input.photoKey) {
      await db.update(inventoryItems).set({ photoKey: input.photoKey }).where(eq(inventoryItems.id, found.id));
    }
    return found;
  }
  const name = (input.newItemName ?? "").trim();
  if (!name) throw new BadRequestException("Choose the item, or type a new one");
  const [same] = await db
    .select({ id: inventoryItems.id, name: inventoryItems.name })
    .from(inventoryItems)
    .where(and(sql`lower(${inventoryItems.name}) = lower(${name})`, eq(inventoryItems.isDeleted, false)));
  if (same) return same;
  const [created] = await db
    .insert(inventoryItems)
    .values({ name, unit: input.unit?.trim() || "Nos", photoKey: input.photoKey ?? null, ...createdBy(actorId) })
    .returning({ id: inventoryItems.id, name: inventoryItems.name });
  return created!;
}

/**
 * The inventory's stock, its issues and who takes them (client, 26 Oct 2026).
 * See `contracts/inventory-issues.ts` for the rules.
 */
@Injectable()
export class InventoryStockRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  // ---- the inventory item master -------------------------------------------------

  /** Every item, with its stock at the site (or at every site when none is given). */
  async items(siteId?: string): Promise<ItemOut[]> {
    const site = siteId ?? null;
    const rows = rawRows<Record<string, unknown>>(
      await this.db.execute(sql`
        select ii.id, ii.name, ii.unit, ii.note, ${itemPhotoKey(sql`ii.id`)} is not null as has_photo,
          coalesce((
            select sum(a.quantity) from inventory_inward a
            where a.inventory_item_id = ii.id and a.is_deleted = false
              and (${site}::uuid is null or a.site_id = ${site}::uuid)
          ), 0)::text as arrived,
          coalesce((
            select sum(i.quantity - coalesce(i.returned_quantity, 0)) from inventory_issues i
            where i.source = 'inventory' and i.inventory_item_id = ii.id and i.is_deleted = false
              and (${site}::uuid is null or i.site_id = ${site}::uuid)
          ), 0)::text as gone,
          coalesce((
            select sum(i.quantity) from inventory_issues i
            where i.source = 'inventory' and i.inventory_item_id = ii.id and i.is_deleted = false
              and i.returnable = true and i.returned_at is null
              and (${site}::uuid is null or i.site_id = ${site}::uuid)
          ), 0)::text as out
        from inventory_items ii
        where ii.is_deleted = false
        order by lower(ii.name)
      `),
    );
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      unit: String(row.unit),
      note: row.note === null ? null : String(row.note),
      hasPhoto: row.has_photo === true || row.has_photo === "t",
      stock: fromHundredths(toHundredths(String(row.arrived)) - toHundredths(String(row.gone))),
      out: fromHundredths(toHundredths(String(row.out))),
    }));
  }

  async createItem(input: SaveInventoryItem, actorId: string): Promise<{ id: string }> {
    const [row] = await writing(() =>
      this.db
        .insert(inventoryItems)
        .values({ name: input.name, unit: input.unit, note: input.note, photoKey: input.photoKey ?? null, ...createdBy(actorId) })
        .returning({ id: inventoryItems.id }),
    );
    return row!;
  }

  async updateItem(id: string, input: SaveInventoryItem, actorId: string): Promise<{ id: string }> {
    const [row] = await writing(() =>
      this.db
        .update(inventoryItems)
        .set({
          name: input.name,
          unit: input.unit,
          note: input.note,
          ...(input.photoKey === undefined ? {} : { photoKey: input.photoKey }),
          ...updatedBy(actorId),
        })
        .where(and(eq(inventoryItems.id, id), eq(inventoryItems.isDeleted, false)))
        .returning({ id: inventoryItems.id }),
    );
    if (!row) throw new NotFoundException("Inventory item not found");
    return row;
  }

  /** Refused while any of it is out on a returnable issue: it would never be received back. */
  async removeItem(id: string, actorId: string): Promise<void> {
    const [out] = rawRows<{ n: number }>(
      await this.db.execute(sql`
        select count(*)::int as n from inventory_issues
        where inventory_item_id = ${id} and is_deleted = false and returnable = true and returned_at is null
      `),
    );
    if ((out?.n ?? 0) > 0) throw new ConflictException("Some of this item is out and not received back. Receive it first.");
    const [row] = await this.db
      .update(inventoryItems)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(inventoryItems.id, id), eq(inventoryItems.isDeleted, false)))
      .returning({ id: inventoryItems.id });
    if (!row) throw new NotFoundException("Inventory item not found");
  }

  async itemPhotoKey(id: string): Promise<string | null> {
    const [row] = rawRows<{ found: boolean | string; key: string | null }>(
      await this.db.execute(sql`
        select exists(select 1 from inventory_items where id = ${id}::uuid) as found, ${itemPhotoKey(sql`${id}::uuid`)} as key
      `),
    );
    if (!row || !(row.found === true || row.found === "t")) throw new NotFoundException("Inventory item not found");
    return row.key;
  }

  async arrivalPhotoKey(id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ key: inventoryInward.photoKey })
      .from(inventoryInward)
      .where(and(eq(inventoryInward.id, id), eq(inventoryInward.isDeleted, false)));
    if (!row) throw new NotFoundException("Inventory record not found");
    return row.key;
  }

  /** The photo of piece `n` (from 0) of an arrival. */
  async arrivalPiecePhotoKey(id: string, n: number): Promise<string | null> {
    const [row] = await this.db
      .select({ pieces: inventoryInward.pieces })
      .from(inventoryInward)
      .where(and(eq(inventoryInward.id, id), eq(inventoryInward.isDeleted, false)));
    if (!row) throw new NotFoundException("Inventory record not found");
    return row.pieces[n]?.photoKey ?? null;
  }

  // ---- purchase item stock -------------------------------------------------------

  /** The purchase items a site has received on its inward challans, with what is in stock. */
  async purchaseStock(siteId: string): Promise<PurchaseStockRow[]> {
    const rows = rawRows<Record<string, unknown>>(
      await this.db.execute(sql`
        with received as (
          select item_id, sum(quantity) as q from inward_challans
          where is_deleted = false and site_id = ${siteId}::uuid and item_id is not null
          group by item_id
        ),
        issued as (
          select item_id,
            sum(quantity - coalesce(returned_quantity, 0)) as gone,
            sum(case when returnable and returned_at is null then quantity else 0 end) as out
          from inventory_issues
          where source = 'purchase' and is_deleted = false and site_id = ${siteId}::uuid
          group by item_id
        )
        select it.id, it.name, u.name as unit_name,
          coalesce(r.q, 0)::text as received, coalesce(x.gone, 0)::text as gone, coalesce(x.out, 0)::text as out
        from items it
        left join units u on u.id = it.unit_id
        left join received r on r.item_id = it.id
        left join issued x on x.item_id = it.id
        where r.item_id is not null or x.item_id is not null
        order by lower(it.name)
      `),
    );
    return rows.map((row) => ({
      itemId: String(row.id),
      itemName: String(row.name),
      unitName: row.unit_name === null ? null : String(row.unit_name),
      received: fromHundredths(toHundredths(String(row.received))),
      stock: fromHundredths(toHundredths(String(row.received)) - toHundredths(String(row.gone))),
      out: fromHundredths(toHundredths(String(row.out))),
    }));
  }

  // ---- agencies and their persons ------------------------------------------------

  /** The agencies to issue to, each with its contacts, the main one first. */
  async agencies(): Promise<{ id: string; name: string; contacts: { id: string; name: string; mobile: string | null }[] }[]> {
    const [list, contacts] = await Promise.all([
      this.db
        .select({ id: agencies.id, name: agencies.name })
        .from(agencies)
        .where(and(eq(agencies.isDeleted, false), eq(agencies.isActive, true)))
        .orderBy(asc(agencies.name)),
      this.db
        .select({ id: agencyContacts.id, agencyId: agencyContacts.agencyId, name: agencyContacts.name, mobile: agencyContacts.mobile })
        .from(agencyContacts)
        .orderBy(asc(agencyContacts.lineNumber)),
    ]);
    return list.map((agency) => ({
      ...agency,
      contacts: contacts.filter((contact) => contact.agencyId === agency.id).map(({ agencyId: _ignored, ...contact }) => contact),
    }));
  }

  async persons(agencyId: string): Promise<AgencyPerson[]> {
    const rows = await this.db
      .select({
        id: agencyPersons.id,
        agencyId: agencyPersons.agencyId,
        name: agencyPersons.name,
        mobile: agencyPersons.mobile,
        photoKey: agencyPersons.photoKey,
      })
      .from(agencyPersons)
      .where(and(eq(agencyPersons.agencyId, agencyId), eq(agencyPersons.isDeleted, false)))
      .orderBy(asc(agencyPersons.name));
    return rows.map(({ photoKey, ...row }) => ({ ...row, hasPhoto: photoKey !== null }));
  }

  async createPerson(input: CreateAgencyPerson, actorId: string): Promise<AgencyPerson> {
    const [agency] = await this.db.select({ id: agencies.id }).from(agencies).where(and(eq(agencies.id, input.agencyId), eq(agencies.isDeleted, false)));
    if (!agency) throw new NotFoundException("Agency not found");
    const [row] = await this.db
      .insert(agencyPersons)
      .values({ agencyId: input.agencyId, name: input.name, mobile: input.mobile, photoKey: input.photoKey ?? null, createdBy: actorId })
      .returning();
    return { id: row!.id, agencyId: row!.agencyId, name: row!.name, mobile: row!.mobile, hasPhoto: row!.photoKey !== null };
  }

  async personPhotoKey(id: string): Promise<string | null> {
    const [row] = await this.db.select({ key: agencyPersons.photoKey }).from(agencyPersons).where(eq(agencyPersons.id, id));
    if (!row) throw new NotFoundException("Person not found");
    return row.key;
  }

  // ---- issues --------------------------------------------------------------------

  async issues(query: InventoryIssueQuery): Promise<IssueOut[]> {
    const where = [sql`i.is_deleted = false`];
    if (query.siteId) where.push(sql`i.site_id = ${query.siteId}::uuid`);
    if (query.status === "out") where.push(sql`i.returnable = true and i.returned_at is null`);
    if (query.status === "returned") where.push(sql`i.returned_at is not null`);
    if (query.status === "given") where.push(sql`i.returnable = false`);
    // By the day in India, where the items are handed over.
    if (query.fromDate) where.push(sql`(i.issued_at at time zone 'Asia/Kolkata')::date >= ${query.fromDate}::date`);
    if (query.toDate) where.push(sql`(i.issued_at at time zone 'Asia/Kolkata')::date <= ${query.toDate}::date`);
    const rows = rawRows<Record<string, unknown>>(
      await this.db.execute(sql`
        select i.*, s.name as site_name, a.name as agency_name,
          c.name as contact_name, c.mobile as contact_mobile,
          p.name as person_name, p.mobile as person_mobile, p.photo_key is not null as person_has_photo,
          i.source = 'inventory' and ${itemPhotoKey(sql`i.inventory_item_id`)} is not null as item_has_photo,
          i.quantity::text as quantity_text, i.returned_quantity::text as returned_text
        from inventory_issues i
        join agencies a on a.id = i.agency_id
        join agency_persons p on p.id = i.person_id
        left join agency_contacts c on c.id = i.agency_contact_id
        left join sites s on s.id = i.site_id
        where ${sql.join(where, sql` and `)}
        order by i.issued_at desc, i.id
        limit ${query.limit}
      `),
    );
    return rows.map((row) => this.toIssue(row));
  }

  private toIssue(row: Record<string, unknown>): IssueOut {
    const text = (key: string) => (row[key] === null || row[key] === undefined ? null : String(row[key]));
    const returnable = row.returnable === true || row.returnable === "t";
    const returnedAt = iso(row.returned_at);
    const status: IssueStatus = !returnable ? "given" : returnedAt ? "returned" : "out";
    return {
      id: String(row.id),
      siteId: text("site_id"),
      siteName: text("site_name"),
      source: row.source === "purchase" ? "purchase" : "inventory",
      inventoryItemId: text("inventory_item_id"),
      itemId: text("item_id"),
      itemName: String(row.item_name),
      unitName: text("unit_name"),
      quantity: fromHundredths(toHundredths(String(row.quantity_text))),
      returnable,
      agencyId: String(row.agency_id),
      agencyName: String(row.agency_name),
      contactName: text("contact_name"),
      contactMobile: text("contact_mobile"),
      personId: String(row.person_id),
      personName: String(row.person_name),
      personMobile: text("person_mobile"),
      personHasPhoto: row.person_has_photo === true || row.person_has_photo === "t",
      itemHasPhoto: row.item_has_photo === true || row.item_has_photo === "t",
      pieces: ((typeof row.pieces === "string" ? JSON.parse(row.pieces) : (row.pieces ?? [])) as { arrivalId: string; n: number; tag: string }[]).map(
        (piece) => ({ arrivalId: piece.arrivalId, n: piece.n, tag: piece.tag }),
      ),
      issuedAt: iso(row.issued_at)!,
      note: text("note"),
      returnedQuantity: row.returned_text === null ? null : fromHundredths(toHundredths(String(row.returned_text))),
      returnedAt,
      returnNote: text("return_note"),
      status,
    };
  }

  private async issueById(id: string): Promise<IssueOut> {
    const rows = rawRows<Record<string, unknown>>(
      await this.db.execute(sql`
        select i.*, s.name as site_name, a.name as agency_name,
          c.name as contact_name, c.mobile as contact_mobile,
          p.name as person_name, p.mobile as person_mobile, p.photo_key is not null as person_has_photo,
          i.source = 'inventory' and ${itemPhotoKey(sql`i.inventory_item_id`)} is not null as item_has_photo,
          i.quantity::text as quantity_text, i.returned_quantity::text as returned_text
        from inventory_issues i
        join agencies a on a.id = i.agency_id
        join agency_persons p on p.id = i.person_id
        left join agency_contacts c on c.id = i.agency_contact_id
        left join sites s on s.id = i.site_id
        where i.id = ${id}::uuid and i.is_deleted = false
      `),
    );
    if (!rows[0]) throw new NotFoundException("Issue not found");
    return this.toIssue(rows[0]);
  }

  /**
   * Gives an item out. Refused beyond what is in stock at the site, worked out
   * inside the transaction with the item's row locked, so two people issuing the
   * last drill at once cannot both have it.
   */
  async issue(input: CreateInventoryIssue, actorId: string): Promise<IssueOut> {
    const id = await this.db.transaction(async (tx) => {
      const db = tx as unknown as Database;
      let itemName: string;
      let unitName: string | null;
      let stock: bigint;
      if (input.source === "inventory") {
        const [item] = rawRows<{ name: string; unit: string }>(
          await db.execute(sql`select name, unit from inventory_items where id = ${input.inventoryItemId!}::uuid and is_deleted = false for update`),
        );
        if (!item) throw new NotFoundException("Inventory item not found");
        itemName = item.name;
        unitName = item.unit;
        const [row] = rawRows<{ arrived: string; gone: string }>(
          await db.execute(sql`
            select
              coalesce((select sum(quantity) from inventory_inward where inventory_item_id = ${input.inventoryItemId!}::uuid
                and is_deleted = false and site_id = ${input.siteId}::uuid), 0)::text as arrived,
              coalesce((select sum(quantity - coalesce(returned_quantity, 0)) from inventory_issues
                where source = 'inventory' and inventory_item_id = ${input.inventoryItemId!}::uuid
                and is_deleted = false and site_id = ${input.siteId}::uuid), 0)::text as gone
          `),
        );
        stock = toHundredths(row!.arrived) - toHundredths(row!.gone);
      } else {
        const [item] = rawRows<{ name: string; unit_name: string | null }>(
          await db.execute(sql`
            select it.name, u.name as unit_name from items it left join units u on u.id = it.unit_id
            where it.id = ${input.itemId!}::uuid for update of it
          `),
        );
        if (!item) throw new NotFoundException("Item not found");
        itemName = item.name;
        unitName = item.unit_name;
        const [row] = rawRows<{ received: string; gone: string }>(
          await db.execute(sql`
            select
              coalesce((select sum(quantity) from inward_challans where item_id = ${input.itemId!}::uuid
                and is_deleted = false and site_id = ${input.siteId}::uuid), 0)::text as received,
              coalesce((select sum(quantity - coalesce(returned_quantity, 0)) from inventory_issues
                where source = 'purchase' and item_id = ${input.itemId!}::uuid
                and is_deleted = false and site_id = ${input.siteId}::uuid), 0)::text as gone
          `),
        );
        stock = toHundredths(row!.received) - toHundredths(row!.gone);
      }
      const pieces = input.source === "inventory" ? await this.checkPieces(db, input) : [];
      if (toHundredths(input.quantity) > stock) {
        throw new ConflictException(
          `Only ${fromHundredths(stock < 0n ? 0n : stock)} ${unitName ?? ""} of ${itemName} is in stock at this site.`.replace(/\s+/g, " "),
        );
      }

      const [person] = await db
        .select({ agencyId: agencyPersons.agencyId })
        .from(agencyPersons)
        .where(and(eq(agencyPersons.id, input.personId), eq(agencyPersons.isDeleted, false)));
      if (!person || person.agencyId !== input.agencyId) throw new BadRequestException("Choose a person of this agency.");
      if (input.agencyContactId) {
        const [contact] = await db.select({ agencyId: agencyContacts.agencyId }).from(agencyContacts).where(eq(agencyContacts.id, input.agencyContactId));
        if (!contact || contact.agencyId !== input.agencyId) throw new BadRequestException("Choose a contact of this agency.");
      }

      const [created] = await db
        .insert(inventoryIssues)
        .values({
          siteId: input.siteId,
          source: input.source,
          inventoryItemId: input.source === "inventory" ? input.inventoryItemId! : null,
          itemId: input.source === "purchase" ? input.itemId! : null,
          itemName,
          unitName,
          quantity: input.quantity,
          returnable: input.returnable,
          agencyId: input.agencyId,
          agencyContactId: input.agencyContactId ?? null,
          personId: input.personId,
          note: input.note,
          pieces,
          ...createdBy(actorId),
        })
        .returning({ id: inventoryIssues.id });
      return created!.id;
    });
    return this.issueById(id);
  }

  /**
   * THE PIECES CHOSEN (client, 2 Nov 2026): each must be a piece of an arrival of
   * this item at this site, chosen once, and not out on another issue. Read inside
   * the issue's transaction, after the item's row is locked, so two people cannot
   * hand out the same board at once.
   */
  private async checkPieces(db: Database, input: CreateInventoryIssue): Promise<{ arrivalId: string; n: number; tag: string }[]> {
    if (input.pieces.length === 0) return [];
    const keys = input.pieces.map((piece) => `${piece.arrivalId}:${piece.n}`);
    if (new Set(keys).size !== keys.length) throw new BadRequestException("A piece is chosen twice.");
    const ids = [...new Set(input.pieces.map((piece) => piece.arrivalId))];
    const arrivals = await db
      .select({ id: inventoryInward.id, pieces: inventoryInward.pieces, siteId: inventoryInward.siteId, itemId: inventoryInward.inventoryItemId })
      .from(inventoryInward)
      .where(and(eq(inventoryInward.isDeleted, false), sql`${inventoryInward.id} in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`));
    const byId = new Map(arrivals.map((arrival) => [arrival.id, arrival]));
    const out = rawRows<{ key: string }>(
      await db.execute(sql`
        select (p->>'arrivalId') || ':' || (p->>'n') as key
        from inventory_issues i cross join lateral jsonb_array_elements(i.pieces) p
        where i.is_deleted = false and i.returned_at is null
          and p->>'arrivalId' in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `),
    ).map((row) => row.key);
    return input.pieces.map((piece) => {
      const arrival = byId.get(piece.arrivalId);
      if (!arrival || arrival.itemId !== input.inventoryItemId || arrival.siteId !== input.siteId) {
        throw new BadRequestException("A chosen piece is not of this item at this site.");
      }
      const stored = arrival.pieces[piece.n];
      if (!stored) throw new BadRequestException("A chosen piece is not on its arrival.");
      const tag = stored.tag || `Piece ${piece.n + 1}`;
      if (out.includes(`${piece.arrivalId}:${piece.n}`)) throw new ConflictException(`${tag} is already issued.`);
      return { arrivalId: piece.arrivalId, n: piece.n, tag: stored.tag };
    });
  }

  /** What came back of a returnable issue goes back into the stock it left. */
  async receive(id: string, input: ReceiveInventoryIssue, actorId: string): Promise<IssueOut> {
    const current = await this.issueById(id);
    if (!current.returnable) throw new ConflictException("This was given for good; there is nothing to receive back.");
    if (current.returnedAt) throw new ConflictException("This has already been received back.");
    if (toHundredths(input.quantity) > toHundredths(current.quantity)) {
      throw new BadRequestException(`Only ${current.quantity} was given out.`);
    }
    await this.db
      .update(inventoryIssues)
      .set({ returnedQuantity: input.quantity, returnedAt: new Date(), returnedBy: actorId, returnNote: input.note, ...updatedBy(actorId) })
      .where(and(eq(inventoryIssues.id, id), eq(inventoryIssues.isDeleted, false), sql`${inventoryIssues.returnedAt} is null`));
    return this.issueById(id);
  }

  /** A mistaken issue taken off: what it took out of stock is back. */
  async removeIssue(id: string, actorId: string): Promise<void> {
    const [row] = await this.db
      .update(inventoryIssues)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(inventoryIssues.id, id), eq(inventoryIssues.isDeleted, false)))
      .returning({ id: inventoryIssues.id });
    if (!row) throw new NotFoundException("Issue not found");
  }

  /** Units, for an inventory item's unit picker. */
  async unitNames(): Promise<string[]> {
    const rows = await this.db.select({ name: units.name }).from(units).orderBy(asc(units.name));
    return [...new Set(rows.map((row) => row.name))];
  }
}

