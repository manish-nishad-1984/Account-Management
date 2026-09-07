import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { eq, isNull } from "drizzle-orm";
import {
  createInventoryInwardSchema,
  listQuerySchema,
  type CreateInventoryInward,
} from "@accountmanagement/contracts";
import { InventoryInwardRepository } from "./inventory-inward.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

describe("InventoryInwardRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: InventoryInwardRepository;
  let siteId: string;
  let otherSiteId: string;
  let itemId: string;
  let otherItemId: string;
  let unitId: number;

  const input = (overrides: Record<string, unknown> = {}): CreateInventoryInward =>
    createInventoryInwardSchema.parse({ itemId, unitId, quantity: "10.00", ...overrides });

  /** A row as the ETL leaves it: no site, and approved, because the source is. */
  const imported = (overrides: Record<string, unknown> = {}) => ({
    siteId: null,
    itemId,
    unitId,
    quantity: "1.00",
    isApproved: true,
    createdBy: ACTOR,
    ...overrides,
  });

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new InventoryInwardRepository(db);

    const [unit] = await db
      .insert(schema.units)
      .values({ name: "Nos" })
      .returning({ id: schema.units.id });
    unitId = unit!.id;

    const insertedItems = await db
      .insert(schema.items)
      .values([
        { name: "HELMET YELLOW LABOUR", unitId, pricePerUnit: "120.00" },
        { name: "GI WIRE CUTTING 12 INCH", unitId, pricePerUnit: "340.00" },
      ])
      .returning({ id: schema.items.id, name: schema.items.name });
    itemId = insertedItems[0]!.id;
    otherItemId = insertedItems[1]!.id;

    const insertedSites = await db
      .insert(schema.sites)
      .values([{ name: "Akwada Lake Front" }, { name: "Riverfront Phase 2" }])
      .returning({ id: schema.sites.id, name: schema.sites.name });
    siteId = insertedSites[0]!.id;
    otherSiteId = insertedSites[1]!.id;
  });

  describe("creating an arrival", () => {
    /**
     * `InsertInventoryDetails` hard-codes `IsApproved = true`, so every arrival
     * in production posted already approved and the Approve column has never
     * gated anything. Flagged for sign-off — this is the departure.
     */
    it("creates it unapproved, where the source creates it approved", async () => {
      const created = await repo.create(input(), ACTOR);
      expect(created.isApproved).toBe(false);
    });

    it("records the site it was given", async () => {
      const created = await repo.create(input({ siteId }), ACTOR);
      expect(created.siteId).toBe(siteId);
    });

    it("accepts no site at all, because the old form had no site field", async () => {
      const created = await repo.create(input(), ACTOR);
      expect(created.siteId).toBeNull();
    });

    it("keeps the quantity as the decimal string it was given", async () => {
      const created = await repo.create(input({ quantity: "1000.50" }), ACTOR);
      expect(created.quantity).toBe("1000.50");
    });

    /** The source stores a name snapshot, so this one does too — see the schema. */
    it("snapshots the item name, which nothing then reads", async () => {
      const created = await repo.create(input(), ACTOR);
      const [row] = await db
        .select({ itemName: schema.inventoryInward.itemName })
        .from(schema.inventoryInward)
        .where(eq(schema.inventoryInward.id, created.id));
      expect(row!.itemName).toBe("HELMET YELLOW LABOUR");
    });

    it("refuses an item that does not exist", async () => {
      await expect(
        repo.create(input({ itemId: "99999999-9999-9999-9999-999999999999" }), ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("the list", () => {
    it("reads the item's CURRENT name, not the snapshot taken when it was keyed", async () => {
      const created = await repo.create(input(), ACTOR);
      await db
        .update(schema.items)
        .set({ name: "HELMET YELLOW LABOUR (ISI)" })
        .where(eq(schema.items.id, itemId));

      const page = await repo.list(query());
      const row = page.rows.find((r) => r.id === created.id)!;

      // The source projects `i.ItemName` in the list and `a.Item` in the edit
      // form, so renaming an item makes the two screens disagree. One name.
      expect(row.itemName).toBe("HELMET YELLOW LABOUR (ISI)");
    });

    it("names the site when there is one", async () => {
      await repo.create(input({ siteId }), ACTOR);
      const page = await repo.list(query());
      expect(page.rows[0]!.siteName).toBe("Akwada Lake Front");
    });

    /**
     * The one that matters. `InventoryInward.SiteId` is never written by the
     * .NET application, so every imported row has none — and an INNER JOIN on
     * sites would return NOTHING for the whole table.
     */
    it("returns a row with no site at all", async () => {
      await db.insert(schema.inventoryInward).values(imported());

      const page = await repo.list(query());

      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]!.siteId).toBeNull();
      expect(page.rows[0]!.siteName).toBeNull();
    });

    it("hides soft-deleted rows", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      expect(await repo.total()).toBe(0);
      expect((await repo.list(query())).rows).toHaveLength(0);
    });

    it("searches the item name, the unit and the free text", async () => {
      await repo.create(input({ itemId: otherItemId, details: "TO RAJAOUL" }), ACTOR);
      await repo.create(input(), ACTOR);

      expect((await repo.list(query({ search: "GI WIRE" }))).rows).toHaveLength(1);
      expect((await repo.list(query({ search: "RAJAOUL" }))).rows).toHaveLength(1);
      expect((await repo.list(query({ search: "Nos" }))).rows).toHaveLength(2);
    });

    it("walks every row exactly once across pages", async () => {
      for (let i = 0; i < 13; i++) {
        await repo.create(input({ quantity: String(i + 1) + ".00" }), ACTOR);
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await repo.list(query({ limit: 5, cursor }));
        seen.push(...page.rows.map((r) => r.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      expect(seen).toHaveLength(13);
      expect(new Set(seen).size).toBe(13);
    });
  });

  /**
   * A site filter that excluded unallocated rows would show an empty screen to
   * every user under every scope, because every imported row is unallocated.
   */
  describe("the site filter", () => {
    beforeEach(async () => {
      await db.insert(schema.inventoryInward).values([
        imported({ siteId, quantity: "1.00" }),
        imported({ siteId: otherSiteId, quantity: "2.00" }),
        imported({ quantity: "3.00" }),
      ]);
    });

    it("returns this site's rows AND the rows that belong to no site", async () => {
      const page = await repo.list(query(), { siteId });
      expect(page.rows.map((r) => r.quantity).sort()).toEqual(["1.00", "3.00"]);
    });

    it("excludes another site's rows", async () => {
      const page = await repo.list(query(), { siteId });
      expect(page.rows.map((r) => r.quantity)).not.toContain("2.00");
    });

    it("counts the same set it lists", async () => {
      expect(await repo.total(undefined, { siteId })).toBe(2);
    });

    it("returns everything when no site is chosen", async () => {
      expect(await repo.total()).toBe(3);
    });

    it("reports how many rows are still unallocated", async () => {
      expect(await repo.unallocatedCount()).toBe(1);
    });

    it("does not count a soft-deleted row as unallocated work outstanding", async () => {
      const [row] = await db
        .select({ id: schema.inventoryInward.id })
        .from(schema.inventoryInward)
        .where(isNull(schema.inventoryInward.siteId));
      await repo.remove(row!.id, ACTOR);

      expect(await repo.unallocatedCount()).toBe(0);
    });
  });

  describe("approval", () => {
    it("sets the value it is told, rather than flipping what is there", async () => {
      const created = await repo.create(input(), ACTOR);

      const approved = await repo.setApproval(created.id, true, ACTOR);
      expect(approved.isApproved).toBe(true);

      // Repeating it is a no-op, where the source's toggle would undo it.
      const again = await repo.setApproval(created.id, true, ACTOR);
      expect(again.isApproved).toBe(true);
    });

    it("filters to the pending queue", async () => {
      const a = await repo.create(input(), ACTOR);
      await repo.create(input(), ACTOR);
      await repo.setApproval(a.id, true, ACTOR);

      expect((await repo.list(query(), { isApproved: false })).rows).toHaveLength(1);
      expect(await repo.total(undefined, { isApproved: true })).toBe(1);
    });

    it("refuses to approve a deleted row", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      await expect(repo.setApproval(created.id, true, ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  /**
   * `DeleteInventoryDetails` sets `IsDeleted = true` and then calls `Remove()`
   * on the same entity, so the row leaves the table and the flag write goes
   * nowhere. The list filters on the flag as though it were a soft delete, which
   * is why nobody has noticed the delete is unrecoverable.
   */
  describe("deleting", () => {
    it("keeps the row, where the source removes it from the table", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      const [row] = await db
        .select({ isDeleted: schema.inventoryInward.isDeleted })
        .from(schema.inventoryInward)
        .where(eq(schema.inventoryInward.id, created.id));

      expect(row).toBeDefined();
      expect(row!.isDeleted).toBe(true);
    });

    it("refuses a second delete rather than reporting success twice", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      await expect(repo.remove(created.id, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("updating", () => {
    it("changes the quantity without touching the site", async () => {
      const created = await repo.create(input({ siteId }), ACTOR);
      const updated = await repo.update(created.id, { quantity: "42.00" }, ACTOR);

      expect(updated.quantity).toBe("42.00");
      expect(updated.siteId).toBe(siteId);
    });

    it("clears the date when asked to, rather than ignoring the null", async () => {
      const created = await repo.create(input({ documentDate: "2026-01-04" }), ACTOR);
      expect(created.documentDate).not.toBeNull();

      const updated = await repo.update(created.id, { documentDate: null }, ACTOR);
      expect(updated.documentDate).toBeNull();
    });

    it("refuses an id that is not there", async () => {
      await expect(
        repo.update("99999999-9999-9999-9999-999999999999", { quantity: "1.00" }, ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
