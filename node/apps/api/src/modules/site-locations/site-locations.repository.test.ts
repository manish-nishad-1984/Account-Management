import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listQuerySchema, saveSiteLocationsSchema } from "@accountmanagement/contracts";
import { SiteLocationsRepository } from "./site-locations.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";
const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

/** One pair. Either half may be left out; both default to blank. */
const pair = (name = "", address = "", id?: string) => ({ id: id ?? null, name, address });
const pairs = (rows: ReturnType<typeof pair>[] = []) =>
  saveSiteLocationsSchema.parse({ locations: rows });

/**
 * Site Location — one list of PAIRS since 17 Sep 2026.
 *
 * The screen was Site Groups, became two independent lists on 15 Sep, and became
 * a location with its address on 17 Sep. See the contract for why the business
 * reversed itself; the short version is that two lists could not say which
 * address belonged to which block, and a delivery needs to know.
 *
 * THE CASES THAT EARN THEIR PLACE HERE are the ones migration 0020 created: a
 * site holding several pairs that have an address and NO NAME. That state is
 * normal now — it is what every pre-existing address was carried across into —
 * and it is one unique index away from making those sites unsaveable.
 */
describe("SiteLocationsRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: SiteLocationsRepository;
  let riverfront: string;
  let depot: string;
  let empty: string;

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new SiteLocationsRepository(db);

    const rows = await db
      .insert(schema.sites)
      .values([{ name: "Surat Riverfront" }, { name: "Valsad Depot" }, { name: "Empty Site" }])
      .returning({ id: schema.sites.id, name: schema.sites.name });
    riverfront = rows.find((row) => row.name === "Surat Riverfront")!.id;
    depot = rows.find((row) => row.name === "Valsad Depot")!.id;
    empty = rows.find((row) => row.name === "Empty Site")!.id;
  });

  describe("create and read", () => {
    it("keeps a location and its address together, in name order", async () => {
      const saved = await repo.create(
        riverfront,
        pairs([pair("Store yard", "Gate 2, Ring Road"), pair("Block A", "Gate 1, Ring Road")]),
        ACTOR,
      );

      expect(saved.siteName).toBe("Surat Riverfront");
      expect(saved.locations.map((l) => [l.name, l.address])).toEqual([
        ["Block A", "Gate 1, Ring Road"],
        ["Store yard", "Gate 2, Ring Road"],
      ]);
    });

    it("refuses to create a second entry for the same site", async () => {
      await repo.create(riverfront, pairs([pair("Block A")]), ACTOR);
      await expect(repo.create(riverfront, pairs([pair("Block B")]), ACTOR)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("404s for a site that does not exist", async () => {
      await expect(repo.findBySite("22222222-2222-2222-2222-222222222222")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("answers a site with no pairs rather than refusing it", async () => {
      expect(await repo.findBySite(empty)).toMatchObject({ locations: [] });
    });
  });

  /** What migration 0020 left behind, and what the screen has to let people fix. */
  describe("a half-filled pair", () => {
    it("keeps an address that has no location name yet", async () => {
      const saved = await repo.create(riverfront, pairs([pair("", "Gate 1, Ring Road")]), ACTOR);
      expect(saved.locations).toMatchObject([{ name: "", address: "Gate 1, Ring Road" }]);
    });

    it("keeps a location name that has no address yet", async () => {
      const saved = await repo.create(riverfront, pairs([pair("Block A")]), ACTOR);
      expect(saved.locations).toMatchObject([{ name: "Block A", address: "" }]);
    });

    it("drops a pair with both halves blank instead of refusing it", async () => {
      const saved = await repo.create(
        riverfront,
        pairs([pair("Block A", "Gate 1"), pair(), pair("   ", "  ")]),
        ACTOR,
      );
      expect(saved.locations).toHaveLength(1);
    });

    /**
     * THE ONE THAT WOULD HAVE BROKEN PRODUCTION. BHAVNAGAR-RAJUBHAI came through
     * the migration with eight addresses and no names. The unique index on
     * `(site_id, lower(name))` covered blanks until 0020 exempted them, so the
     * SECOND unnamed pair on any site would have been refused — and that site
     * could not have been saved at all until every one was named in one sitting.
     */
    it("allows SEVERAL unnamed pairs on one site", async () => {
      const saved = await repo.create(
        riverfront,
        pairs([pair("", "Gate 1"), pair("", "Gate 2"), pair("", "Gate 3")]),
        ACTOR,
      );
      expect(saved.locations.map((l) => l.address).sort()).toEqual(["Gate 1", "Gate 2", "Gate 3"]);
    });

    it("still refuses two REAL locations with the same name", async () => {
      await expect(
        repo.create(riverfront, pairs([pair("Block A", "Gate 1"), pair("block a", "Gate 2")]), ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("saving over an entry", () => {
    it("renames in place, so a document that references the location keeps it", async () => {
      const created = await repo.create(riverfront, pairs([pair("Block A", "Gate 1")]), ACTOR);
      const id = created.locations[0]!.id;

      const saved = await repo.save(riverfront, pairs([pair("Block A (East)", "Gate 1", id)]), ACTOR);
      expect(saved.locations).toMatchObject([{ id, name: "Block A (East)" }]);
    });

    it("changes the address half without touching the id", async () => {
      const created = await repo.create(riverfront, pairs([pair("Block A", "Gate 1")]), ACTOR);
      const id = created.locations[0]!.id;

      const saved = await repo.save(riverfront, pairs([pair("Block A", "Gate 9", id)]), ACTOR);
      expect(saved.locations).toMatchObject([{ id, address: "Gate 9" }]);
    });

    it("names a migrated pair without losing its address", async () => {
      const created = await repo.create(riverfront, pairs([pair("", "Plot 5, Bardoli Road")]), ACTOR);
      const id = created.locations[0]!.id;

      const saved = await repo.save(
        riverfront,
        pairs([pair("Block A", "Plot 5, Bardoli Road", id)]),
        ACTOR,
      );
      expect(saved.locations).toMatchObject([
        { id, name: "Block A", address: "Plot 5, Bardoli Road" },
      ]);
    });

    it("soft-deletes a pair left out of the list", async () => {
      const created = await repo.create(
        riverfront,
        pairs([pair("Block A", "Gate 1"), pair("Block B", "Gate 2")]),
        ACTOR,
      );
      const keep = created.locations.find((l) => l.name === "Block A")!.id;

      const saved = await repo.save(riverfront, pairs([pair("Block A", "Gate 1", keep)]), ACTOR);
      expect(saved.locations.map((l) => l.name)).toEqual(["Block A"]);

      const stored = await db
        .select()
        .from(schema.siteLocations)
        .where(eq(schema.siteLocations.siteId, riverfront));
      expect(stored).toHaveLength(2);
      expect(stored.filter((r) => r.isDeleted).map((r) => r.name)).toEqual(["Block B"]);
    });

    it("refuses a location id that belongs to another site", async () => {
      const theirs = await repo.create(depot, pairs([pair("Their yard")]), ACTOR);
      await expect(
        repo.save(riverfront, pairs([pair("Mine now", "", theirs.locations[0]!.id)]), ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("the list", () => {
    it("counts the pairs, and how many of them have an address", async () => {
      await repo.create(
        riverfront,
        pairs([pair("Block B", "Gate 2"), pair("Block A"), pair("", "NH 48")]),
        ACTOR,
      );
      await repo.create(depot, pairs([pair("", "Ring Road")]), ACTOR);

      const page = await repo.list(query({ limit: 50 }));
      expect(page.rows).toEqual([
        {
          id: riverfront,
          siteName: "Surat Riverfront",
          locationCount: 3,
          // "Block A" has no address; the unnamed NH 48 pair does.
          addressCount: 2,
          // The preview skips the unnamed pair — a blank is not worth a slot.
          locationNames: ["Block A", "Block B"],
        },
        {
          id: depot,
          siteName: "Valsad Depot",
          locationCount: 1,
          addressCount: 1,
          locationNames: [],
        },
      ]);
      expect(await repo.total()).toBe(2);
    });

    it("finds a site by one of its location names", async () => {
      await repo.create(riverfront, pairs([pair("Store yard", "Gate 1")]), ACTOR);
      await repo.create(depot, pairs([pair("Block A", "Gate 2")]), ACTOR);

      const page = await repo.list(query({ search: "store" }));
      expect(page.rows.map((r) => r.siteName)).toEqual(["Surat Riverfront"]);
      expect(await repo.total("store")).toBe(1);
    });

    /** The half a migrated pair HAS, so it had better be searchable by it. */
    it("finds a site by an address, including one with no location name", async () => {
      await repo.create(riverfront, pairs([pair("", "Plot 5, Bardoli Road")]), ACTOR);
      await repo.create(depot, pairs([pair("Block A", "Ring Road")]), ACTOR);

      const page = await repo.list(query({ search: "bardoli" }));
      expect(page.rows.map((r) => r.siteName)).toEqual(["Surat Riverfront"]);
    });
  });

  describe("deleting", () => {
    it("empties the list and keeps the rows, so documents keep their names", async () => {
      await repo.create(riverfront, pairs([pair("Block A", "Gate 1")]), ACTOR);
      await repo.remove(riverfront, ACTOR);

      expect(await repo.findBySite(riverfront)).toMatchObject({ locations: [] });
      expect(await repo.total()).toBe(0);
      const rows = await db.select().from(schema.siteLocations);
      expect(rows.map((r) => r.isDeleted)).toEqual([true]);
    });
  });
});
