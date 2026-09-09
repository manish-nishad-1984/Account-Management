import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { ReportSheetColumn } from "@accountmanagement/contracts";
import { writeReportWorkbook, type ReportSheetBlock } from "./report-workbook";

const COLUMNS: ReportSheetColumn[] = [
  { header: "Document", width: 26, align: "left" },
  { header: "Supplier", width: 28, align: "left" },
  { header: "Credit", width: 16, align: "right" },
];

/** The sheet read back as a grid of strings, which is how a person reads it. */
async function readBack(bytes: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  const sheet = workbook.worksheets[0]!;

  const grid: string[][] = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const cells: string[] = [];
    sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => {
      cells.push(cell.value === null || cell.value === undefined ? "" : String(cell.value));
    });
    grid.push(cells);
  }
  return grid;
}

describe("writeReportWorkbook", () => {
  it("writes a caption block above the table, as the legacy sheet does", async () => {
    const bytes = await writeReportWorkbook("Ledger", [
      { kind: "caption", headers: ["Site", "Supplier"], values: ["Akwada", "Om Sagar"] },
      { kind: "table", columns: COLUMNS, rows: [["DHP/1", "Om Sagar", "100.00"]] },
    ]);

    const grid = await readBack(bytes);
    expect(grid[0]).toEqual(["Site", "Supplier"]);
    expect(grid[1]).toEqual(["Akwada", "Om Sagar"]);
    expect(grid[3]).toEqual(["Document", "Supplier", "Credit"]);
    expect(grid[4]).toEqual(["DHP/1", "Om Sagar", "100.00"]);
  });

  it("writes the Total row under the rows it totals", async () => {
    const bytes = await writeReportWorkbook("Ledger", [
      {
        kind: "table",
        columns: COLUMNS,
        rows: [["DHP/1", "Om Sagar", "100.00"]],
        footer: ["Total", "", "100.00"],
      },
    ]);

    const grid = await readBack(bytes);
    expect(grid[2]).toEqual(["Total", "", "100.00"]);
  });

  /**
   * The supplier-grouped export is this shape: a header and a Total per party,
   * which is what the legacy `GetInvoiceDetailsBySupplierExcelReport` writes.
   */
  it("repeats the header for each table block, so a party section stands alone", async () => {
    const blocks: ReportSheetBlock[] = [
      {
        kind: "table",
        columns: COLUMNS,
        rows: [["DHP/1", "Alpha", "100.00"]],
        footer: ["Total", "", "100.00"],
      },
      {
        kind: "table",
        columns: COLUMNS,
        rows: [["DHP/2", "Beta", "200.00"]],
        footer: ["Total", "", "200.00"],
      },
    ];

    const grid = await readBack(await writeReportWorkbook("Ledger by party", blocks));
    const headerRows = grid.filter((row) => row[0] === "Document");
    expect(headerRows).toHaveLength(2);

    const totals = grid.filter((row) => row[0] === "Total").map((row) => row[2]);
    expect(totals).toEqual(["100.00", "200.00"]);
  });

  /**
   * Money stays TEXT, for the reason `workbook.ts` gives at length. The visible
   * cost is that Excel will not sum the column; the alternative is that a
   * stored decimal becomes a binary double inside a file the business
   * reconciles against invoices.
   */
  it("writes amounts as text, not as numbers", async () => {
    const bytes = await writeReportWorkbook("Ledger", [
      { kind: "table", columns: COLUMNS, rows: [["DHP/1", "Om Sagar", "1,23,456.78"]] },
    ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as never);
    const cell = workbook.worksheets[0]!.getRow(2).getCell(3);
    expect(typeof cell.value).toBe("string");
    expect(cell.value).toBe("1,23,456.78");
  });

  it("names the sheet what it was asked to", async () => {
    const bytes = await writeReportWorkbook("Sales report", [
      { kind: "table", columns: COLUMNS, rows: [] },
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as never);
    expect(workbook.worksheets[0]!.name).toBe("Sales report");
  });
});
