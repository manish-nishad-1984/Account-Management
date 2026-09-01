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

  it("caps the page size so a client cannot ask for the whole table", () => {
    expect(() => query({ limit: 5000 })).toThrow();
  });
});
