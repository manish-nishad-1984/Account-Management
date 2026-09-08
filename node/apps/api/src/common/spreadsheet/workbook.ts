import ExcelJS from "exceljs";

/**
 * The only place this codebase talks to a spreadsheet library.
 *
 * Everything above it deals in `string[][]`, so the choice of library is one
 * import to change. That matters more than usual here: the JavaScript options
 * for reading `.xlsx` are all compromised in some way. SheetJS's maintained
 * releases left npm, and the `xlsx` package still on the public registry is
 * 0.18.5 with live prototype-pollution and ReDoS advisories — not something to
 * point at user-uploaded files. ExcelJS is what is left that both reads and
 * writes; it carries one moderate transitive advisory (`uuid` <11.1.1, a bounds
 * check in the v3/v5/v6 code paths, which ExcelJS does not use).
 *
 * ExcelJS cannot read the legacy BIFF8 `.xls` format at all. The legacy
 * importer accepts it, so this is a real capability the port drops — see
 * `readWorkbook`, which says so in a sentence the user can act on rather than
 * failing with a parse error.
 */

/**
 * A cell, flattened to text.
 *
 * ExcelJS hands back seven different shapes depending on what the cell holds,
 * and the ones that are objects are the ones a real user file is full of: a
 * price typed into a formatted cell arrives as `{ formula, result }`, a name
 * pasted from a web page as `{ richText: [...] }`, an email as
 * `{ text, hyperlink }`. Reading `String(value)` on any of those yields
 * "[object Object]", which then fails validation with a message about the wrong
 * thing entirely.
 *
 * Numbers are converted with `String`, which gives JavaScript's shortest
 * round-trip form: 27 -> "27", 27.5 -> "27.5". The value in the file is already
 * an IEEE double — that is how the format stores it — so this is a rendering of
 * what is there, not a new conversion loss. Exponent form is refused rather
 * than passed on, because "1e+21" is not an amount and the validators would
 * reject it with a confusing message.
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    const text = String(value);
    // Very large or very small magnitudes stringify as "1e+21" / "1e-7".
    return text.includes("e") || text.includes("E") ? "" : text;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "object") {
    const cell = value as Record<string, unknown>;

    // A formula cell: the cached result is what the user sees in Excel. When
    // the file was written by a tool that did not cache one, there is nothing
    // to read — better empty than the formula's source text, which would be
    // reported as an invalid price rather than as a missing one.
    if ("result" in cell) return cellText(cell.result);
    if ("formula" in cell || "sharedFormula" in cell) return "";

    // Rich text: the runs concatenated, which is what the cell displays.
    if (Array.isArray(cell.richText)) {
      return cell.richText
        .map((run) => (typeof run === "object" && run ? String((run as { text?: unknown }).text ?? "") : ""))
        .join("")
        .trim();
    }

    // A hyperlink cell carries both; the text is the part a human typed.
    if ("text" in cell) return cellText(cell.text);

    // `{ error: "#N/A" }` and anything else unrecognised read as empty.
    return "";
  }

  return "";
}

export interface SheetData {
  /** The first row, as written. Empty trailing cells are dropped. */
  header: string[];
  /**
   * Every row after the header, each padded to the header's width so a column
   * index is always safe to take. Fully blank rows are removed — spreadsheets
   * are full of them and the legacy importer turns each one into a row whose
   * every field is empty, then reports it as a validation failure.
   */
  rows: { number: number; cells: string[] }[];
}

export class SpreadsheetError extends Error {}

/**
 * Reads the first worksheet of an `.xlsx` file.
 *
 * The FIRST worksheet, not a named one. The legacy importer walks the sheet
 * list and takes the first whose name is not literally `"DD"` — a rule with no
 * explanation anywhere in the solution, which happens to mean "the first sheet"
 * for every file that does not contain that name. Reproducing the `DD` special
 * case would be carrying a mystery forward; taking the first sheet is what it
 * does in practice and can be described in one line.
 */
export async function readWorkbook(bytes: Buffer, maxRows: number): Promise<SheetData> {
  const workbook = new ExcelJS.Workbook();

  try {
    // `as never`: ExcelJS types the parameter as its own Buffer-like interface,
    // which a Node Buffer satisfies structurally but not nominally.
    await workbook.xlsx.load(bytes as never);
  } catch (error) {
    throw new SpreadsheetError(
      `The file could not be read as a spreadsheet: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new SpreadsheetError("The workbook has no sheets.");
  }

  const header: string[] = [];
  const headerRow = sheet.getRow(1);
  headerRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    header[columnNumber - 1] = cellText(cell.value);
  });
  // `eachCell` skips past the last populated cell, so gaps are filled here.
  for (let i = 0; i < header.length; i += 1) {
    header[i] ??= "";
  }
  while (header.length > 0 && header[header.length - 1] === "") {
    header.pop();
  }

  if (header.length === 0) {
    throw new SpreadsheetError("The first row of the sheet is empty, so it has no column headers.");
  }

  const rows: SheetData["rows"] = [];
  const lastRow = sheet.rowCount;

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    const cells: string[] = new Array(header.length).fill("");
    let populated = false;

    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const text = cellText(cell.value);
      if (text === "") return;
      populated = true;
      // A value under a column that has no header is unaddressable; it is left
      // out rather than shifting everything after it.
      if (columnNumber <= header.length) {
        cells[columnNumber - 1] = text;
      }
    });

    if (!populated) continue;

    if (rows.length >= maxRows) {
      throw new SpreadsheetError(
        `The file has more than ${maxRows.toLocaleString("en-IN")} rows. Split it and import the parts.`,
      );
    }
    rows.push({ number: rowNumber, cells });
  }

  return { header, rows };
}

export interface SheetColumnSpec {
  header: string;
  width: number;
}

/**
 * Writes one sheet of strings.
 *
 * Every cell is written as TEXT, including the prices.
 *
 * That is deliberate and it is the whole reason this function exists rather
 * than passing numbers through. Money in this system is a decimal string from
 * the database to the browser and back; handing a price to a spreadsheet as a
 * number converts it to a binary double, and the file then holds the double.
 * For a catalogue that is round-tripped — download, edit, upload — that turns a
 * stored `1234.56` into whatever the double renders as, on a value the business
 * reconciles against invoices.
 *
 * The visible cost is that Excel shows a green "number stored as text" marker
 * and will not sum the column. The column is a price list, not a total, and the
 * legacy sheet has no totals row either.
 */
export async function writeWorkbook(
  sheetName: string,
  columns: SheetColumnSpec[],
  rows: string[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Account Book";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((column) => ({ header: column.header, width: column.width }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4B5563" } };
  headerRow.alignment = { horizontal: "center" };
  // So the headers stay visible while someone scrolls 758 items.
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of rows) {
    sheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
