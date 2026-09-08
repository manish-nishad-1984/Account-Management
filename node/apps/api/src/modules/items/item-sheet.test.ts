import { describe, expect, it } from "vitest";
import type { ItemSheetKey } from "@accountmanagement/contracts";
import { duplicateErrors, mapHeader, parseRows } from "./item-sheet";
import type { SheetData } from "../../common/spreadsheet/workbook";

const OURS = ["Item Name", "Unit Type", "Price Per Unit", "GST %", "GST Amount", "HSN Code"];

const sheetOf = (header: string[], rows: string[][]): SheetData => ({
  header,
  rows: rows.map((cells, i) => ({ number: i + 2, cells })),
});

/** Parses with our own header layout, which is what the export writes. */
const parse = (rows: string[][], header: string[] = OURS) => {
  const sheet = sheetOf(header, rows);
  const { index, errors } = mapHeader(sheet.header);
  expect(errors).toEqual([]);
  return parseRows(sheet, index);
};

describe("mapHeader", () => {
  it("finds every column of our own sheet", () => {
    const { index, errors } = mapHeader(OURS);
    expect(errors).toEqual([]);
    expect([...index.keys()].sort()).toEqual(
      ["gstAmount", "gstPercent", "hsnCode", "name", "pricePerUnit", "unitName"] as ItemSheetKey[],
    );
  });

  it("finds the columns of a file the LEGACY system exported", () => {
    // Verbatim from ItemMasterController.cs:665 — the file its own importer
    // cannot read.
    const { index, errors } = mapHeader([
      "Item Name",
      "Unit type",
      "PricePerUnit",
      "Gst(%)",
      "HSN Code",
    ]);
    expect(errors).toEqual([]);
    expect(index.has("name")).toBe(true);
    expect(index.has("unitName")).toBe(true);
    expect(index.has("pricePerUnit")).toBe(true);
    expect(index.has("gstPercent")).toBe(true);
    expect(index.has("hsnCode")).toBe(true);
  });

  it("finds the columns of a file built for the LEGACY importer", () => {
    const { errors } = mapHeader(["ItemName", "UnitType", "PricePerUnit", "GSTPer", "HSNCode"]);
    expect(errors).toEqual([]);
  });

  it("names every missing required column at once", () => {
    const { errors } = mapHeader(["Item Name"]);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.column)).toEqual(["Unit Type", "Price Per Unit"]);
  });

  it("refuses a duplicated column rather than silently taking the first", () => {
    const { errors } = mapHeader([...OURS, "Price Per Unit"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/appears twice, in columns 3 and 7/);
  });

  /** A maintained catalogue grows working columns; they are none of our business. */
  it("ignores columns it does not recognise", () => {
    const { errors, index } = mapHeader([...OURS, "Supplier Code", "Notes"]);
    expect(errors).toEqual([]);
    expect(index.size).toBe(6);
  });
});

