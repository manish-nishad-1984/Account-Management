import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listQuerySchema } from "@accountmanagement/contracts";
import { SitesRepository } from "./sites.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

describe("SitesRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: SitesRepository;

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new SitesRepository(db);

    await db.insert(schema.sites).values(
      Array.from({ length: 20 }, (_unused, i) => ({
        name: "Site " + String(i).padStart(2, "0"),
        area: i % 2 === 0 ? "Navrangpura" : "Satellite",
        contactPersonName: i === 3 ? "Bhavin Patel" : "Someone Else",
        contactPersonPhoneNo: "97" + String(20000000 + i),
        pincode: String(380001 + i),
        isActive: i % 5 !== 0,
      })),
    );
  });

  it("walks every row exactly once across pages", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let guard = 0; guard < 20; guard++) {
      const page = await repo.list(query({ limit: 6, cursor }));
      seen.push(...page.rows.map((r) => r.name));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(20);
    expect(new Set(seen).size).toBe(20);
  });

  it("searches the contact person, not only the site name", async () => {
    const page = await repo.list(query({ search: "Bhavin" }));
    expect(page.rows.map((r) => r.name)).toEqual(["Site 03"]);
  });

  it("searches by area", async () => {
    expect(await repo.total("Navrangpura")).toBe(10);
  });

  it("keeps the active flag, which the source column also carries", async () => {
    const page = await repo.list(query({ limit: 100 }));
    expect(page.rows.filter((r) => !r.isActive)).toHaveLength(4);
  });

  it("hides soft-deleted sites", async () => {
    await db
      .update(schema.sites)
      .set({ isDeleted: true })
      .where(eq(schema.sites.name, "Site 00"));

    const page = await repo.list(query({ limit: 100 }));
    expect(page.rows.map((r) => r.name)).not.toContain("Site 00");
    expect(await repo.total()).toBe(19);
  });

  /**
   * The one that matters.
   *
   * A site with 3 users AND 2 groups must report 3 and 2 — not 6 and 6. Joining
   * both relations in a single query multiplies them together, which is exactly
   * the shape of the .NET list queries that join and then de-duplicate in memory.
   */
  it("counts users and groups independently, not as a cross product", async () => {
    const [site] = await db.select({ id: schema.sites.id }).from(schema.sites).limit(1);

    const insertedUsers = await db
      .insert(schema.users)
      .values(
        Array.from({ length: 3 }, (_unused, i) => ({
          firstName: "First",
          lastName: "Last",
          email: "u" + i + "@example.com",
          phoneNo: "0",
          userName: "u" + i,
          password: "x",
        })),
      )
      .returning({ id: schema.users.id });
    await db
      .insert(schema.userSites)
      .values(insertedUsers.map((u) => ({ userId: u.id, siteId: site!.id })));

    const insertedGroups = await db
      .insert(schema.siteGroups)
      .values([{ name: "Group A" }, { name: "Group B" }])
      .returning({ id: schema.siteGroups.id });
    await db
      .insert(schema.siteGroupSites)
      .values(insertedGroups.map((g) => ({ groupId: g.id, siteId: site!.id })));

    const page = await repo.list(query({ limit: 100 }));
    const row = page.rows.find((r) => r.id === site!.id)!;

    expect(row.userCount).toBe(3);
    expect(row.groupCount).toBe(2);
    expect(page.rows.filter((r) => r.id === site!.id)).toHaveLength(1);
  });

  /**
   * The header's site picker, which every signed-in user reads.
   *
   * `Main_Layout.cshtml` distinguishes two cases and so does this: rows in
   * `user_sites` mean the user is assigned and gets exactly those, with no
   * "All Site" entry; no rows means the layout falls back to `GetSiteNameList`
   * and every site.
   */
  describe("scopeFor", () => {
    const addUser = async (userName: string) => {
      const [user] = await db
        .insert(schema.users)
        .values({
          firstName: "First",
          lastName: "Last",
          email: userName + "@example.com",
          phoneNo: "0",
          userName,
          password: "x",
        })
        .returning({ id: schema.users.id });
      return user!.id;
    };

    const siteNamed = async (name: string) => {
      const [site] = await db
        .select({ id: schema.sites.id })
        .from(schema.sites)
        .where(eq(schema.sites.name, name));
      return site!.id;
    };

    it("returns only the sites a user is assigned to", async () => {
      const userId = await addUser("assigned");
      await db.insert(schema.userSites).values([
        { userId, siteId: await siteNamed("Site 03") },
        { userId, siteId: await siteNamed("Site 07") },
      ]);

      const result = await repo.scopeFor(userId);

      expect(result.scope).toBe("assigned");
      expect(result.sites.map((s) => s.name)).toEqual(["Site 03", "Site 07"]);
    });

    it("falls back to every active site for a user assigned to none", async () => {
      const result = await repo.scopeFor(await addUser("unassigned"));

      expect(result.scope).toBe("all");
      // 4 of the 20 fixture sites are inactive.
      expect(result.sites).toHaveLength(16);
    });

    /**
     * `UserSession.SiteData` carries no `IsActive` filter while
     * `GetSiteNameList` does, and the asymmetry is kept: dropping a deactivated
     * site the user is assigned to would hide their own documents from the only
     * person responsible for them.
     */
    it("keeps an assigned site that has been deactivated", async () => {
      const userId = await addUser("on-a-closed-site");
      // Site 00 is one of the inactive ones in the fixture.
      await db.insert(schema.userSites).values({ userId, siteId: await siteNamed("Site 00") });

      const result = await repo.scopeFor(userId);

      expect(result.sites.map((s) => s.name)).toEqual(["Site 00"]);
    });

    it("drops a soft-deleted site from an assignment rather than offering a dead one", async () => {
      const userId = await addUser("stale-assignment");
      const siteId = await siteNamed("Site 03");
      await db.insert(schema.userSites).values([
        { userId, siteId },
        { userId, siteId: await siteNamed("Site 07") },
      ]);
      await db.update(schema.sites).set({ isDeleted: true }).where(eq(schema.sites.id, siteId));

      const result = await repo.scopeFor(userId);

      expect(result.sites.map((s) => s.name)).toEqual(["Site 07"]);
    });

    it("is ordered by name, so the default first site does not move between calls", async () => {
      const userId = await addUser("ordered");
      await db.insert(schema.userSites).values([
        { userId, siteId: await siteNamed("Site 11") },
        { userId, siteId: await siteNamed("Site 02") },
      ]);

      const result = await repo.scopeFor(userId);

      expect(result.sites.map((s) => s.name)).toEqual(["Site 02", "Site 11"]);
    });

    it("returns every site rather than throwing when the caller has no id", async () => {
      const result = await repo.scopeFor(undefined);
      expect(result.scope).toBe("all");
    });
  });

  it("caps the page size so a client cannot ask for the whole table", () => {
    expect(() => query({ limit: 5000 })).toThrow();
  });
});
