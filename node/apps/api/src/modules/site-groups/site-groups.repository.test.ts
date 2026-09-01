import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listQuerySchema } from "@accountmanagement/contracts";
import { SiteGroupsRepository } from "./site-groups.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

describe("SiteGroupsRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: SiteGroupsRepository;
  let siteIds: string[];

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new SiteGroupsRepository(db);

    const insertedSites = await db
      .insert(schema.sites)
      .values(
        Array.from({ length: 10 }, (_unused, i) => ({
          name: "Site " + String(i).padStart(2, "0"),
        })),
      )
      .returning({ id: schema.sites.id });
    siteIds = insertedSites.map((s) => s.id);

    await db
      .insert(schema.siteGroups)
      .values(
        Array.from({ length: 12 }, (_unused, i) => ({
          name: "Group " + String(i).padStart(2, "0"),
        })),
      );
  });

  const groupNamed = async (name: string) => {
    const [row] = await db
      .select({ id: schema.siteGroups.id })
      .from(schema.siteGroups)
      .where(eq(schema.siteGroups.name, name));
    return row!.id;
  };

  /**
   * The defect this table exists to fix.
   *
   * SQL Server stores `GroupMaster` as one row per (site x address) pair — a group
   * with 4 sites and 3 addresses is 12 rows, and neither count is readable without
   * a GROUP BY. Here 4 sites and 3 addresses must report 4 and 3.
   */
  it("counts sites and addresses independently, not as the source cross product", async () => {
    const groupId = await groupNamed("Group 00");

    await db
      .insert(schema.siteGroupSites)
      .values(siteIds.slice(0, 4).map((siteId) => ({ groupId, siteId })));
    await db.insert(schema.siteGroupAddresses).values(
      Array.from({ length: 3 }, (_unused, i) => ({
        groupId,
        address: "Depot " + i,
      })),
    );

    const page = await repo.list(query({ limit: 100 }));
    const row = page.rows.find((r) => r.id === groupId)!;

    expect(row.siteCount).toBe(4);
    expect(row.addressCount).toBe(3);
    // Not 12, and not one row per pair.
    expect(page.rows.filter((r) => r.id === groupId)).toHaveLength(1);
  });

  it("previews at most three member site names, in a stable order", async () => {
    const groupId = await groupNamed("Group 01");
    await db
      .insert(schema.siteGroupSites)
      .values(siteIds.slice(0, 6).map((siteId) => ({ groupId, siteId })));

    const page = await repo.list(query({ limit: 100 }));
    const row = page.rows.find((r) => r.id === groupId)!;

    expect(row.siteCount).toBe(6);
    expect(row.siteNames).toEqual(["Site 00", "Site 01", "Site 02"]);
  });

  it("reports an empty group as empty rather than failing", async () => {
    const page = await repo.list(query({ limit: 100 }));
    const row = page.rows.find((r) => r.name === "Group 05")!;
    expect(row.siteCount).toBe(0);
    expect(row.addressCount).toBe(0);
    expect(row.siteNames).toEqual([]);
  });

  it("leaves a deleted site out of the name preview", async () => {
    const groupId = await groupNamed("Group 02");
    await db
      .insert(schema.siteGroupSites)
      .values(siteIds.slice(0, 3).map((siteId) => ({ groupId, siteId })));
    await db
      .update(schema.sites)
      .set({ isDeleted: true })
      .where(eq(schema.sites.name, "Site 00"));

    const page = await repo.list(query({ limit: 100 }));
    const row = page.rows.find((r) => r.id === groupId)!;
    expect(row.siteNames).toEqual(["Site 01", "Site 02"]);
  });

  it("walks every row exactly once across pages", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let guard = 0; guard < 20; guard++) {
      const page = await repo.list(query({ limit: 5, cursor }));
      seen.push(...page.rows.map((r) => r.name));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it("hides soft-deleted groups", async () => {
    await db
      .update(schema.siteGroups)
      .set({ isDeleted: true })
      .where(eq(schema.siteGroups.name, "Group 00"));

    expect(await repo.total()).toBe(11);
  });

  /**
   * `PurchaseOrder.SiteGroup` and `SupplierInvoice.SiteGroup` are nvarchar columns
   * holding the group NAME, matched by string equality. The name is therefore a de
   * facto foreign key, and two groups differing only in case would make those
   * joins ambiguous. SQL Server has no constraint here at all — only an
   * application-level `Any(x => x.GroupName == name)` check that a race defeats.
   */
  it("refuses a second live group whose name differs only by case", async () => {
    await expect(
      db.insert(schema.siteGroups).values({ name: "group 00" }),
    ).rejects.toThrow();
  });

  it("allows the name to be reused once the original is soft-deleted", async () => {
    await db
      .update(schema.siteGroups)
      .set({ isDeleted: true })
      .where(eq(schema.siteGroups.name, "Group 00"));

    await expect(
      db.insert(schema.siteGroups).values({ name: "Group 00" }),
    ).resolves.toBeDefined();
  });

  it("removes membership rows when the group goes, leaving no orphans", async () => {
    const groupId = await groupNamed("Group 03");
    await db
      .insert(schema.siteGroupSites)
      .values(siteIds.slice(0, 2).map((siteId) => ({ groupId, siteId })));

    await db.delete(schema.siteGroups).where(eq(schema.siteGroups.id, groupId));

    const remaining = await db
      .select({ siteId: schema.siteGroupSites.siteId })
      .from(schema.siteGroupSites)
      .where(eq(schema.siteGroupSites.groupId, groupId));
    expect(remaining).toEqual([]);
  });

  it("refuses a membership row for a site that does not exist", async () => {
    const groupId = await groupNamed("Group 04");
    await expect(
      db.insert(schema.siteGroupSites).values({
        groupId,
        siteId: "00000000-0000-0000-0000-0000000000ff",
      }),
    ).rejects.toThrow();
  });
});
