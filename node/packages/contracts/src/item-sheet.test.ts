import { describe, expect, it } from "vitest";
import {
  ITEM_SHEET_COLUMNS,
  itemSheetFileName,
  normaliseHeader,
  type ItemSheetColumn,
} from "./item-sheet";

/** The headers the legacy EXPORT writes, verbatim from ItemMasterController.cs:665. */
const LEGACY_EXPORT_HEADERS = ["Item Name", "Unit type", "PricePerUnit", "Gst(%)", "HSN Code"];

/** The column names the legacy IMPORT reads, verbatim from ItemMasterController.cs:264-268. */
const LEGACY_IMPORT_HEADERS = ["ItemName", "UnitType", "PricePerUnit", "GSTPer", "HSNCode"];

/** How the API resolves a header to a column. Mirrors `item-sheet.ts` in the API. */
const columnFor = (header: string): ItemSheetColumn | undefined => {
  const key = normaliseHeader(header);
  return ITEM_SHEET_COLUMNS.find(
    (column) => normaliseHeader(column.header) === key || column.aliases.includes(key),
  );
};

describe("normaliseHeader", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(normaliseHeader("Item Name")).toBe("itemname");
    expect(normaliseHeader("ItemName")).toBe("itemname");
    expect(normaliseHeader("  ITEM   NAME  ")).toBe("itemname");
    expect(normaliseHeader("Gst(%)")).toBe("gst");
    expect(normaliseHeader("HSN Code")).toBe("hsncode");
  });
});

describe("the legacy round trip, which does not close in the source", () => {
  /**
   * The point of the whole feature. In the legacy system four of these five
   * headers do not match what its own importer looks for, so the downloaded
   * file cannot be uploaded back.
   */
  it("accepts every header the legacy EXPORT writes", () => {
    for (const header of LEGACY_EXPORT_HEADERS) {
      expect(columnFor(header), `legacy export header ${header}`).toBeDefined();
    }
  });

  it("accepts every header the legacy IMPORT expects", () => {
    for (const header of LEGACY_IMPORT_HEADERS) {
      expect(columnFor(header), `legacy import header ${header}`).toBeDefined();
    }
  });

  it("maps both legacy spellings of a column to the same field", () => {
    // These are the four that disagree in the source.
    expect(columnFor("Item Name")?.key).toBe(columnFor("ItemName")?.key);
    expect(columnFor("Unit type")?.key).toBe(columnFor("UnitType")?.key);
    expect(columnFor("Gst(%)")?.key).toBe(columnFor("GSTPer")?.key);
    expect(columnFor("HSN Code")?.key).toBe(columnFor("HSNCode")?.key);
  });

  it("round-trips its own headers", () => {
    for (const column of ITEM_SHEET_COLUMNS) {
      expect(columnFor(column.header)?.key).toBe(column.key);
    }
  });
});

describe("the column set", () => {
  it("has no two columns claiming the same normalised header", () => {
    const seen = new Map<string, string>();
    for (const column of ITEM_SHEET_COLUMNS) {
      for (const spelling of [normaliseHeader(column.header), ...column.aliases]) {
        expect(seen.has(spelling), `${spelling} claimed by ${seen.get(spelling)}`).toBe(false);
        seen.set(spelling, column.key);
      }
    }
  });

  it("keeps GST percent and GST amount apart", () => {
    // `GST %` normalises to `gst` and `GST Amount` to `gstamount`. A prefix
    // match rather than an exact one would send both to the same column.
    expect(columnFor("GST %")?.key).toBe("gstPercent");
    expect(columnFor("GST Amount")?.key).toBe("gstAmount");
  });

  it("requires exactly the three columns an item cannot be created without", () => {
    const required = ITEM_SHEET_COLUMNS.filter((column) => column.required).map((c) => c.key);
    expect(required).toEqual(["name", "unitName", "pricePerUnit"]);
  });
});

describe("itemSheetFileName", () => {
  it("is dated, so successive downloads do not overwrite each other", () => {
    expect(itemSheetFileName(new Date("2026-09-08T12:00:00Z"))).toBe("items-2026-09-08.xlsx");
  });
});
