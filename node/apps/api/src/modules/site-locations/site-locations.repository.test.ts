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
const lists = (body: Record<string, unknown>) =>
  saveSiteLocationsSchema.parse({ locations: [], addresses: [], ...body });

/**
 * Site locations — the Site Groups screen, renamed and reshaped on 15 Sep 2026.
 * One entry per site: a list of location names and, separately, a list of
 * addresses.
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
    it("saves both lists: locations by name, addresses in the order keyed", async () => {
      const saved = await repo.create(
        riverfront,
        lists({
          locations: [{ name: "Store yard" }, { name: "Block A" }],
          addresses: ["Gate 1, Ring Road", "Gate 2, Ring Road"],
        }),
        ACTOR,
      );

      expect(saved.siteName).toBe("Surat Riverfront");
      expect(saved.locations.map((l) => l.name)).toEqual(["Block A", "Store yard"]);
      expect(saved.addresses.map((a) => a.address)).toEqual(["Gate 1, Ring Road", "Gate 2, Ring Road"]);
    });

    it("refuses to create a second entry for the same site", async () => {
      await repo.create(riverfront, lists({ locations: [{ name: "Block A" }] }), ACTOR);
      await expect(
        repo.create(riverfront, lists({ locations: [{ name: "Block B" }] }), ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("answers an empty entry for a site with nothing yet, and 404 for no site", async () => {
      expect(await repo.findBySite(empty)).toMatchObject({ locations: [], addresses: [] });
      await expect(
        repo.findBySite("99999999-9999-4999-8999-999999999999"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("refuses the same name twice in one save, ignoring case and spaces", async () => {
      await expect(
        repo.create(riverfront, lists({ locations: [{ name: "Block A" }, { name: " block a " }] }), ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("allows two sites to have a location of the same name", async () => {
      await repo.create(riverfront, lists({ locations: [{ name: "Block A" }] }), ACTOR);
      const other = await repo.create(depot, lists({ locations: [{ name: "Block A" }] }), ACTOR);
      expect(other.locations).toHaveLength(1);
    });
  });

  describe("editing", () => {
    it("renames a location IN PLACE, so documents that reference it keep it", async () => {
      const saved = await repo.create(riverfront, lists({ locations: [{ name: "Block A" }] }), ACTOR);
      const blockA = saved.locations[0]!.id;

      const renamed = await repo.save(
        riverfront,
        lists({ locations: [{ id: blockA, name: "Block A (East)" }] }),
        ACTOR,
      );
      expect(renamed.locations).toEqual([{ id: blockA, name: "Block A (East)" }]);
    });

    it("soft-deletes a location left out of the list", async () => {
      const saved = await repo.create(
        riverfront,
        lists({ locations: [{ name: "Block A" }, { name: "Block B" }] }),
        ACTOR,
      );
      const [blockA, blockB] = saved.locations;

      const kept = await repo.save(riverfront, lists({ locations: [{ id: blockB!.id, name: "Block B" }] }), ACTOR);
      expect(kept.locations.map((l) => l.name)).toEqual(["Block B"]);

      const [row] = await db
        .select({ isDeleted: schema.siteLocations.isDeleted })
        .from(schema.siteLocations)
        .where(eq(schema.siteLocations.id, blockA!.id));
      expect(row!.isDeleted).toBe(true);
    });

    it("lets a name be removed and added back in the same save", async () => {
      const saved = await repo.create(riverfront, lists({ locations: [{ name: "Block A" }] }), ACTOR);
      const again = await repo.save(riverfront, lists({ locations: [{ name: "Block A" }] }), ACTOR);
      expect(again.locations).toHaveLength(1);
      expect(again.locations[0]!.id).not.toBe(saved.locations[0]!.id);
    });

    it("refuses a location id that belongs to another site", async () => {
      const theirs = await repo.create(depot, lists({ locations: [{ name: "Their yard" }] }), ACTOR);
      await expect(
        repo.save(riverfront, lists({ locations: [{ id: theirs.locations[0]!.id, name: "Mine now" }] }), ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("replaces the address list outright, dropping repeats", async () => {
      await repo.create(riverfront, lists({ addresses: ["Gate 1", "Gate 2"] }), ACTOR);
      const saved = await repo.save(riverfront, lists({ addresses: ["Gate 3", "Gate 3 "] }), ACTOR);
      expect(saved.addresses.map((a) => a.address)).toEqual(["Gate 3"]);
    });
  });

  describe("the list", () => {
    it("shows only sites that have locations or addresses, with counts and a preview", async () => {
      await repo.create(
        riverfront,
        lists({ locations: [{ name: "Block B" }, { name: "Block A" }], addresses: ["Gate 1"] }),
        ACTOR,
      );
      await repo.create(depot, lists({ addresses: ["NH 48"] }), ACTOR);

      const page = await repo.list(query({ limit: 50 }));
      expect(page.rows).toEqual([
        { id: riverfront, siteName: "Surat Riverfront", locationCount: 2, addressCount: 1, locationNames: ["Block A", "Block B"] },
        { id: depot, siteName: "Valsad Depot", locationCount: 0, addressCount: 1, locationNames: [] },
      ]);
      expect(await repo.total()).toBe(2);
    });

    it("finds a site by one of its location names", async () => {
      await repo.create(riverfront, lists({ locations: [{ name: "Store yard" }] }), ACTOR);
      await repo.create(depot, lists({ locations: [{ name: "Block A" }] }), ACTOR);

      const page = await repo.list(query({ search: "store" }));
      expect(page.rows.map((r) => r.siteName)).toEqual(["Surat Riverfront"]);
      expect(await repo.total("store")).toBe(1);
    });
  });

  describe("deleting", () => {
    it("empties both lists and takes the site off the list, keeping the location rows", async () => {
      await repo.create(riverfront, lists({ locations: [{ name: "Block A" }], addresses: ["Gate 1"] }), ACTOR);
      await repo.remove(riverfront, ACTOR);

      expect(await repo.findBySite(riverfront)).toMatchObject({ locations: [], addresses: [] });
      expect(await repo.total()).toBe(0);
      const rows = await db.select().from(schema.siteLocations);
      expect(rows.map((r) => r.isDeleted)).toEqual([true]);
    });
  });
});
