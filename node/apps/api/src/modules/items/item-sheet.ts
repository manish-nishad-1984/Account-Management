import { money } from "@accountmanagement/domain";
import {
  ITEM_SHEET_COLUMNS,
  hsnCode as hsnCodeSchema,
  normaliseHeader,
  optionalMoney,
  optionalPercent,
  money as moneySchema,
  requiredText,
  type ItemSheetColumn,
  type ItemSheetError,
  type ItemSheetKey,
} from "@accountmanagement/contracts";
import type { SheetData } from "../../common/spreadsheet/workbook";

/** One row of the file, parsed and validated but not yet resolved against the database. */
export interface ParsedItemRow {
  /** The row number showing in Excel's gutter. */
  rowNumber: number;
  name: string;
  unitName: string;
  pricePerUnit: string;
  gstPercent: string | null;
  gstAmount: string | null;
  hsnCode: string | null;
  /** True when `gstAmount` was derived rather than read from a column. */
  gstAmountDerived: boolean;
}

export interface ParseResult {
  rows: ParsedItemRow[];
  errors: ItemSheetError[];
}

const columnFor = (header: string): ItemSheetColumn | undefined => {
  const key = normaliseHeader(header);
  return ITEM_SHEET_COLUMNS.find(
    (column) => normaliseHeader(column.header) === key || column.aliases.includes(key),
  );
};

/**
 * Strips the decoration people put in spreadsheet cells.
 *
 * `₹ 1,23,456.78` and `18%` are what a maintained catalogue actually contains,
 * and `Convert.ToDecimal` in the legacy importer throws on both — into the
 * per-row `catch` that logs to the console and drops the row. The user is then
 * told the import succeeded, with those items missing.
 *
 * Only symbols are removed. Anything else stays and is refused by the validator
 * with a message naming the column, so a genuinely wrong value is still an
 * error rather than being silently coerced.
 */
const stripDecoration = (value: string): string =>
  value
    .replace(/[₹\s,]/g, "")
    .replace(/%$/, "")
    .trim();

/**
 * Resolves the header row to column positions.
 *
 * Returns errors rather than throwing, so a file with three missing columns
 * says so in one response. Duplicate columns are an error too: with two
 * `Price Per Unit` columns there is no defensible way to pick one, and reading
 * the first silently would import prices from a column the user thinks they
 * deleted.
 */
export function mapHeader(header: string[]): {
  index: Map<ItemSheetKey, number>;
  errors: ItemSheetError[];
} {
  const index = new Map<ItemSheetKey, number>();
  const errors: ItemSheetError[] = [];
  const seen = new Map<ItemSheetKey, number>();

  header.forEach((text, position) => {
    if (text.trim() === "") return;
    const column = columnFor(text);
    if (!column) return; // Unknown columns are ignored, not an error — see below.

    const first = seen.get(column.key);
    if (first !== undefined) {
      errors.push({
        row: 1,
        column: column.header,
        message: `"${column.header}" appears twice, in columns ${first + 1} and ${
          position + 1
        }. Remove one.`,
      });
      return;
    }
    seen.set(column.key, position);
    index.set(column.key, position);
  });

  for (const column of ITEM_SHEET_COLUMNS) {
    if (column.required && !index.has(column.key)) {
      errors.push({
        row: 1,
        column: column.header,
        message: `The sheet has no "${column.header}" column.`,
      });
    }
  }

  return { index, errors };
}

/**
 * Unknown columns are IGNORED, deliberately.
 *
 * A catalogue maintained in Excel grows working columns — a supplier's code, a
 * note, last year's price. Refusing the file because of them would make the
 * feature unusable for the people who most need it, and there is no risk in
 * skipping a column nothing reads.
 */

const asOptional = (value: string): string | null => (value === "" ? null : value);

/**
 * Validates every row, collecting failures instead of stopping at the first.
 *
 * The legacy import returns on the first bad row, so a catalogue with fifteen
 * unknown unit names takes fifteen upload-fix-upload cycles. Every row is
 * checked here and the whole list comes back at once; the import is still
 * all-or-nothing, so nothing is written while any error stands.
 */
