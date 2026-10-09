import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { ReportSheetColumn } from "@accountmanagement/contracts";
import { writeReportWorkbook, type ReportSheetBlock } from "./report-workbook";

const COLUMNS: ReportSheetColumn[] = [
  { header: "Document", width: 26, align: "left" },
  { header: "Supplier", width: 28, align: "left" },
  { header: "Credit", width: 16, align: "right" },
];

/** The sheet read back as a grid. Numbers stay numbers; that is the point of the writer. */
async function readBack(bytes: Buffer): Promise<(string | number)[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  const sheet = workbook.worksheets[0]!;

  const grid: (string | number)[][] = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const cells: (string | number)[] = [];
    sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => {
      cells.push(typeof cell.value === "number" ? cell.value : cell.value === null || cell.value === undefined ? "" : String(cell.value));
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
    expect(grid[4]).toEqual(["DHP/1", "Om Sagar", 100]);
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
    expect(grid[2]).toEqual(["Total", "", 100]);
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
    expect(totals).toEqual([100, 200]);
  });

  /**
   * Figures are NUMBERS (client, 9 Oct 2026), so Excel can sum, sort and filter
   * them. The rows arrive grouped the Indian way for the PDF; the writer strips
   * that. Text columns stay text, whatever they look like.
   */
  it("writes amounts as numbers, with a two-decimal format", async () => {
    const bytes = await writeReportWorkbook("Ledger", [
      { kind: "table", columns: COLUMNS, rows: [["DHP/1", "Om Sagar", "1,23,456.78"]] },
    ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as never);
    const cell = workbook.worksheets[0]!.getRow(2).getCell(3);
    expect(typeof cell.value).toBe("number");
    expect(cell.value).toBe(123456.78);
    expect(cell.numFmt).toBe("#,##0.00");
  });

  it("keeps negatives, and leaves a blank or a label in a money column as text", async () => {
    const bytes = await writeReportWorkbook("Ledger", [
      {
        kind: "table",
        columns: COLUMNS,
        rows: [
          ["DHP/1", "Om Sagar", "-57,820.00"],
          ["DHP/2", "Om Sagar", ""],
        ],
        footer: ["Total", "", "-57,820.00"],
      },
    ]);

    const grid = await readBack(bytes);
    expect(grid[1]![2]).toBe(-57820);
    expect(grid[2]![2] ?? "").toBe("");
    expect(grid[3]![2]).toBe(-57820);
  });

  it("does not turn a document number in a left-aligned column into a number", async () => {
    const bytes = await writeReportWorkbook("Ledger", [
      { kind: "table", columns: COLUMNS, rows: [["0012345", "100", "5.00"]] },
    ]);
    const grid = await readBack(bytes);
    expect(grid[1]![0]).toBe("0012345");
    expect(grid[1]![1]).toBe("100");
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
