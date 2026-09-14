import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createSiteGroupSchema } from "@accountmanagement/contracts";
import { SiteGroupsRepository } from "./site-groups.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

/**
 * WRITING A SITE GROUP.
 *
 * This screen was read-only from the port until 14 Sep 2026, because the .NET
 * solution has no `Group-Add`, `Group-Edit` or `Group-Delete` attribute — only
 * `Group-View`. The business asked for it, and the rights turned out to exist
 * already: `user_form_permissions` carries all four flags per form, and the live
 * rows grant every one of them on the Group form to two users.
 *
 * The group is three tables — the group, its member sites, its addresses — where
 * the source has one holding the cross product of the last two. These tests are
 * mostly about that: a save has to replace both lists rather than merge them,
 * and neither may leave the other's rows behind.
 */

const ACTOR = "00000000-0000-0000-0000-0000000000aa";

describe("SiteGroupsRepository writes (real PostgreSQL)", () => {
  let db: Database;
  let repo: SiteGroupsRepository;
  let siteIds: string[];

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new SiteGroupsRepository(db);

    const inserted = await db
      .insert(schema.sites)
      .values(
        Array.from({ length: 4 }, (_unused, i) => ({ name: "Site " + String(i) })),
      )
      .returning({ id: schema.sites.id });
    siteIds = inserted.map((row) => row.id);
  });

  const input = (overrides: Record<string, unknown> = {}) =>
    createSiteGroupSchema.parse({ name: "Surat North", ...overrides });

  describe("create", () => {
    it("stores the group and gives it back in full", async () => {
      const created = await repo.create(
        input({ siteIds: siteIds.slice(0, 2), addresses: ["Yard 1", "Yard 2"] }),
        ACTOR,
      );

      expect(created.name).toBe("Surat North");
      expect(created.siteIds).toHaveLength(2);
      expect(created.addresses.map((a) => a.address)).toEqual(["Yard 1", "Yard 2"]);
    });

    it("records who created it", async () => {
      const created = await repo.create(input(), ACTOR);
      const [stored] = await db
        .select({ createdBy: schema.siteGroups.createdBy })
        .from(schema.siteGroups)
        .where(eq(schema.siteGroups.id, created.id));

      expect(stored!.createdBy).toBe(ACTOR);
    });

    it("accepts a group with no sites and no addresses", async () => {
      const created = await repo.create(input({ name: "Empty" }), ACTOR);

      expect(created.siteIds).toEqual([]);
      expect(created.addresses).toEqual([]);
    });

    /**
     * `site_group_sites` is keyed on (group, site), so a repeated id is a
     * constraint violation rather than a harmless duplicate — and a multi-select
     * that sends one twice is a browser bug, not a mistake by the person using
     * it.
     */
    it("ignores the same site sent twice", async () => {
      const created = await repo.create(
        input({ siteIds: [siteIds[0]!, siteIds[0]!, siteIds[1]!] }),
        ACTOR,
      );

      expect(created.siteIds).toHaveLength(2);
    });

    it("ignores a blank address rather than storing one", async () => {
      const created = await repo.create(input({ addresses: ["  Yard 1  ", "Yard 1"] }), ACTOR);

      expect(created.addresses.map((a) => a.address)).toEqual(["Yard 1"]);
    });

    /**
     * The name is a de facto key: documents were matched to a group BY NAME in
     * the source, so two groups differing only in case made those joins
     * ambiguous. The index enforces it here, rather than the check-then-insert
     * the source does in application code.
     */
    it("refuses a name another group already has, whatever the case", async () => {
      await repo.create(input({ name: "Surat North" }), ACTOR);

      await expect(repo.create(input({ name: "surat north" }), ACTOR)).rejects.toThrow();
    });
  });

  describe("update", () => {
    it("renames without touching the members", async () => {
      const created = await repo.create(input({ siteIds: siteIds.slice(0, 2) }), ACTOR);
      const updated = await repo.update(created.id, { name: "Surat South" }, ACTOR);

      expect(updated.name).toBe("Surat South");
      expect(updated.siteIds).toHaveLength(2);
    });

    /** A key left out is untouched; a key sent replaces what was there. */
    it("replaces the member list rather than adding to it", async () => {
      const created = await repo.create(input({ siteIds: siteIds.slice(0, 3) }), ACTOR);
      const updated = await repo.update(created.id, { siteIds: [siteIds[3]!] }, ACTOR);

      expect(updated.siteIds).toEqual([siteIds[3]]);
    });

    it("can empty the member list", async () => {
      const created = await repo.create(input({ siteIds: siteIds.slice(0, 3) }), ACTOR);
      const updated = await repo.update(created.id, { siteIds: [] }, ACTOR);

      expect(updated.siteIds).toEqual([]);
    });

    it("replaces the addresses", async () => {
      const created = await repo.create(input({ addresses: ["Yard 1", "Yard 2"] }), ACTOR);
      const updated = await repo.update(created.id, { addresses: ["Yard 3"] }, ACTOR);

      expect(updated.addresses.map((a) => a.address)).toEqual(["Yard 3"]);
    });

    it("leaves the addresses alone when the payload does not mention them", async () => {
      const created = await repo.create(input({ addresses: ["Yard 1"] }), ACTOR);
      const updated = await repo.update(created.id, { name: "Renamed" }, ACTOR);

      expect(updated.addresses.map((a) => a.address)).toEqual(["Yard 1"]);
    });

    it("refuses a group that does not exist", async () => {
      await expect(
        repo.update("00000000-0000-0000-0000-000000000000", { name: "Ghost" }, ACTOR),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("delete", () => {
    it("marks it deleted and takes it off the list", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      const page = await repo.list({
        limit: 25,
        sortBy: "name",
        sortDir: "asc",
      } as Parameters<typeof repo.list>[0]);
      expect(page.rows.map((r) => r.name)).not.toContain("Surat North");

      const [stored] = await db
        .select({ isDeleted: schema.siteGroups.isDeleted })
        .from(schema.siteGroups)
        .where(eq(schema.siteGroups.id, created.id));
      expect(stored!.isDeleted).toBe(true);
    });

    /**
     * A SOFT DELETE FIRES NO CASCADE. `purchase_orders.site_group_id` is a real
     * foreign key here — the source matched on the group's name as a string —
     * so a deleted group would leave orders pointing at something no list shows.
     */
    it("is refused while a purchase order uses the group", async () => {
      const created = await repo.create(input(), ACTOR);
      const [supplier] = await db
        .insert(schema.suppliers)
        .values({ name: "A Supplier" })
        .returning({ id: schema.suppliers.id });
      const [company] = await db
        .insert(schema.companies)
        .values({ name: "A Company" })
        .returning({ id: schema.companies.id });

      await db.insert(schema.purchaseOrders).values({
        poNo: "PO/26-27/001",
        supplierId: supplier!.id,
        siteId: siteIds[0]!,
        companyId: company!.id,
        siteGroupId: created.id,
        documentDate: new Date(),
        subtotal: "0.00",
        totalGstAmount: "0.00",
        totalDiscount: "0.00",
        totalAmount: "0.00",
      });

      await expect(repo.remove(created.id, ACTOR)).rejects.toThrow(/purchase order/i);
    });

    it("refuses a group that does not exist", async () => {
      await expect(
        repo.remove("00000000-0000-0000-0000-000000000000", ACTOR),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("reading one", () => {
    it("returns the members and addresses of that group only", async () => {
      const mine = await repo.create(
        input({ name: "Mine", siteIds: [siteIds[0]!], addresses: ["My yard"] }),
        ACTOR,
      );
      await repo.create(
        input({ name: "Theirs", siteIds: [siteIds[1]!], addresses: ["Their yard"] }),
        ACTOR,
      );

      const read = await repo.findById(mine.id);
      expect(read.siteIds).toEqual([siteIds[0]]);
      expect(read.addresses.map((a) => a.address)).toEqual(["My yard"]);
    });

    it("refuses one that was deleted", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      await expect(repo.findById(created.id)).rejects.toThrow(/not found/i);
    });
  });
});
