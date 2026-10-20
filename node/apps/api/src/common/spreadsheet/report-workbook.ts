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
 * FIGURES ARE NUMBERS (client, 9 Oct 2026). Every amount used to be written as
 * text, which Excel flagged with a green "number stored as text" marker and
 * would not sum, sort or filter. A cell in a right-aligned column that is a
 * figure is now a real number with a two-decimal format; see `figureOrText`.
 * The Total row is still the API's own value, not a live SUM: a recalculated
 * total that disagrees with the API is the defect this port keeps finding.
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

/** What a money cell looks like once `formatMoney` has grouped it: `-12,34,567.89`. */
const MONEY_TEXT = /^-?\d[\d,]*(\.\d+)?$/;

/** Two decimals and a thousands separator; Excel shows the grouping its locale uses. */
const MONEY_FORMAT = "#,##0.00";

/**
 * A figure in a right-aligned column is written as a NUMBER, so Excel can sum,
 * sort and filter it. Everything else stays text.
 *
 * The rows are shared with the PDF, which wants them grouped (`12,34,567.89`),
 * so the grouping is stripped here rather than rows being built twice. Amounts
 * have two decimals and stay far inside the 15 digits a double holds exactly, so
 * nothing is lost. A cell that is not a figure — a label, a date, an empty
 * cell — is returned unchanged.
 */
export function figureOrText(text: string, align: "left" | "right"): string | number {
  if (align !== "right" || !MONEY_TEXT.test(text)) return text;
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : text;
}

function writeCells(
  sheet: ExcelJS.Worksheet,
  columns: ReportSheetColumn[],
  cells: string[],
): ExcelJS.Row {
  const row = sheet.addRow(cells.map((text, index) => figureOrText(text, columns[index]?.align ?? "left")));
  columns.forEach((column, index) => {
    const cell = row.getCell(index + 1);
    cell.alignment = { horizontal: column.align };
    if (typeof cell.value === "number") cell.numFmt = MONEY_FORMAT;
  });
  return row;
}

export async function writeReportWorkbook(
  sheetName: string,
  blocks: ReportSheetBlock[],
): Promise<Buffer> {
  return writeReportWorkbookSheets([{ name: sheetName, blocks }]);
}

/**
 * Several sheets in one file, for the Excel export centre (client, 20 Oct 2026).
 * A sheet that is one table with its header on the first row keeps that header
 * on screen while scrolling and has Excel's filter arrows on it.
 */
export async function writeReportWorkbookSheets(
  sheets: { name: string; blocks: ReportSheetBlock[] }[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Account Book";
  workbook.created = new Date();

  for (const { name, blocks } of sheets) {
    const sheet = workbook.addWorksheet(name);
    fillSheet(sheet, blocks);
    const only = blocks.length === 1 ? blocks[0] : undefined;
    if (sheets.length > 1 && only?.kind === "table" && only.columns.length > 0) {
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: only.columns.length } };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

function fillSheet(sheet: ExcelJS.Worksheet, blocks: ReportSheetBlock[]): void {
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
      writeCells(sheet, block.columns, cells);
    }

    if (block.footer) {
      const footer = writeCells(sheet, block.columns, block.footer);
      footer.font = { bold: true };
      footer.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    }

    sheet.addRow([]);
  }
}
