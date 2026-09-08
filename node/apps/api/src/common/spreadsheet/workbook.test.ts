import { describe, expect, it } from "vitest";
import { cellText, readWorkbook, writeWorkbook, SpreadsheetError } from "./workbook";

const COLUMNS = [
  { header: "Item Name", width: 30 },
  { header: "Price Per Unit", width: 14 },
];

describe("cellText", () => {
  it("reads the plain types", () => {
    expect(cellText("  Cement  ")).toBe("Cement");
    expect(cellText(27)).toBe("27");
    expect(cellText(27.5)).toBe("27.5");
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText(true)).toBe("TRUE");
  });

  /**
   * The object shapes are the ones a real user file is full of, and the reason
   * this helper exists: `String(value)` on any of them is "[object Object]",
   * which then fails validation with a message about the wrong thing.
   */
  it("reads a formula cell's cached result, not its source", () => {
    expect(cellText({ formula: "B2*1.18", result: 4.86 })).toBe("4.86");
  });

  it("reads an uncached formula as empty rather than as its source text", () => {
    expect(cellText({ formula: "B2*1.18" })).toBe("");
    expect(cellText({ sharedFormula: "B2" })).toBe("");
  });

  it("flattens rich text to what the cell displays", () => {
    expect(cellText({ richText: [{ text: "OPC " }, { text: "53 Grade" }] })).toBe("OPC 53 Grade");
  });

  it("reads a hyperlink cell's text", () => {
    expect(cellText({ text: "sales@x.com", hyperlink: "mailto:sales@x.com" })).toBe("sales@x.com");
  });

  it("reads an error cell as empty", () => {
    expect(cellText({ error: "#N/A" })).toBe("");
  });

  /**
   * "1e+21" is not an amount, and passing it on would be refused by the money
   * validator with a message about decimal places that explains nothing.
   */
  it("refuses exponent-form numbers rather than passing them on", () => {
    expect(cellText(1e21)).toBe("");
    expect(cellText(1e-7)).toBe("");
    expect(cellText(Number.NaN)).toBe("");
    expect(cellText(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("readWorkbook", () => {
  const build = async (rows: string[][]) => writeWorkbook("Items", COLUMNS, rows);

  it("round-trips what writeWorkbook produced", async () => {
    const bytes = await build([
      ["OPC 53 Grade Cement", "395.00"],
      ["TMT Bar 12mm", "62000.00"],
    ]);
    const sheet = await readWorkbook(bytes, 100);

    expect(sheet.header).toEqual(["Item Name", "Price Per Unit"]);
    expect(sheet.rows.map((row) => row.cells)).toEqual([
      ["OPC 53 Grade Cement", "395.00"],
      ["TMT Bar 12mm", "62000.00"],
    ]);
  });

  /**
   * The row number must be the one in Excel's gutter, header included, because
   * that is the number the person fixing the file is looking at.
   */
  it("numbers rows as the spreadsheet does, counting the header", async () => {
    const bytes = await build([["A", "1.00"], ["B", "2.00"]]);
    const sheet = await readWorkbook(bytes, 100);

    expect(sheet.rows.map((row) => row.number)).toEqual([2, 3]);
  });

  it("drops blank rows without shifting the numbers of the rows after them", async () => {
    const bytes = await build([["A", "1.00"], ["", ""], ["C", "3.00"]]);
    const sheet = await readWorkbook(bytes, 100);

    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows.map((row) => row.number)).toEqual([2, 4]);
  });

  it("pads short rows to the header width, so a column index is always safe", async () => {
    const bytes = await build([["A"]]);
    const sheet = await readWorkbook(bytes, 100);

    expect(sheet.rows[0]!.cells).toEqual(["A", ""]);
  });

  it("refuses a file that is not a spreadsheet", async () => {
    await expect(readWorkbook(Buffer.from("not a spreadsheet"), 100)).rejects.toBeInstanceOf(
      SpreadsheetError,
    );
  });

  it("refuses more rows than the cap, naming it", async () => {
    const bytes = await build([["A", "1.00"], ["B", "2.00"], ["C", "3.00"]]);
    await expect(readWorkbook(bytes, 2)).rejects.toThrow(/more than 2 rows/i);
  });
});

describe("writeWorkbook", () => {
  /**
   * Every cell is TEXT, prices included. A price handed to a spreadsheet as a
   * number becomes a binary double in the file, and the catalogue is meant to
   * be round-tripped — download, edit, upload — over values the business
   * reconciles against invoices.
   */
  it("writes prices as text, so the decimal survives the file", async () => {
    const bytes = await writeWorkbook("Items", COLUMNS, [["Item", "1234.56"]]);
    const sheet = await readWorkbook(bytes, 100);

    expect(sheet.rows[0]!.cells[1]).toBe("1234.56");
  });

  it("keeps trailing zeros, which a numeric cell would drop", async () => {
    const bytes = await writeWorkbook("Items", COLUMNS, [["Item", "395.00"]]);
    const sheet = await readWorkbook(bytes, 100);

    expect(sheet.rows[0]!.cells[1]).toBe("395.00");
  });
});
