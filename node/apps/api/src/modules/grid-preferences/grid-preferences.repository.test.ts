import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { GridPreferencesRepository } from "./grid-preferences.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

/**
 * Column layouts are the one thing in this application that belongs to a person
 * rather than to the business, so the tests that matter most are the ones about
 * whose layout is whose.
 */
describe("GridPreferencesRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: GridPreferencesRepository;
  let alice: string;
  let bob: string;

  const user = (userName: string) => ({
    firstName: "Test",
    lastName: userName,
    email: `${userName}@example.com`,
    phoneNo: "9825000000",
    userName,
    password: "hash",
  });

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new GridPreferencesRepository(db);

    const inserted = await db
      .insert(schema.users)
      .values([user("alice"), user("bob")])
      .returning({ id: schema.users.id, userName: schema.users.userName });

    alice = inserted.find((r) => r.userName === "alice")!.id;
    bob = inserted.find((r) => r.userName === "bob")!.id;
  });

  const LAYOUT = [
    { id: "name", visible: true },
    { id: "gstNo", visible: false },
    { id: "mobile", visible: true },
  ];

  it("gives a person nothing before they have chosen anything", async () => {
    expect(await repo.list(alice)).toEqual([]);
  });

  it("saves a layout and reads it back in the order it was given", async () => {
    await repo.save(alice, "suppliers", LAYOUT);

    const rows = await repo.list(alice);
    expect(rows).toEqual([{ gridKey: "suppliers", columns: LAYOUT }]);
  });

  it("returns every grid the person has set up, in one call", async () => {
    await repo.save(alice, "suppliers", LAYOUT);
    await repo.save(alice, "purchase-invoices", [{ id: "invoiceNo", visible: true }]);

    const keys = (await repo.list(alice)).map((r) => r.gridKey).sort();
    expect(keys).toEqual(["purchase-invoices", "suppliers"]);
  });

  /**
   * Saving twice is an upsert on the composite key, not an insert. Without that,
   * the second save fails on the primary key — and two browser tabs saving the
   * same grid is an ordinary thing to do.
   */
  it("replaces a layout rather than failing on the second save", async () => {
    await repo.save(alice, "suppliers", LAYOUT);
    await repo.save(alice, "suppliers", [{ id: "name", visible: true }]);

    const rows = await repo.list(alice);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.columns).toEqual([{ id: "name", visible: true }]);
  });

  it("keeps one person's layout out of another's", async () => {
    await repo.save(alice, "suppliers", LAYOUT);

    expect(await repo.list(bob)).toEqual([]);
  });

  it("lets two people hold different layouts for the same grid", async () => {
    await repo.save(alice, "suppliers", LAYOUT);
    await repo.save(bob, "suppliers", [{ id: "area", visible: true }]);

    expect((await repo.list(alice))[0]?.columns).toEqual(LAYOUT);
    expect((await repo.list(bob))[0]?.columns).toEqual([{ id: "area", visible: true }]);
  });

  describe("reset", () => {
    it("removes the row, so the grid's own defaults apply again", async () => {
      await repo.save(alice, "suppliers", LAYOUT);
      await repo.remove(alice, "suppliers");

      expect(await repo.list(alice)).toEqual([]);
    });

    it("leaves the person's other grids alone", async () => {
      await repo.save(alice, "suppliers", LAYOUT);
      await repo.save(alice, "items", [{ id: "name", visible: true }]);

      await repo.remove(alice, "suppliers");

      expect((await repo.list(alice)).map((r) => r.gridKey)).toEqual(["items"]);
    });

    it("leaves other people alone", async () => {
      await repo.save(alice, "suppliers", LAYOUT);
      await repo.save(bob, "suppliers", LAYOUT);

      await repo.remove(alice, "suppliers");

      expect(await repo.list(bob)).toHaveLength(1);
    });

    it("says nothing and does nothing when there was no layout", async () => {
      await expect(repo.remove(alice, "suppliers")).resolves.toBeUndefined();
    });
  });

  /**
   * The one hard delete in this schema. A preference has no meaning without its
   * user and nothing references it, so leaving orphans would grow a table nobody
   * reads — and a later user with a recycled id is not a thing that happens here,
   * but the cascade removes the question.
   */
  it("goes when the user goes", async () => {
    await repo.save(alice, "suppliers", LAYOUT);
    await db.delete(schema.users).where(eq(schema.users.id, alice));

    const left = await db.select().from(schema.userGridPreferences);
    expect(left).toHaveLength(0);
  });
});
