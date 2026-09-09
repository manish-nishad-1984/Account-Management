import ExcelJS from "exceljs";
import type { ReportSheetColumn } from "@accountmanagement/contracts";

/**
 * Report spreadsheets, which are shaped differently from the master exports.
 *
 * `writeWorkbook` in `workbook.ts` writes ONE table with ONE header row, which
 * is exactly right for the Item Master price list it was built for. A report
 * sheet is a stack of blocks: a caption block naming the filters, then the
 * table, then a Total row — and the supplier-grouped variant repeats the table
 * block once per party. Bending the single-table writer into that shape would
 * have made the item export harder to read for the sake of reuse, so this is a
 * second writer over the same library rather than a more general first one.
 *
 * EVERY CELL IS STILL TEXT, for the reason `workbook.ts` gives at length: money
 * here is a decimal string from PostgreSQL to the browser and back, and handing
 * it to a spreadsheet as a number converts it to a binary double which the file
 * then holds. The legacy report sheets write real numbers, so their Total row
 * is a live SUM that Excel recalculates; ours is a value. That is a real
 * difference and it is the safe direction — a recalculated total that disagrees
 * with the API is the defect this port keeps finding, not a feature.
 */

export type ReportSheetBlock =
  | {
      kind: "caption";
      /** Labels on a dark band, values in bold beneath — the legacy layout. */
      headers: string[];
      values: string[];
    }
  | {
      kind: "table";
      columns: ReportSheetColumn[];
      rows: string[][];
      /** Drawn bold on a light band. Omitted for a section with no total. */
      footer?: string[];
    };

const DARK = "FF1F2937";
const LIGHT = "FFE2E8F0";

export async function writeReportWorkbook(
  sheetName: string,
  blocks: ReportSheetBlock[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Account Book";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName);

  // Column widths come from the FIRST table block. A workbook has one set of
  // column widths whatever its blocks want, and the table is what people read.
  const firstTable = blocks.find((block) => block.kind === "table");
  if (firstTable && firstTable.kind === "table") {
    sheet.columns = firstTable.columns.map((column) => ({ width: column.width }));
  }

  for (const block of blocks) {
    if (block.kind === "caption") {
      const header = sheet.addRow(block.headers);
      header.font = { bold: true, color: { argb: "FFFFFFFF" } };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
      header.alignment = { horizontal: "center" };

      const values = sheet.addRow(block.values);
      values.font = { bold: true };
      values.alignment = { horizontal: "center" };

      sheet.addRow([]);
      continue;
    }

    const header = sheet.addRow(block.columns.map((column) => column.header));
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
    header.alignment = { horizontal: "center" };

    for (const cells of block.rows) {
      const row = sheet.addRow(cells);
      block.columns.forEach((column, index) => {
        row.getCell(index + 1).alignment = { horizontal: column.align };
      });
    }

    if (block.footer) {
      const footer = sheet.addRow(block.footer);
      footer.font = { bold: true };
      footer.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
      block.columns.forEach((column, index) => {
        footer.getCell(index + 1).alignment = { horizontal: column.align };
      });
    }

    sheet.addRow([]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