export function parseRows(sheet: SheetData, index: Map<ItemSheetKey, number>): ParseResult {
  const rows: ParsedItemRow[] = [];
  const errors: ItemSheetError[] = [];

  const at = (cells: string[], key: ItemSheetKey): string => {
    const position = index.get(key);
    return position === undefined ? "" : (cells[position] ?? "").trim();
  };

  const header = (key: ItemSheetKey): string =>
    ITEM_SHEET_COLUMNS.find((column) => column.key === key)!.header;

  for (const row of sheet.rows) {
    const before = errors.length;
    const fail = (key: ItemSheetKey | null, message: string) =>
      errors.push({ row: row.number, column: key ? header(key) : null, message });

    const check = <T>(
      key: ItemSheetKey,
      schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: unknown } },
      raw: string,
    ): T | undefined => {
      const result = schema.safeParse(raw);
      if (result.success) return result.data;
      const issues = (result.error as { issues?: { message: string }[] } | undefined)?.issues ?? [];
      fail(key, issues[0]?.message ?? `${header(key)} is not valid`);
      return undefined;
    };

    const name = check("name", requiredText("Item name", 200), at(row.cells, "name"));

    const unitName = at(row.cells, "unitName");
    if (unitName === "") {
      fail("unitName", "Unit type is required");
    }

    const price = check(
      "pricePerUnit",
      moneySchema("Price per unit"),
      stripDecoration(at(row.cells, "pricePerUnit")),
    );

    const gstPercentRaw = stripDecoration(at(row.cells, "gstPercent"));
    const gstPercent = check("gstPercent", optionalPercent("GST percentage"), gstPercentRaw);

    const gstAmountRaw = stripDecoration(at(row.cells, "gstAmount"));
    const gstAmountGiven = check("gstAmount", optionalMoney("GST amount"), gstAmountRaw);

    const hsn = check("hsnCode", hsnCodeSchema, at(row.cells, "hsnCode"));

    if (errors.length !== before) continue;

    const percent = gstPercent ?? null;
    let gstAmount = gstAmountGiven ?? null;
    let gstAmountDerived = false;

    // Derive ONLY when the column is absent or blank and there is a percentage
    // to derive from. When the file carries a GST Amount, that value is stored
    // as given: GST is stored and never computed in this system, and a round
    // trip that recomputed it would rewrite the whole catalogue's tax figures
    // on a question (finding B-2) the business has not answered.
    if (gstAmount === null && percent !== null && price !== undefined) {
      // In decimals, on BigInt. The legacy expression is
      // `pricePerUnit / 100 * gstper` in C# `decimal`, which is exact there;
      // the same expression in JavaScript floats is not, and 27 at 18% would
      // come out 4.859999999999999.
      gstAmount = money.format(money.percentOf(money.decimal(percent), money.decimal(price)));
      gstAmountDerived = true;
    }

    if (gstAmount !== null && percent === null) {
      fail(
        "gstPercent",
        "This row has a GST amount but no GST percentage. Add the percentage, or clear the amount.",
      );
      continue;
    }

    rows.push({
      rowNumber: row.number,
      name: name!,
      unitName,
      pricePerUnit: price!,
      gstPercent: percent,
      gstAmount,
      hsnCode: asOptional(hsn ?? ""),
      gstAmountDerived,
    });
  }

  return { rows, errors };
}

/**
 * Rows that name the same item twice.
 *
 * Case-insensitively, because `items.name` carries a `lower(name)` unique index
 * and because a catalogue kept in a spreadsheet accumulates case drift —
 * `Cement` and `CEMENT` are one item to everybody except a case-sensitive
 * comparison. The legacy check is `HashSet<string>` on the raw name, so it
 * misses exactly this pair and then fails on the database instead, after the
 * error message has stopped being useful.
 */
export function duplicateErrors(rows: ParsedItemRow[]): ItemSheetError[] {
  const firstSeen = new Map<string, number>();
  const errors: ItemSheetError[] = [];

  for (const row of rows) {
    const key = row.name.toLowerCase();
    const first = firstSeen.get(key);
    if (first === undefined) {
      firstSeen.set(key, row.rowNumber);
      continue;
    }
    errors.push({
      row: row.rowNumber,
      column: "Item Name",
      message: `"${row.name}" is also on row ${first}. Each item may appear once.`,
    });
  }

  return errors;
}