describe("parseRows", () => {
  it("parses a clean row", () => {
    const { rows, errors } = parse([["Cement", "Bag", "395.00", "18", "71.10", "25232910"]]);

    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      rowNumber: 2,
      name: "Cement",
      unitName: "Bag",
      pricePerUnit: "395.00",
      gstPercent: "18",
      gstAmount: "71.10",
      hsnCode: "25232910",
      gstAmountDerived: false,
    });
  });

  /**
   * `Convert.ToDecimal` in the legacy importer throws on both of these, into a
   * `catch` that logs to the console and drops the row — and then reports the
   * import as a success with those items missing.
   */
  it("accepts the currency symbols and separators a real sheet contains", () => {
    const { rows, errors } = parse([["Steel", "Ton", "₹ 62,000.00", "18%", "", "7214"]]);

    expect(errors).toEqual([]);
    expect(rows[0]!.pricePerUnit).toBe("62000.00");
    expect(rows[0]!.gstPercent).toBe("18");
  });

  it("handles Indian digit grouping", () => {
    const { rows } = parse([["Steel", "Ton", "1,23,456.78", "", "", ""]]);
    expect(rows[0]!.pricePerUnit).toBe("123456.78");
  });

  /**
   * The one piece of arithmetic in the import, and it is done in decimals on
   * BigInt. `27 * 18 / 100` in JavaScript floats is 4.859999999999999.
   */
  it("derives the GST amount when the column is absent, in decimals", () => {
    const { rows } = parse(
      [["Item", "Nos", "27.00", "18", ""]],
      ["Item Name", "Unit Type", "Price Per Unit", "GST %"],
    );

    expect(rows[0]!.gstAmount).toBe("4.86");
    expect(rows[0]!.gstAmountDerived).toBe(true);
  });

  /**
   * The reason `GST Amount` is a column at all. If the export omitted it and
   * the import derived it, a download-edit-upload cycle would rewrite every
   * stored GST amount in the catalogue with a computed one — answering finding
   * B-2 by accident, in bulk.
   */
  it("keeps a supplied GST amount even when it disagrees with the percentage", () => {
    const { rows } = parse([["Item", "Nos", "27.00", "18", "5.00", ""]]);

    expect(rows[0]!.gstAmount).toBe("5.00");
    expect(rows[0]!.gstAmountDerived).toBe(false);
  });

  it("reports every bad row, not just the first", () => {
    const { errors } = parse([
      ["", "Bag", "395.00", "", "", ""],
      ["Steel", "", "62000.00", "", "", ""],
      ["Sand", "Cft", "not a price", "", "", ""],
      ["Brick", "Nos", "4.50", "", "", "12"],
    ]);

    expect(errors).toHaveLength(4);
    expect(errors.map((e) => e.row)).toEqual([2, 3, 4, 5]);
    expect(errors.map((e) => e.column)).toEqual([
      "Item Name",
      "Unit Type",
      "Price Per Unit",
      "HSN Code",
    ]);
  });

  it("reports the spreadsheet row number, header included", () => {
    const { errors } = parse([
      ["Good", "Bag", "1.00", "", "", ""],
      ["Bad", "Bag", "oops", "", "", ""],
    ]);

    // Second data row = row 3 in Excel's gutter. The legacy message would say 2.
    expect(errors[0]!.row).toBe(3);
  });

  it("refuses a GST amount with no percentage behind it", () => {
    const { errors } = parse([["Item", "Nos", "27.00", "", "4.86", ""]]);

    expect(errors).toHaveLength(1);
    expect(errors[0]!.column).toBe("GST %");
    expect(errors[0]!.message).toMatch(/GST amount but no GST percentage/);
  });

  it("accepts a row with no GST at all", () => {
    const { rows, errors } = parse([["Sand", "Cft", "45.00", "", "", ""]]);

    expect(errors).toEqual([]);
    expect(rows[0]!.gstPercent).toBeNull();
    expect(rows[0]!.gstAmount).toBeNull();
  });

  it("only reports one problem per row, so a blank row is not four errors", () => {
    const { errors } = parse([["", "", "", "", "", ""]]);
    expect(errors.map((e) => e.column)).toEqual(["Item Name", "Unit Type", "Price Per Unit"]);
  });
});

describe("duplicateErrors", () => {
  const row = (rowNumber: number, name: string) => ({
    rowNumber,
    name,
    unitName: "Bag",
    pricePerUnit: "1.00",
    gstPercent: null,
    gstAmount: null,
    hsnCode: null,
    gstAmountDerived: false,
  });

  /**
   * The legacy check is a `HashSet<string>` on the raw name, so it misses this
   * pair and the database refuses the second row instead — by which point the
   * message no longer says which rows collided.
   */
  it("catches a duplicate that differs only in case", () => {
    const errors = duplicateErrors([row(2, "Cement"), row(7, "CEMENT")]);

    expect(errors).toHaveLength(1);
    expect(errors[0]!.row).toBe(7);
    expect(errors[0]!.message).toMatch(/also on row 2/);
  });

  it("is quiet when every name is distinct", () => {
    expect(duplicateErrors([row(2, "Cement"), row(3, "Steel")])).toEqual([]);
  });
});
