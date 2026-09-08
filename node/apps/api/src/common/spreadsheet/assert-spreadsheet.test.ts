import { describe, expect, it } from "vitest";
import { ITEM_SHEET_MAX_BYTES, assertSpreadsheet } from "./assert-spreadsheet";
import { writeWorkbook } from "./workbook";

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);

describe("assertSpreadsheet", () => {
  it("accepts a real .xlsx", async () => {
    const bytes = await writeWorkbook("Items", [{ header: "Item Name", width: 20 }], [["Cement"]]);
    expect(() => assertSpreadsheet("items.xlsx", bytes)).not.toThrow();
  });

  /**
   * The legacy importer takes `.xls` — `Provider=Microsoft.Jet.OLEDB.4.0` — and
   * no maintained JavaScript library reads BIFF8. That is a capability this
   * port drops, so the message has to carry the remedy rather than fail with
   * "zip is corrupt" from a parser three layers down.
   */
  it("names the legacy .xls format and says how to convert it", () => {
    expect(() => assertSpreadsheet("catalogue.xls", OLE)).toThrow(/Save As.*\.xlsx/s);
  });

  it("detects a legacy .xls even when it has been renamed .xlsx", () => {
    expect(() => assertSpreadsheet("catalogue.xlsx", OLE)).toThrow(/older Excel file/);
  });

  it("refuses an executable whatever it is called", () => {
    expect(() => assertSpreadsheet("items.xlsx", EXE)).toThrow(/is a program/);
  });

  it("refuses a file whose bytes are not an OOXML archive", () => {
    expect(() => assertSpreadsheet("items.xlsx", Buffer.from("Item Name,Price\nCement,395"))).toThrow(
      /not an Excel \.xlsx file/,
    );
  });

  it("refuses an empty file", () => {
    expect(() => assertSpreadsheet("items.xlsx", Buffer.alloc(0))).toThrow(/is empty/);
  });

  it("refuses one larger than the spreadsheet cap, naming the limit", () => {
    const big = Buffer.concat([ZIP, Buffer.alloc(ITEM_SHEET_MAX_BYTES)]);
    expect(() => assertSpreadsheet("items.xlsx", big)).toThrow(/limit for a spreadsheet is 5\.0 MB/);
  });

  /**
   * The cap is lower than the 10 MB attachment cap on purpose: an .xlsx is a
   * zip, so the number that matters is what it expands to, not what arrives.
   */
  it("is stricter than the attachment cap", () => {
    expect(ITEM_SHEET_MAX_BYTES).toBeLessThan(10 * 1024 * 1024);
  });
});
