import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { listQuerySchema } from "@accountmanagement/contracts";
import { UsersRepository } from "./users.repository";
import * as schema from "../../db/schema";
import type { Database } from "../../db/database";

const MIGRATIONS_DIR = join(__dirname, "../../../drizzle");

async function freshDatabase(): Promise<Database> {
  const client = await PGlite.create();
  const file = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith(".sql"))!;
  for (const statement of readFileSync(join(MIGRATIONS_DIR, file), "utf8").split(
    "--> statement-breakpoint",
  )) {
    if (statement.trim()) await client.exec(statement);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

describe("UsersRepository — keyset pagination (real PostgreSQL)", () => {
  let db: Database;
  let repo: UsersRepository;

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new UsersRepository(db);

    // 25 users, deliberately including duplicate last names so the tiebreaker
    // actually gets exercised.
    await db.insert(schema.users).values(
      Array.from({ length: 25 }, (_, i) => ({
        firstName: `First${String(i).padStart(2, "0")}`,
        lastName: i % 5 === 0 ? "Shared" : `Last${i}`,
        email: `user${String(i).padStart(2, "0")}@example.com`,
        phoneNo: "0000000000",
        userName: `user${String(i).padStart(2, "0")}`,
        password: "legacy-plaintext",
        passwordIsLegacy: i % 3 === 0,
      })),
    );
  });

  it("returns only the requested page size", async () => {
    const page = await repo.list(query({ limit: 10 }));
    expect(page.rows).toHaveLength(10);
    expect(page.nextCursor).not.toBeNull();
  });

  it("walks every row exactly once across pages, with no gaps or repeats", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let guard = 0; guard < 20; guard++) {
      const page = await repo.list(query({ limit: 7, cursor }));
      seen.push(...page.rows.map((r) => r.userName));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect(seen).toEqual([...seen].sort());
  });

  it("returns no cursor on the final page", async () => {
    const page = await repo.list(query({ limit: 100 }));
    expect(page.rows).toHaveLength(25);
    expect(page.nextCursor).toBeNull();
  });

  it("paginates correctly on a NON-UNIQUE sort column (the tiebreaker case)", async () => {
    // 5 users share the last name "Shared". Without the id tiebreaker in the
    // cursor, rows are skipped or repeated here.
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let guard = 0; guard < 20; guard++) {
      const page = await repo.list(query({ limit: 3, cursor, sortBy: "lastName" }));
      seen.push(...page.rows.map((r) => r.userName));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  it("sorts descending and still pages cleanly", async () => {
    const first = await repo.list(query({ limit: 5, sortDir: "desc" }));
    expect(first.rows[0]!.userName).toBe("user24");

    const second = await repo.list(query({ limit: 5, sortDir: "desc", cursor: first.nextCursor! }));
    expect(second.rows[0]!.userName).toBe("user19");
    expect(second.rows.map((r) => r.userName)).not.toContain("user24");
  });

  it("filters by search across name, username and email", async () => {
    const byUserName = await repo.list(query({ search: "user07" }));
    expect(byUserName.rows.map((r) => r.userName)).toEqual(["user07"]);

    const byEmail = await repo.list(query({ search: "user12@example.com" }));
    expect(byEmail.rows).toHaveLength(1);
  });

  it("search is case-insensitive", async () => {
    const upper = await repo.list(query({ search: "FIRST03" }));
    expect(upper.rows).toHaveLength(1);
  });

  it("counts the filtered set, not the whole table", async () => {
    expect(await repo.total()).toBe(25);
    expect(await repo.total("user1")).toBe(10); // user1, user10..user19
  });

  it("excludes soft-deleted users from both rows and total", async () => {
    await db.update(schema.users).set({ isDeleted: true });
    expect((await repo.list(query())).rows).toHaveLength(0);
    expect(await repo.total()).toBe(0);
  });

  it("reports the legacy-password flag so C-1 remediation is visible", async () => {
    const page = await repo.list(query({ limit: 100 }));
    expect(page.rows.filter((r) => r.passwordIsLegacy).length).toBeGreaterThan(0);
  });

  it("counts sites per user without duplicating the row", async () => {
    const company = await db
      .insert(schema.companies)
      .values({ name: "D H Infra" })
      .returning();
    const sites = await db
      .insert(schema.sites)
      .values([
        { name: "Site A", companyId: company[0]!.id },
        { name: "Site B", companyId: company[0]!.id },
      ])
      .returning();
    const [target] = await db.select().from(schema.users).limit(1);
    await db.insert(schema.userSites).values([
      { userId: target!.id, siteId: sites[0]!.id },
      { userId: target!.id, siteId: sites[1]!.id },
    ]);

    const page = await repo.list(query({ limit: 100 }));
    const row = page.rows.find((r) => r.id === target!.id)!;
    expect(row.siteCount).toBe(2);
    expect(page.rows.filter((r) => r.id === target!.id)).toHaveLength(1);
  });

  it("rejects a malformed cursor rather than returning wrong data", async () => {
    await expect(repo.list(query({ cursor: "not-a-cursor" }))).rejects.toThrow();
  });

  it("caps the page size so a client cannot ask for the whole table", () => {
    expect(() => query({ limit: 5000 })).toThrow();
  });
});
