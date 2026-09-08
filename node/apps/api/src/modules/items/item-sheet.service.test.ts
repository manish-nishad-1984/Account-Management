import { beforeEach, describe, expect, it } from "vitest";
import { createItemSchema, listQuerySchema } from "@accountmanagement/contracts";
import { ItemSheetRejected, ItemSheetService } from "./item-sheet.service";
import { ItemsRepository } from "./items.repository";
import { readWorkbook, writeWorkbook } from "../../common/spreadsheet/workbook";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";
const UNITS = ["Bag", "Ton", "Nos"];

/** A workbook with our own headers. */
const ourSheet = (rows: string[][]) =>
  writeWorkbook(
    "Items",
    ["Item Name", "Unit Type", "Price Per Unit", "GST %", "GST Amount", "HSN Code"].map(
      (header) => ({ header, width: 20 }),
    ),
    rows,
  );

/** A workbook with the headers the LEGACY exporter writes — five columns, no GST Amount. */
const legacySheet = (rows: string[][]) =>
  writeWorkbook(
    "Items",
    ["Item Name", "Unit type", "PricePerUnit", "Gst(%)", "HSN Code"].map((header) => ({
      header,
      width: 20,
    })),
    rows,
  );

interface Harness {
  db: Database;
  items: ItemsRepository;
  sheets: ItemSheetService;
}

const harness = async (): Promise<Harness> => {
  const db = await freshDatabase();
  await db.insert(schema.units).values(UNITS.map((name) => ({ name })));
  const items = new ItemsRepository(db);
  return { db, items, sheets: new ItemSheetService(items) };
};

const unitId = async (db: Database, name: string): Promise<number> => {
  const rows = await db.select({ id: schema.units.id, name: schema.units.name }).from(schema.units);
  return rows.find((row) => row.name === name)!.id;
};

const names = async (items: ItemsRepository): Promise<string[]> => {
  const page = await items.list(listQuerySchema.parse({ limit: 100, sortBy: "name" }));
  return page.rows.map((row) => row.name);
};

