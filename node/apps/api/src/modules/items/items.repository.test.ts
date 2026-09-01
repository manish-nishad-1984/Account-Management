import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createItemSchema, listQuerySchema } from "@accountmanagement/contracts";
import { ItemsRepository } from "./items.repository";
import { UnitsRepository } from "./units.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

describe("ItemsRepository and UnitsRepository (real PostgreSQL)", () => {
  let db: Database;
  let items: ItemsRepository;
  let units: UnitsRepository;
  let unitId: number;

  const input = (overrides: Record<string, unknown> = {}) =>
    createItemSchema.parse({
      name: "OPC 53 Grade Cement",
      unitId,
      pricePerUnit: "395.00",
      ...overrides,
    });

  beforeEach(async () => {
    db = await freshDatabase();
    items = new ItemsRepository(db);
    units = new UnitsRepository(db);

    const [unit] = await db
      .insert(schema.units)
      .values({ name: "Bag" })
      .returning({ id: schema.units.id });
    unitId = unit!.id;
  });

  describe("items", () => {
    it("creates an item and returns its unit name on the list row", async () => {
      await items.create(input(), ACTOR);
      const page = await items.list(query());

      expect(page.rows[0]!.unitName).toBe("Bag");
      expect(page.rows[0]!.name).toBe("OPC 53 Grade Cement");
    });

    /**
     * Prices are `numeric` and cross the wire as strings. A price that survives
     * this round trip byte-for-byte is a price that never entered a float.
     */
    it("stores the price as an exact decimal string", async () => {
      const created = await items.create(input({ pricePerUnit: "1234.56" }), ACTOR);
      expect(created.pricePerUnit).toBe("1234.56");

      const reloaded = await items.findById(created.id);
      expect(reloaded.pricePerUnit).toBe("1234.56");
    });

    it("keeps a GST amount exactly as supplied, without recomputing it", async () => {
      // GST arithmetic is unresolved (finding B-2): three jQuery calculators
      // disagree and the business has not said which is right. The server must
      // therefore store what it is given rather than arbitrate.
      const created = await items.create(
        input({ isWithGst: true, gstPercent: "18.00", gstAmount: "71.10" }),
        ACTOR,
      );

      expect(created.gstPercent).toBe("18.00");
      expect(created.gstAmount).toBe("71.10");
    });

    it("finds an item by HSN code as well as by name", async () => {
      await items.create(input({ hsnCode: "25232910" }), ACTOR);
      const page = await items.list(query({ search: "25232910" }));

      expect(page.rows).toHaveLength(1);
    });

    it("refuses two live items whose names differ only by case", async () => {
      await items.create(input({ name: "Binding Wire" }), ACTOR);

      await expect(items.create(input({ name: "binding wire" }), ACTOR)).rejects.toMatchObject({
        status: 409,
      });
    });

    /**
     * `unit_id` is a real foreign key, unlike the ~62 unconstrained reference
     * columns in SQL Server. A bad id must be refused by the database, not
     * accepted and discovered later as a blank unit column.
     */
    it("refuses an item pointing at a unit that does not exist", async () => {
      await expect(items.create(input({ unitId: 99999 }), ACTOR)).rejects.toMatchObject({
        status: 409,
      });
    });

    it("soft-deletes and then treats the item as gone", async () => {
      const created = await items.create(input(), ACTOR);
      await items.remove(created.id, ACTOR);

      await expect(items.findById(created.id)).rejects.toMatchObject({ status: 404 });
      expect(await items.total()).toBe(0);
    });

    it("walks every row exactly once across pages", async () => {
      await db.insert(schema.items).values(
        Array.from({ length: 30 }, (_unused, i) => ({
          name: "Item " + String(i).padStart(2, "0"),
          unitId,
          pricePerUnit: String(100 + i) + ".00",
        })),
      );

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await items.list(query({ limit: 7, cursor }));
        seen.push(...page.rows.map((row) => row.name));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      expect(seen).toHaveLength(30);
      expect(new Set(seen).size).toBe(30);
    });
  });

  describe("units", () => {
    it("counts only live items against a unit", async () => {
      const created = await items.create(input(), ACTOR);
      let page = await units.list(query());
      expect(page.rows[0]!.itemCount).toBe(1);

      await items.remove(created.id, ACTOR);
      page = await units.list(query());
      // The item still points at the unit, but it is deleted, so it does not
      // block the unit — the count and the guard have to agree on that.
      expect(page.rows[0]!.itemCount).toBe(0);
    });

    it("refuses to delete a unit that live items still use", async () => {
      await items.create(input(), ACTOR);

      await expect(units.remove(unitId)).rejects.toMatchObject({ status: 409 });

      const [stillThere] = await db
        .select({ id: schema.units.id })
        .from(schema.units)
        .where(eq(schema.units.id, unitId));
      expect(stillThere).toBeDefined();
    });

    it("deletes an unused unit outright, because units have no soft delete", async () => {
      const created = await units.create({ name: "Quintal" }, ACTOR);
      await units.remove(created.id);

      const rows = await db
        .select({ id: schema.units.id })
        .from(schema.units)
        .where(eq(schema.units.id, created.id));
      expect(rows).toHaveLength(0);
    });

    it("refuses two units with the same name, case-insensitively", async () => {
      await expect(units.create({ name: "bag" }, ACTOR)).rejects.toMatchObject({ status: 409 });
    });

    /**
     * Units have an integer primary key, so the cursor's tiebreaker is a string
     * standing in for an int. This is the case most likely to be broken by a
     * careless change to keyset.ts.
     */
    it("pages correctly despite the integer primary key", async () => {
      await db
        .insert(schema.units)
        .values(Array.from({ length: 25 }, (_unused, i) => ({ name: "Unit " + String(i).padStart(2, "0") })));

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await units.list(query({ limit: 6, cursor }));
        seen.push(...page.rows.map((row) => row.name));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      // 25 created here plus "Bag" from the outer beforeEach.
      expect(seen).toHaveLength(26);
      expect(new Set(seen).size).toBe(26);
    });
  });

  describe("the contract's GST rules", () => {
    it("refuses a GST-inclusive item with no percentage", () => {
      expect(() =>
        createItemSchema.parse({
          name: "X",
          unitId: 1,
          pricePerUnit: "100.00",
          isWithGst: true,
        }),
      ).toThrow();
    });

    it("refuses GST figures left behind on a non-GST item", () => {
      // The dangerous direction: anything reading the columns rather than the
      // flag would still pick these up.
      expect(() =>
        createItemSchema.parse({
          name: "X",
          unitId: 1,
          pricePerUnit: "100.00",
          isWithGst: false,
          gstPercent: "18.00",
        }),
      ).toThrow();
    });

    it("refuses a price with more than two decimal places", () => {
      expect(() =>
        createItemSchema.parse({ name: "X", unitId: 1, pricePerUnit: "100.005" }),
      ).toThrow();
    });

    it("refuses a GST percentage above 100", () => {
      expect(() =>
        createItemSchema.parse({
          name: "X",
          unitId: 1,
          pricePerUnit: "100.00",
          isWithGst: true,
          gstPercent: "180.00",
        }),
      ).toThrow();
    });
  });
});
