import { beforeEach, describe, expect, it } from "vitest";
import { createItemSchema, listQuerySchema } from "@accountmanagement/contracts";
import { ItemsRepository } from "./items.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

/**
 * Approval on items, and the dashboard queue that reads it.
 *
 * The behaviour under test is the same on suppliers and inward challans; the
 * interesting cases are here once rather than three times, and the sibling
 * repositories are exercised through the same helpers in their own files.
 */
describe("item approval (real PostgreSQL)", () => {
  let db: Database;
  let items: ItemsRepository;
  let unitId: number;

  const make = async (name: string, isApproved: boolean) =>
    items.create(
      createItemSchema.parse({ name, unitId, pricePerUnit: "10.00", isApproved }),
      ACTOR,
    );

  const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

  beforeEach(async () => {
    db = await freshDatabase();
    items = new ItemsRepository(db);
    const [unit] = await db
      .insert(schema.units)
      .values({ name: "Bag" })
      .returning({ id: schema.units.id });
    unitId = unit!.id;
  });

  describe("the pending queue filter", () => {
    it("returns only unapproved items", async () => {
      await make("Pending One", false);
      await make("Pending Two", false);
      await make("Approved", true);

      const page = await items.list(query({ limit: 10 }), { isApproved: false });
      expect(page.rows.map((row) => row.name).sort()).toEqual(["Pending One", "Pending Two"]);
    });

    it("counts only unapproved items, so the badge matches the list", async () => {
      await make("Pending", false);
      await make("Approved", true);

      expect(await items.total(undefined, { isApproved: false })).toBe(1);
      expect(await items.total(undefined, { isApproved: true })).toBe(1);
      // No filter is still everything — the list screen must not change.
      expect(await items.total()).toBe(2);
    });

    it("leaves the unfiltered list alone", async () => {
      await make("Pending", false);
      await make("Approved", true);

      const page = await items.list(query({ limit: 10 }));
      expect(page.rows).toHaveLength(2);
    });
  });

  describe("setApproval", () => {
    /**
     * `ApproveUnapproveItem` reads the row and writes the opposite. Two
     * approvers racing land wherever ordering puts them, and the API cannot
     * express "approve this" at all — only "flip it".
     */
    it("states the value rather than toggling it", async () => {
      const item = await make("Cement", false);

      expect((await items.setApproval(item.id, true, ACTOR)).isApproved).toBe(true);
      // Approving an already-approved item is a no-op, not an un-approval.
      expect((await items.setApproval(item.id, true, OTHER)).isApproved).toBe(true);
      expect((await items.setApproval(item.id, false, ACTOR)).isApproved).toBe(false);
    });

    it("refuses an item that does not exist", async () => {
      await expect(
        items.setApproval("33333333-3333-3333-3333-333333333333", true, ACTOR),
      ).rejects.toThrow(/not found/i);
    });

    it("refuses a soft-deleted item", async () => {
      const item = await make("Gone", false);
      await items.remove(item.id, ACTOR);
      await expect(items.setApproval(item.id, true, ACTOR)).rejects.toThrow(/not found/i);
    });
  });

  describe("setApprovalMany", () => {
    it("approves every id given and reports the count", async () => {
      const a = await make("A", false);
      const b = await make("B", false);

      expect(await items.setApprovalMany([a.id, b.id], true, ACTOR)).toBe(2);

      const pending = await items.list(query({ limit: 10 }), { isApproved: false });
      expect(pending.rows).toEqual([]);
    });

    /**
     * The reason the WHERE carries `eq(isApproved, !isApproved)`. A select-all
     * over a queue that already contains approved rows must not flip them off,
     * and the count must be what CHANGED rather than how many boxes were ticked.
     */
    it("skips rows already in the target state, and does not count them", async () => {
      const pending = await make("Pending", false);
      const approved = await make("Approved", true);

      expect(await items.setApprovalMany([pending.id, approved.id], true, ACTOR)).toBe(1);

      const page = await items.list(query({ limit: 10 }));
      expect(page.rows.every((row) => row.isApproved)).toBe(true);
    });

    it("does not touch rows that were not named", async () => {
      const named = await make("Named", false);
      await make("Untouched", false);

      await items.setApprovalMany([named.id], true, ACTOR);

      const pending = await items.list(query({ limit: 10 }), { isApproved: false });
      expect(pending.rows.map((row) => row.name)).toEqual(["Untouched"]);
    });

    it("ignores a soft-deleted id rather than reviving it", async () => {
      const gone = await make("Gone", false);
      await items.remove(gone.id, ACTOR);

      expect(await items.setApprovalMany([gone.id], true, ACTOR)).toBe(0);
    });

    it("is a no-op on an empty list, without issuing a statement", async () => {
      expect(await items.setApprovalMany([], true, ACTOR)).toBe(0);
    });

    it("un-approves in bulk too, which is what makes the flag correctable", async () => {
      const a = await make("A", true);
      const b = await make("B", true);

      expect(await items.setApprovalMany([a.id, b.id], false, ACTOR)).toBe(2);
      expect(await items.total(undefined, { isApproved: false })).toBe(2);
    });
  });
});