describe("ItemSheetService (real PostgreSQL)", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await harness();
  });

  /**
   * THE test for this feature.
   *
   * In the legacy system the exporter writes `Item Name | Unit type |
   * PricePerUnit | Gst(%) | HSN Code` and the importer reads `ItemName |
   * UnitType | PricePerUnit | GSTPer | HSNCode`. Four of five disagree, so the
   * file the Download button produces cannot be fed to the Upload button beside
   * it — and it fails silently, because the missing column throws per row
   * inside a `catch` that only writes to the console.
   *
   * Exporting from one database and importing into another proves the file is
   * self-sufficient, which is what "the round trip works" actually means.
   */
  it("exports a catalogue that imports back, byte-identical in every value", async () => {
    const bag = await unitId(h.db, "Bag");
    const ton = await unitId(h.db, "Ton");

    await h.items.create(
      createItemSchema.parse({
        name: "OPC 53 Grade Cement",
        unitId: bag,
        pricePerUnit: "395.00",
        isWithGst: true,
        gstPercent: "28",
        gstAmount: "110.60",
        hsnCode: "25232910",
      }),
      ACTOR,
    );
    await h.items.create(
      createItemSchema.parse({ name: "River Sand", unitId: ton, pricePerUnit: "1234.56" }),
      ACTOR,
    );

    const bytes = await h.sheets.export(undefined);

    const target = await harness();
    const result = await target.sheets.import(bytes, ACTOR);

    expect(result).toMatchObject({ rowCount: 2, created: 2, revived: 0, errors: [] });

    const page = await target.items.list(listQuerySchema.parse({ limit: 100, sortBy: "name" }));
    const cement = page.rows.find((row) => row.name === "OPC 53 Grade Cement")!;
    const sand = page.rows.find((row) => row.name === "River Sand")!;

    expect(cement).toMatchObject({
      unitName: "Bag",
      pricePerUnit: "395.00",
      gstPercent: "28.00",
      gstAmount: "110.60",
      hsnCode: "25232910",
      isWithGst: true,
    });
    expect(sand).toMatchObject({
      unitName: "Ton",
      pricePerUnit: "1234.56",
      gstPercent: null,
      gstAmount: null,
      isWithGst: false,
    });
  });

  it("imports a file in the LEGACY export's five-column layout", async () => {
    const bytes = await legacySheet([["Cement", "Bag", "27.00", "18", "25232910"]]);
    const result = await h.sheets.import(bytes, ACTOR);

    expect(result).toMatchObject({ created: 1, errors: [] });

    const page = await h.items.list(listQuerySchema.parse({ limit: 10 }));
    // No GST Amount column, so it is derived — in decimals. 27 at 18% is 4.86,
    // not the 4.859999999999999 that floats give.
    expect(page.rows[0]!.gstAmount).toBe("4.86");
    expect(page.rows[0]!.isWithGst).toBe(true);
  });

  describe("all-or-nothing", () => {
    it("writes nothing when any row is bad, however many are good", async () => {
      const bytes = await ourSheet([
        ["Good One", "Bag", "10.00", "", "", ""],
        ["Bad One", "Nonexistent Unit", "20.00", "", "", ""],
        ["Good Two", "Ton", "30.00", "", "", ""],
      ]);

      await expect(h.sheets.import(bytes, ACTOR)).rejects.toBeInstanceOf(ItemSheetRejected);
      expect(await names(h.items)).toEqual([]);
    });

    it("reports every problem in one response", async () => {
      const bytes = await ourSheet([
        ["First", "Nope", "10.00", "", "", ""],
        ["Second", "Bag", "not a price", "", "", ""],
        ["", "Bag", "30.00", "", "", ""],
      ]);

      const error = await h.sheets.import(bytes, ACTOR).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ItemSheetRejected);
      const result = (error as ItemSheetRejected).result;

      expect(result.errors).toHaveLength(3);
      // Nothing is claimed to have been written.
      expect(result).toMatchObject({ created: 0, revived: 0 });
    });

    /**
     * The cell checks run over the whole file first and the unit and duplicate
     * checks only afterwards, so the errors are FOUND out of order — row 2's
     * unknown unit is discovered after row 4's bad price. Reported that way, a
     * long file's error list jumps around and there is no way to work down it.
     */
    it("reports the problems in row order, not in the order they were found", async () => {
      const bytes = await ourSheet([
        ["First", "Nope", "10.00", "", "", ""], // unit — found in the second pass
        ["Second", "Bag", "not a price", "", "", ""], // cell — found in the first
        ["Third", "Nope", "30.00", "", "", ""], // unit again
        ["", "Bag", "40.00", "", "", ""], // cell again
      ]);

      const error = (await h.sheets
        .import(bytes, ACTOR)
        .catch((e: unknown) => e)) as ItemSheetRejected;

      expect(error.result.errors.map((e) => e.row)).toEqual([2, 3, 4, 5]);
    });
  });

  describe("names that already exist", () => {
    it("refuses a row matching a live item, and says where to change it", async () => {
      const bag = await unitId(h.db, "Bag");
      await h.items.create(
        createItemSchema.parse({ name: "Cement", unitId: bag, pricePerUnit: "1.00" }),
        ACTOR,
      );

      const bytes = await ourSheet([["Cement", "Bag", "999.00", "", "", ""]]);
      const error = (await h.sheets
        .import(bytes, ACTOR)
        .catch((e: unknown) => e)) as ItemSheetRejected;

      expect(error.result.errors[0]!.message).toMatch(/already exists.*Items screen/);

      // And the price was NOT quietly updated.
      const page = await h.items.list(listQuerySchema.parse({ limit: 10 }));
      expect(page.rows[0]!.pricePerUnit).toBe("1.00");
    });

    /**
     * `items` carries a `lower(name)` unique index, so a case-sensitive
     * existence check would pass and the INSERT would then fail on the
     * constraint — turning a row-level message into a whole-file 409. SQL
     * Server's default collation makes the legacy comparison behave this way
     * too, so this reproduces it rather than departing from it.
     */
    it("matches an existing name case-insensitively", async () => {
      const bag = await unitId(h.db, "Bag");
      await h.items.create(
        createItemSchema.parse({ name: "Cement", unitId: bag, pricePerUnit: "1.00" }),
        ACTOR,
      );

      const bytes = await ourSheet([["CEMENT", "Bag", "999.00", "", "", ""]]);
      await expect(h.sheets.import(bytes, ACTOR)).rejects.toBeInstanceOf(ItemSheetRejected);
    });

    it("revives a soft-deleted item and overwrites it, as the source does", async () => {
      const bag = await unitId(h.db, "Bag");
      const created = await h.items.create(
        createItemSchema.parse({ name: "Cement", unitId: bag, pricePerUnit: "1.00" }),
        ACTOR,
      );
      await h.items.remove(created.id, ACTOR);
      expect(await names(h.items)).toEqual([]);

      const bytes = await ourSheet([["Cement", "Ton", "999.00", "", "", "25232910"]]);
      const result = await h.sheets.import(bytes, ACTOR);

      expect(result).toMatchObject({ created: 0, revived: 1, errors: [] });

      const page = await h.items.list(listQuerySchema.parse({ limit: 10 }));
      expect(page.rows[0]).toMatchObject({
        name: "Cement",
        unitName: "Ton",
        pricePerUnit: "999.00",
        hsnCode: "25232910",
      });
      // The same row, not a second one.
      expect(page.rows[0]!.id).toBe(created.id);
    });
  });

  describe("unit resolution", () => {
    it("names the valid units when one is not found", async () => {
      const bytes = await ourSheet([["Cement", "Sacks", "10.00", "", "", ""]]);
      const error = (await h.sheets
        .import(bytes, ACTOR)
        .catch((e: unknown) => e)) as ItemSheetRejected;

      // The legacy message is ": Cement at row 1 does not match any data type."
      // — which names the item rather than the unit, calls a unit a data type,
      // and does not say what would have worked.
      expect(error.result.errors[0]!.message).toMatch(/no unit called "Sacks"/);
      for (const unit of UNITS) {
        expect(error.result.errors[0]!.message).toContain(unit);
      }
    });

    it("matches a unit name whatever its case or padding", async () => {
      const bytes = await ourSheet([["Cement", "  bag  ", "10.00", "", "", ""]]);
      const result = await h.sheets.import(bytes, ACTOR);
      expect(result.created).toBe(1);
    });
  });

  describe("export", () => {
    it("leaves out soft-deleted items", async () => {
      const bag = await unitId(h.db, "Bag");
      const gone = await h.items.create(
        createItemSchema.parse({ name: "Gone", unitId: bag, pricePerUnit: "1.00" }),
        ACTOR,
      );
      await h.items.create(
        createItemSchema.parse({ name: "Here", unitId: bag, pricePerUnit: "2.00" }),
        ACTOR,
      );
      await h.items.remove(gone.id, ACTOR);

      const sheet = await readWorkbook(await h.sheets.export(undefined), 100);
      expect(sheet.rows.map((row) => row.cells[0])).toEqual(["Here"]);
    });

    it("is ordered by name, not by when the row was created", async () => {
      const bag = await unitId(h.db, "Bag");
      for (const name of ["Zinc", "Aggregate", "Mortar"]) {
        await h.items.create(
          createItemSchema.parse({ name, unitId: bag, pricePerUnit: "1.00" }),
          ACTOR,
        );
      }

      const sheet = await readWorkbook(await h.sheets.export(undefined), 100);
      expect(sheet.rows.map((row) => row.cells[0])).toEqual(["Aggregate", "Mortar", "Zinc"]);
    });

    it("honours the list's search box", async () => {
      const bag = await unitId(h.db, "Bag");
      for (const name of ["Cement Bag", "Steel Rod"]) {
        await h.items.create(
          createItemSchema.parse({ name, unitId: bag, pricePerUnit: "1.00" }),
          ACTOR,
        );
      }

      const sheet = await readWorkbook(await h.sheets.export("Steel"), 100);
      expect(sheet.rows.map((row) => row.cells[0])).toEqual(["Steel Rod"]);
    });

    it("writes the header row even when nothing matches, so the file is a template", async () => {
      const sheet = await readWorkbook(await h.sheets.export(undefined), 100);
      expect(sheet.header[0]).toBe("Item Name");
      expect(sheet.rows).toEqual([]);
    });
  });

  it("refuses a sheet with headers and no rows", async () => {
    const bytes = await ourSheet([]);
    await expect(h.sheets.import(bytes, ACTOR)).rejects.toThrow(/headers but no rows/);
  });

  it("refuses a sheet whose required columns are missing, without row noise", async () => {
    const bytes = await writeWorkbook("Items", [{ header: "Item Name", width: 20 }], [["Cement"]]);
    const error = (await h.sheets.import(bytes, ACTOR).catch((e: unknown) => e)) as ItemSheetRejected;

    expect(error.result.errors).toHaveLength(2);
    expect(error.result.errors.every((e) => e.row === 1)).toBe(true);
  });
});
