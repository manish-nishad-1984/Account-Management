import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createAgencySchema, listQuerySchema, updateAgencySchema } from "@accountmanagement/contracts";
import { AgenciesRepository } from "./agencies.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

/** Gujarat with two cities, and Maharashtra with one — so "city in the wrong state" is testable. */
const GUJARAT = 24;
const MAHARASHTRA = 27;
const AHMEDABAD = 1;
const SURAT = 2;
const PUNE = 3;

describe("AgenciesRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: AgenciesRepository;
  let trade: Record<string, number>;

  const input = (overrides: Record<string, unknown> = {}) =>
    createAgencySchema.parse({
      name: "ABC Construction",
      workTypeIds: [trade.Plaster],
      stateId: GUJARAT,
      cityId: AHMEDABAD,
      primaryContact: { name: "Ramesh Patel", mobile: "+91 98765 43210" },
      ...overrides,
    });

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new AgenciesRepository(db);
    await db.insert(schema.countries).values({ id: 1, name: "India" });
    await db.insert(schema.states).values([
      { id: GUJARAT, name: "Gujarat", countryId: 1 },
      { id: MAHARASHTRA, name: "Maharashtra", countryId: 1 },
    ]);
    await db.insert(schema.cities).values([
      { id: AHMEDABAD, name: "Ahmedabad", stateId: GUJARAT },
      { id: SURAT, name: "Surat", stateId: GUJARAT },
      { id: PUNE, name: "Pune", stateId: MAHARASHTRA },
    ]);
    trade = Object.fromEntries((await repo.listWorkTypes()).map((row) => [row.name, row.id]));
  });

  it("starts with the trades migration 0021 seeds, alphabetically", async () => {
    const names = (await repo.listWorkTypes()).map((row) => row.name);
    expect(names).toHaveLength(19);
    expect(names).toContain("Shuttering");
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  describe("create and read back", () => {
    it("keeps the primary contact first and the additional ones in order", async () => {
      const created = await repo.create(
        input({
          workTypeIds: [trade.Painting, trade.Plaster],
          gstNo: "24aaacd1000a1z5",
          additionalContacts: [
            { name: "Site supervisor", designation: "Supervisor", mobile: "9000000001" },
            { name: "Accounts" },
          ],
        }),
        ACTOR,
      );

      expect(created.primaryContact).toMatchObject({ name: "Ramesh Patel", mobile: "+91 98765 43210" });
      expect(created.additionalContacts.map((contact) => contact.name)).toEqual(["Site supervisor", "Accounts"]);
      expect(created.workTypeIds).toEqual([trade.Painting, trade.Plaster].sort((a, b) => a! - b!));
      expect(created.gstNo).toBe("24AAACD1000A1Z5");
      expect(created.isActive).toBe(true);
    });

    it("refuses a city that is not in the chosen state", async () => {
      await expect(repo.create(input({ stateId: GUJARAT, cityId: PUNE }), ACTOR)).rejects.toThrow(
        BadRequestException,
      );
      expect(await db.select().from(schema.agencies)).toHaveLength(0);
    });

    it("refuses a work type that does not exist", async () => {
      await expect(repo.create(input({ workTypeIds: [99999] }), ACTOR)).rejects.toThrow(BadRequestException);
    });

    it("refuses a second live agency with the same name, ignoring case", async () => {
      await repo.create(input(), ACTOR);
      await expect(repo.create(input({ name: "abc construction" }), ACTOR)).rejects.toThrow(ConflictException);
    });

    it("allows the name again once the first is deleted", async () => {
      const first = await repo.create(input(), ACTOR);
      await repo.remove(first.id, ACTOR);
      await expect(repo.create(input(), ACTOR)).resolves.toMatchObject({ name: "ABC Construction" });
    });
  });

  describe("update", () => {
    it("leaves contacts and work types alone when the patch does not mention them", async () => {
      const created = await repo.create(
        input({ additionalContacts: [{ name: "Accounts" }] }),
        ACTOR,
      );
      const updated = await repo.update(created.id, updateAgencySchema.parse({ isActive: false }), ACTOR);

      expect(updated.isActive).toBe(false);
      expect(updated.primaryContact?.name).toBe("Ramesh Patel");
      expect(updated.additionalContacts.map((contact) => contact.name)).toEqual(["Accounts"]);
      expect(updated.workTypeIds).toEqual([trade.Plaster]);
    });

    it("replaces the additional contacts and keeps the primary when only those are sent", async () => {
      const created = await repo.create(input({ additionalContacts: [{ name: "Old" }] }), ACTOR);
      const updated = await repo.update(
        created.id,
        updateAgencySchema.parse({ additionalContacts: [{ name: "New one" }, { name: "New two" }] }),
        ACTOR,
      );
      expect(updated.primaryContact?.name).toBe("Ramesh Patel");
      expect(updated.additionalContacts.map((contact) => contact.name)).toEqual(["New one", "New two"]);
    });

    it("checks a new city against the state already stored", async () => {
      const created = await repo.create(input(), ACTOR);
      await expect(
        repo.update(created.id, updateAgencySchema.parse({ cityId: PUNE }), ACTOR),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("listing", () => {
    beforeEach(async () => {
      await repo.create(input(), ACTOR);
      await repo.create(
        input({
          name: "Shree Shuttering",
          workTypeIds: [trade.Shuttering, trade["Steel Work"]],
          cityId: SURAT,
          primaryContact: { name: "Mahesh Parmar", mobile: "9909988776" },
        }),
        ACTOR,
      );
      await repo.create(
        input({
          name: "BuildRight Solutions",
          workTypeIds: [trade.RCC],
          isActive: false,
          primaryContact: { name: "Dipak Trivedi", mobile: "9727788990" },
        }),
        ACTOR,
      );
    });

    it("shows each row's trades, city, state and primary contact", async () => {
      const page = await repo.list(query());
      const shuttering = page.rows.find((row) => row.name === "Shree Shuttering")!;
      expect(shuttering.workTypes.map((type) => type.name)).toEqual(["Shuttering", "Steel Work"]);
      expect(shuttering).toMatchObject({
        cityName: "Surat",
        stateName: "Gujarat",
        primaryContactName: "Mahesh Parmar",
        primaryContactMobile: "9909988776",
      });
    });

    it.each([
      ["the agency name", "shuttering", ["Shree Shuttering"]],
      ["a contact name", "dipak", ["BuildRight Solutions"]],
      ["a contact number", "98765", ["ABC Construction"]],
      ["a work type", "steel", ["Shree Shuttering"]],
    ])("searches by %s", async (_what, search, expected) => {
      const page = await repo.list(query({ search }));
      expect(page.rows.map((row) => row.name)).toEqual(expected);
      expect(await repo.total(search)).toBe(expected.length);
    });

    it("filters by work type, status and city", async () => {
      const byTrade = await repo.list(query(), { workTypeId: trade.RCC });
      expect(byTrade.rows.map((row) => row.name)).toEqual(["BuildRight Solutions"]);

      const inactive = await repo.list(query(), { isActive: false });
      expect(inactive.rows.map((row) => row.name)).toEqual(["BuildRight Solutions"]);

      const surat = await repo.list(query(), { cityId: SURAT });
      expect(surat.rows.map((row) => row.name)).toEqual(["Shree Shuttering"]);
      expect(await repo.total(undefined, { cityId: SURAT })).toBe(1);
    });

    it("walks every row exactly once across pages", async () => {
      const first = await repo.list(query({ limit: 2 }));
      const second = await repo.list(query({ limit: 2, cursor: first.nextCursor }));
      expect([...first.rows, ...second.rows].map((row) => row.name)).toEqual([
        "ABC Construction",
        "BuildRight Solutions",
        "Shree Shuttering",
      ]);
      expect(second.nextCursor).toBeNull();
    });

    it("counts the tiles and lists only the cities in use", async () => {
      const summary = await repo.summary();
      expect(summary).toMatchObject({ total: 3, active: 2, inactive: 1 });
      expect(summary.cities.map((city) => city.name)).toEqual(["Ahmedabad", "Surat"]);
    });

    it("drops a deleted agency from the list and the tiles", async () => {
      const [target] = await db
        .select({ id: schema.agencies.id })
        .from(schema.agencies)
        .where(eq(schema.agencies.name, "Shree Shuttering"));
      await repo.remove(target!.id, ACTOR);

      expect((await repo.list(query())).rows.map((row) => row.name)).not.toContain("Shree Shuttering");
      expect((await repo.summary()).total).toBe(2);
      await expect(repo.findById(target!.id)).rejects.toThrow(NotFoundException);
    });
  });

  describe("work types", () => {
    it("adds a new trade and refuses the same name again, ignoring case", async () => {
      const created = await repo.createWorkType("Fabrication", ACTOR);
      expect((await repo.listWorkTypes()).map((row) => row.name)).toContain("Fabrication");
      expect(created.id).toBeGreaterThan(0);
      await expect(repo.createWorkType("fabrication", ACTOR)).rejects.toThrow(ConflictException);
    });
  });
});
