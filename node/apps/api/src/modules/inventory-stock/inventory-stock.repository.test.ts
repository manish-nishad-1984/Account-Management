import { beforeEach, describe, expect, it } from "vitest";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { createInventoryInwardSchema, createInventoryIssueSchema } from "@accountmanagement/contracts";
import { InventoryStockRepository } from "./inventory-stock.repository";
import { InventoryInwardRepository } from "../inventory-inward/inventory-inward.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

/** Stock, issue and receive back (client, 26 Oct 2026). */
describe("InventoryStockRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: InventoryStockRepository;
  let siteId: string;
  let otherSiteId: string;
  let agencyId: string;
  let contactId: string;
  let personId: string;
  let drillId: string;
  let cementId: string;

  const issue = (overrides: Record<string, unknown>) =>
    repo.issue(
      createInventoryIssueSchema.parse({ siteId, source: "inventory", inventoryItemId: drillId, quantity: "1", returnable: true, agencyId, agencyContactId: contactId, personId, ...overrides }),
      ACTOR,
    );
  const stockOf = async (id: string, site = siteId) => (await repo.items(site)).find((row) => row.id === id)!;

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new InventoryStockRepository(db);
    const [a, b] = await db.insert(schema.sites).values([{ name: "Akwada", isActive: true }, { name: "Surat", isActive: true }]).returning();
    siteId = a!.id;
    otherSiteId = b!.id;
    await db.insert(schema.countries).values({ id: 1, name: "India" });
    await db.insert(schema.states).values({ id: 24, name: "Gujarat", countryId: 1 });
    await db.insert(schema.cities).values({ id: 7, name: "Surat", stateId: 24 });
    const [agency] = await db.insert(schema.agencies).values({ name: "RAM SHUTTERING", stateId: 24, cityId: 7 }).returning();
    agencyId = agency!.id;
    const [contact] = await db.insert(schema.agencyContacts).values({ agencyId, name: "Ramesh", mobile: "9876543210", lineNumber: 1 }).returning();
    contactId = contact!.id;
    personId = (await repo.createPerson({ agencyId, name: "Suresh", mobile: "9000000001", photoKey: null }, ACTOR)).id;

    // Five drills arrive at Akwada through New Arrival.
    const arrivals = new InventoryInwardRepository(db);
    const arrival = await arrivals.create(createInventoryInwardSchema.parse({ siteId, newItemName: "Drill Machine", quantity: "5" }), ACTOR);
    drillId = arrival.inventoryItemId!;

    // Ten bags of cement came on Akwada's inward challans.
    const [unit] = await db.insert(schema.units).values({ name: "Bag" }).returning();
    const [cement] = await db.insert(schema.items).values({ name: "Cement", unitId: unit!.id, pricePerUnit: "400" }).returning();
    cementId = cement!.id;
    await db.insert(schema.inwardChallans).values({ siteId, itemId: cementId, unitId: unit!.id, quantity: "10" });
  });

  it("takes a returnable issue out of stock, and puts back what is received", async () => {
    const out = await issue({ quantity: "3" });
    expect(out).toMatchObject({ status: "out", itemName: "Drill Machine", unitName: "Nos", personName: "Suresh", contactMobile: "9876543210" });
    expect(await stockOf(drillId)).toMatchObject({ stock: "2.00", out: "3.00" });
    // Another site's stock is its own.
    expect(await stockOf(drillId, otherSiteId)).toMatchObject({ stock: "0.00" });

    const waiting = await repo.issues({ status: "out", limit: 100 });
    expect(waiting.map((row) => row.id)).toEqual([out.id]);

    // Two of the three come back in the evening; one does not.
    const back = await repo.receive(out.id, { quantity: "2", note: "one broken" }, ACTOR);
    expect(back).toMatchObject({ status: "returned", returnedQuantity: "2.00" });
    expect(await stockOf(drillId)).toMatchObject({ stock: "4.00", out: "0.00" });
    expect(await repo.issues({ status: "out", limit: 100 })).toEqual([]);
    await expect(repo.receive(out.id, { quantity: "1", note: null }, ACTOR)).rejects.toBeInstanceOf(ConflictException);
  });

  // Client, 30 Oct 2026: the item shows as a picture in the stock and the issues.
  it("gives an item without a photo of its own the latest photo of its arrivals", async () => {
    const PIECE = "inventory/00000000-0000-4000-8000-000000000001.jpg";
    expect(await stockOf(drillId)).toMatchObject({ hasPhoto: false });
    expect(await repo.itemPhotoKey(drillId)).toBeNull();

    const arrivals = new InventoryInwardRepository(db);
    await arrivals.create(
      createInventoryInwardSchema.parse({ siteId, inventoryItemId: drillId, quantity: "2", pieces: [{ tag: "D-1" }, { tag: "D-2", photoKey: PIECE }] }),
      ACTOR,
    );
    expect(await stockOf(drillId)).toMatchObject({ hasPhoto: true });
    expect(await repo.itemPhotoKey(drillId)).toBe(PIECE);

    const out = await issue({ quantity: "1" });
    expect(out.itemHasPhoto).toBe(true);
    expect((await repo.issues({ limit: 100 }))[0]).toMatchObject({ itemHasPhoto: true });

    // The item's own photo, once it has one, is the one shown.
    const OWN = "inventory/00000000-0000-4000-8000-000000000002.png";
    await db.update(schema.inventoryItems).set({ photoKey: OWN });
    expect(await repo.itemPhotoKey(drillId)).toBe(OWN);
  });

  it("refuses more than is in stock at the site", async () => {
    await expect(issue({ quantity: "6" })).rejects.toThrow("Only 5.00 Nos of Drill Machine is in stock at this site.");
    await expect(issue({ siteId: otherSiteId })).rejects.toBeInstanceOf(ConflictException);
  });

  it("issues a purchase item from its own stock, the site's challans, and a non-returnable one is gone for good", async () => {
    const given = await issue({ source: "purchase", inventoryItemId: null, itemId: cementId, quantity: "4", returnable: false });
    expect(given).toMatchObject({ status: "given", itemName: "Cement", unitName: "Bag" });
    expect(await repo.purchaseStock(siteId)).toEqual([
      { itemId: cementId, itemName: "Cement", unitName: "Bag", received: "10.00", stock: "6.00", out: "0.00" },
    ]);
    await expect(repo.receive(given.id, { quantity: "4", note: null }, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    // The drills are untouched by it.
    expect(await stockOf(drillId)).toMatchObject({ stock: "5.00" });
  });

  it("gives only to a person of the agency chosen", async () => {
    await db.insert(schema.agencies).values({ name: "OTHER", stateId: 24, cityId: 7 });
    const [other] = (await repo.agencies()).filter((row) => row.name === "OTHER");
    await expect(issue({ agencyId: other!.id, agencyContactId: null })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("puts back what a deleted issue took out", async () => {
    const out = await issue({ quantity: "5" });
    expect(await stockOf(drillId)).toMatchObject({ stock: "0.00" });
    await repo.removeIssue(out.id, ACTOR);
    expect(await stockOf(drillId)).toMatchObject({ stock: "5.00" });
  });
});
