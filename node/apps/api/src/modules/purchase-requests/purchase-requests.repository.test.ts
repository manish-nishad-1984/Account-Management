import { beforeEach, describe, expect, it } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  createPurchaseRequestSchema,
  listQuerySchema,
  type CreatePurchaseRequest,
} from "@accountmanagement/contracts";
import { financialYear } from "@accountmanagement/domain";
import { PurchaseRequestsRepository } from "./purchase-requests.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";
const OTHER_ACTOR = "22222222-2222-2222-2222-222222222222";

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

/** The financial year the numbering uses, as production computes it today. */
const FY = financialYear.format(financialYear.currentAsProduced(new Date()));

describe("PurchaseRequestsRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: PurchaseRequestsRepository;
  let siteId: string;
  let inactiveSiteId: string;
  let itemId: string;
  let unitId: number;

  const input = (overrides: Record<string, unknown> = {}): CreatePurchaseRequest =>
    createPurchaseRequestSchema.parse({
      siteId,
      itemId,
      unitId,
      quantity: "10.00",
      ...overrides,
    });

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new PurchaseRequestsRepository(db);

    const [unit] = await db
      .insert(schema.units)
      .values({ name: "Bag" })
      .returning({ id: schema.units.id });
    unitId = unit!.id;

    const [item] = await db
      .insert(schema.items)
      .values({ name: "OPC 53 Grade Cement", unitId, pricePerUnit: "395.00" })
      .returning({ id: schema.items.id });
    itemId = item!.id;

    const inserted = await db
      .insert(schema.sites)
      .values([
        { name: "Akwada Lake Front", isActive: true },
        { name: "Closed Depot", isActive: false },
      ])
      .returning({ id: schema.sites.id, isActive: schema.sites.isActive });

    siteId = inserted.find((row) => row.isActive)!.id;
    inactiveSiteId = inserted.find((row) => !row.isActive)!.id;
  });

  describe("document numbering", () => {
    it("issues the first number of the financial year as PR/<fy>/001", async () => {
      const created = await repo.create(input(), ACTOR);
      expect(created.prNo).toBe(`PR/${FY}/001`);
    });

    it("increments, zero-padded to three digits", async () => {
      await repo.create(input(), ACTOR);
      const second = await repo.create(input(), ACTOR);
      expect(second.prNo).toBe(`PR/${FY}/002`);
    });

    /**
     * THE REGRESSION THAT MATTERS.
     *
     * `PurchaseRequestRepo.CheckPRNo()` parsed the sequence with
     * `int.Parse(LastPr.PrNo.Substring(11))`. "PR/25-26/001" is twelve characters,
     * so index 11 is the last character alone. From "010" it reads "0", adds one,
     * and issues "001" again — the eleventh request of any year collides with the
     * first. Fifteen here is enough to cross that boundary twice.
     */
    it("stays unique past the tenth request, where the source repeats itself", async () => {
      const numbers: string[] = [];
      for (let i = 0; i < 15; i += 1) {
        numbers.push((await repo.create(input(), ACTOR)).prNo);
      }

      expect(new Set(numbers).size).toBe(15);
      expect(numbers[9]).toBe(`PR/${FY}/010`);
      expect(numbers[10]).toBe(`PR/${FY}/011`);
      expect(numbers[14]).toBe(`PR/${FY}/015`);
    });

    it("keeps one counter row per document type and year", async () => {
      await repo.create(input(), ACTOR);
      await repo.create(input(), ACTOR);

      const counters = await db.select().from(schema.documentCounters);
      expect(counters).toHaveLength(1);
      expect(counters[0]!.documentType).toBe("purchase_request");
      expect(counters[0]!.financialYear).toBe(FY);
      // Two issued, so the next one takes 3.
      expect(counters[0]!.nextValue).toBe(3);
    });

    /**
     * A number is spent only if the row it belongs to is written. The insert and
     * the increment share one transaction, so a rejected insert rolls both back.
     */
    it("does not burn a number when the insert fails", async () => {
      await expect(
        repo.create(input({ siteId: "33333333-3333-3333-3333-333333333333" }), ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);

      const created = await repo.create(input(), ACTOR);
      expect(created.prNo).toBe(`PR/${FY}/001`);
    });

    it("refuses a duplicate number with a 409 rather than storing it", async () => {
      const first = await repo.create(input(), ACTOR);

      await expect(
        db.insert(schema.purchaseRequests).values({
          prNo: first.prNo,
          siteId,
          unitId,
          quantity: "1.00",
        }),
      ).rejects.toThrow();
    });
  });

  describe("quantities", () => {
    it("round-trips as an exact decimal string, never a float", async () => {
      const created = await repo.create(input({ quantity: "1234.56" }), ACTOR);
      expect(created.quantity).toBe("1234.56");

      const reloaded = await repo.findById(created.id);
      expect(reloaded.quantity).toBe("1234.56");
    });

    it("rejects zero and negative quantities at the contract", () => {
      expect(() => input({ quantity: "0" })).toThrow(/greater than zero/);
      expect(() => input({ quantity: "0.00" })).toThrow(/greater than zero/);
      expect(() => input({ quantity: "-5" })).toThrow();
    });
  });

  describe("the item reference", () => {
    it("shows the catalogue item's name when there is one", async () => {
      await repo.create(input(), ACTOR);
      const page = await repo.list(query());
      expect(page.rows[0]!.itemLabel).toBe("OPC 53 Grade Cement");
    });

    /**
     * The source INNER JOINs `ItemMaster`, so a request with no `ItemId` is in the
     * table and invisible in the application. This lists it, falling back to the
     * free text — a deliberate departure recorded in the schema.
     */
    it("lists a request that names free text instead of a catalogue item", async () => {
      await repo.create(input({ itemId: null, itemName: "Scaffolding hire" }), ACTOR);

      const page = await repo.list(query());
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]!.itemId).toBeNull();
      expect(page.rows[0]!.itemLabel).toBe("Scaffolding hire");
    });

    it("refuses a request that names neither an item nor free text", () => {
      expect(() => input({ itemId: null, itemName: "" })).toThrow(/Choose an item/);
    });

    it("refuses an item id that does not exist, with a 409 from the foreign key", async () => {
      await expect(
        repo.create(input({ itemId: "44444444-4444-4444-4444-444444444444" }), ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("listing", () => {
    /**
     * The source filters `c.IsActive == true`, so deactivating a site erases its
     * request history from the list. Departure, for the same reason as the item
     * join: the rows exist and nothing says they should be unreadable.
     */
    it("keeps requests for a site that has been deactivated", async () => {
      await repo.create(input({ siteId: inactiveSiteId }), ACTOR);

      const page = await repo.list(query());
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]!.siteName).toBe("Closed Depot");
    });

    it("filters by site", async () => {
      await repo.create(input(), ACTOR);
      await repo.create(input({ siteId: inactiveSiteId }), ACTOR);

      const page = await repo.list(query(), { siteId });
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]!.siteId).toBe(siteId);
      expect(await repo.total(undefined, { siteId })).toBe(1);
    });

    it("filters by approval, which is what the dashboard queue reads", async () => {
      const first = await repo.create(input(), ACTOR);
      await repo.create(input(), ACTOR);
      await repo.setApproval(first.id, true, ACTOR);

      const pending = await repo.list(query(), { isApproved: false });
      expect(pending.rows).toHaveLength(1);
      expect(pending.rows[0]!.id).not.toBe(first.id);
      expect(await repo.total(undefined, { isApproved: false })).toBe(1);
    });

    it("searches the request number, the catalogue item and the free text", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.create(input({ itemId: null, itemName: "Scaffolding hire" }), ACTOR);

      expect((await repo.list(query({ search: created.prNo }))).rows).toHaveLength(1);
      expect((await repo.list(query({ search: "cement" }))).rows).toHaveLength(1);
      expect((await repo.list(query({ search: "scaffold" }))).rows).toHaveLength(1);
      expect((await repo.list(query({ search: "nothing here" }))).rows).toHaveLength(0);
    });

    it("pages by keyset without repeating or dropping a row", async () => {
      for (let i = 0; i < 5; i += 1) {
        await repo.create(input(), ACTOR);
      }

      const first = await repo.list(query({ limit: 2, sortBy: "prNo" }));
      expect(first.rows).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await repo.list(query({ limit: 2, sortBy: "prNo", cursor: first.nextCursor! }));
      const third = await repo.list(query({ limit: 2, sortBy: "prNo", cursor: second.nextCursor! }));

      const seen = [...first.rows, ...second.rows, ...third.rows].map((row) => row.id);
      expect(new Set(seen).size).toBe(5);
    });
  });

  describe("approval", () => {
    /**
     * The source's `PurchaseRequestIsApproved` reads the current value and writes
     * the opposite, so the outcome of two approvers depends on ordering and the
     * API cannot express "approve this" at all. This states the value.
     */
    it("sets approval to what was asked, not to the opposite of what it was", async () => {
      const created = await repo.create(input(), ACTOR);

      const approved = await repo.setApproval(created.id, true, ACTOR);
      expect(approved.isApproved).toBe(true);

      // Asking for `true` again leaves it true. A toggle would turn it off.
      const again = await repo.setApproval(created.id, true, OTHER_ACTOR);
      expect(again.isApproved).toBe(true);
    });

    it("stamps who approved it", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.setApproval(created.id, true, OTHER_ACTOR);

      const [row] = await db
        .select({ updatedBy: schema.purchaseRequests.updatedBy })
        .from(schema.purchaseRequests)
        .where(eq(schema.purchaseRequests.id, created.id));

      expect(row!.updatedBy).toBe(OTHER_ACTOR);
    });

    it("bulk approval touches only the ids it was given", async () => {
      const first = await repo.create(input(), ACTOR);
      const second = await repo.create(input(), ACTOR);
      const untouched = await repo.create(input(), ACTOR);

      const updated = await repo.setApprovalMany([first.id, second.id], true, ACTOR);
      expect(updated).toBe(2);

      expect((await repo.findById(untouched.id)).isApproved).toBe(false);
      expect((await repo.findById(first.id)).isApproved).toBe(true);
    });

    it("counts only rows that actually changed", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.setApproval(created.id, true, ACTOR);

      expect(await repo.setApprovalMany([created.id], true, ACTOR)).toBe(0);
      expect(await repo.setApprovalMany([created.id], false, ACTOR)).toBe(1);
    });

    it("does not approve a deleted request", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      expect(await repo.setApprovalMany([created.id], true, ACTOR)).toBe(0);
      await expect(repo.setApproval(created.id, true, ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("update and delete", () => {
    it("updates the fields given and leaves the number alone", async () => {
      const created = await repo.create(input(), ACTOR);

      const updated = await repo.update(created.id, { quantity: "42.50" }, OTHER_ACTOR);
      expect(updated.quantity).toBe("42.50");
      expect(updated.prNo).toBe(created.prNo);
    });

    it("stamps updated_by and updated_at, which the source leaves null", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.update(created.id, { quantity: "5.00" }, OTHER_ACTOR);

      const [row] = await db
        .select({
          updatedBy: schema.purchaseRequests.updatedBy,
          updatedAt: schema.purchaseRequests.updatedAt,
        })
        .from(schema.purchaseRequests)
        .where(eq(schema.purchaseRequests.id, created.id));

      expect(row!.updatedBy).toBe(OTHER_ACTOR);
      expect(row!.updatedAt).not.toBeNull();
    });

    it("hides a deleted request from the list and from findById", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      expect((await repo.list(query())).rows).toHaveLength(0);
      expect(await repo.total()).toBe(0);
      await expect(repo.findById(created.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("frees the number for reuse only in the sense that the index ignores deleted rows", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      // The counter does not rewind, so the next request gets 002 regardless.
      const next = await repo.create(input(), ACTOR);
      expect(next.prNo).toBe(`PR/${FY}/002`);
    });

    it("reports a missing request rather than silently doing nothing", async () => {
      const missing = "55555555-5555-5555-5555-555555555555";
      await expect(repo.update(missing, { quantity: "1.00" }, ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(repo.remove(missing, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
