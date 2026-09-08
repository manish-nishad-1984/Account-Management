import { BadRequestException, Injectable } from "@nestjs/common";
import {
  ITEM_SHEET_COLUMNS,
  ITEM_SHEET_MAX_ROWS,
  ITEM_SHEET_SHEET_NAME,
  type CreateItem,
  type ItemSheetError,
  type ItemSheetImportResult,
} from "@accountmanagement/contracts";
import { ItemsRepository } from "./items.repository";
import { duplicateErrors, mapHeader, parseRows, type ParsedItemRow } from "./item-sheet";
import { SpreadsheetError, readWorkbook, writeWorkbook } from "../../common/spreadsheet/workbook";

/**
 * Thrown when a file is well-formed but its contents are not importable.
 *
 * Carries the full error list, so the controller can answer 400 with every
 * problem rather than the first one.
 */
export class ItemSheetRejected extends Error {
  constructor(readonly result: ItemSheetImportResult) {
    super("The spreadsheet could not be imported.");
  }
}

@Injectable()
export class ItemSheetService {
  constructor(private readonly items: ItemsRepository) {}

  /**
   * The catalogue as a spreadsheet — the same columns the import reads.
   *
   * Not "the same columns" by convention: literally `ITEM_SHEET_COLUMNS`, the
   * one list both halves share. This is the fix for the legacy pair, where the
   * exporter's five headers and the importer's five names differ in four
   * places and the downloaded file therefore cannot be uploaded back.
   */
  async export(search: string | undefined): Promise<Buffer> {
    const rows = await this.items.exportRows(search, ITEM_SHEET_MAX_ROWS);

    if (rows.length > ITEM_SHEET_MAX_ROWS) {
      throw new BadRequestException(
        `More than ${ITEM_SHEET_MAX_ROWS.toLocaleString(
          "en-IN",
        )} items match. Narrow the search and export again.`,
      );
    }

    const cells = rows.map((row) => [
      row.name,
      row.unitName,
      row.pricePerUnit,
      row.gstPercent ?? "",
      row.gstAmount ?? "",
      row.hsnCode ?? "",
    ]);

    return writeWorkbook(
      ITEM_SHEET_SHEET_NAME,
      ITEM_SHEET_COLUMNS.map((column) => ({ header: column.header, width: column.width })),
      cells,
    );
  }

  /**
   * Validates a file completely, then writes it, or writes nothing.
   *
   * The order matters and it is the same rule the attachment upload follows:
   * validate everything, then write everything. Validating as it goes would
   * leave a partly-imported catalogue behind a failure message — the user
   * corrects the file and re-uploads, and now every row that DID land is a
   * "already exists" error, so the second attempt fails harder than the first.
   */
  async import(bytes: Buffer, actorId: string): Promise<ItemSheetImportResult> {
    let sheet;
    try {
      sheet = await readWorkbook(bytes, ITEM_SHEET_MAX_ROWS);
    } catch (error) {
      throw new BadRequestException(
        error instanceof SpreadsheetError ? error.message : "The file could not be read.",
      );
    }

    const { index, errors: headerErrors } = mapHeader(sheet.header);
    if (headerErrors.length > 0) {
      // Without the required columns there is nothing to validate row by row,
      // and reporting 700 "Item Name is required" rows under a missing header
      // would bury the one error that matters.
      throw new ItemSheetRejected({
        rowCount: sheet.rows.length,
        created: 0,
        revived: 0,
        errors: headerErrors,
      });
    }

    if (sheet.rows.length === 0) {
      throw new BadRequestException("The sheet has headers but no rows.");
    }

    const parsed = parseRows(sheet, index);
    const errors: ItemSheetError[] = [...parsed.errors, ...duplicateErrors(parsed.rows)];

    const units = await this.items.unitsByName();
    const existing = await this.items.existingByName(parsed.rows.map((row) => row.name));

    const creates: (CreateItem & { name: string })[] = [];
    const revives: { id: string; values: CreateItem }[] = [];

    for (const row of parsed.rows) {
      const unit = units.get(row.unitName.trim().toLowerCase());
      if (!unit) {
        errors.push({
          row: row.rowNumber,
          column: "Unit Type",
          // The legacy message for this is ": <item> at row N does not match
          // any data type." — which names the item rather than the unit, calls
          // a unit a data type, and does not say what the valid answers are.
          message:
            `There is no unit called "${row.unitName}". ` +
            `Use one of: ${[...units.values()].map((u) => u.name).join(", ")}`,
        });
        continue;
      }

      const values = toCreateItem(row, unit.id);
      const match = existing.get(row.name.toLowerCase());

      if (!match) {
        creates.push({ ...values, name: row.name });
        continue;
      }

      if (!match.isDeleted) {
        errors.push({
          row: row.rowNumber,
          column: "Item Name",
          message: `"${match.name}" already exists. Edit it on the Items screen, or remove the row.`,
        });
        continue;
      }

      revives.push({ id: match.id, values });
    }

    const result: ItemSheetImportResult = {
      rowCount: sheet.rows.length,
      created: creates.length,
      revived: revives.length,
      // In row order, which is not the order they were found in: the cell
      // checks run over the whole file first, and the unit and duplicate checks
      // only afterwards, once the database has been read once instead of once
      // per row. Reported unsorted, a file with a bad unit on row 2 and a bad
      // price on row 400 lists row 400 first, and someone working down a long
      // sheet has to hunt. `sort` is stable, so several problems on one row
      // keep the order they were checked in.
      errors: [...errors].sort((a, b) => a.row - b.row),
    };

    if (errors.length > 0) {
      throw new ItemSheetRejected({ ...result, created: 0, revived: 0 });
    }

    await this.items.applyImport(creates, revives, actorId);
    return result;
  }
}

/**
 * A parsed row as the item it will become.
 *
 * TWO deliberate departures from the legacy importer live here, and both are
 * forced rather than chosen.
 *
 * **`isWithGst` is derived, not hard-coded false.** The legacy import writes
 * `IsWithGst = false` while also writing `Gstamount` and `Gstper`, which
 * produces exactly the contradiction `createItemSchema` refuses — GST figures
 * on an item marked as not carrying GST. It is not hypothetical: the production
 * row captured in `legacy-screens/05-item-master.md` has that shape, with
 * IsWithGST off and 18% / ₹4.86 populated beside it. Reproducing it would mean
 * importing rows that our own edit form then refuses to save, so the choice is
 * between weakening the validation and setting the flag honestly. An item with
 * a GST percentage is a GST item.
 *
 * **`isApproved` is true**, which our create form does NOT default to. This one
 * IS the legacy behaviour and is kept on purpose: the legacy list filters on
 * `IsApproved == true`, so an import that left items unapproved would load 758
 * rows that are invisible in the system they came from. Bulk import is the
 * approval — somebody deliberately uploaded the catalogue. Worth a line in
 * front of the business, because it means `item.add` grants in bulk what a
 * single create does not.
 */
function toCreateItem(row: ParsedItemRow, unitId: number): CreateItem {
  return {
    name: row.name,
    unitId,
    pricePerUnit: row.pricePerUnit,
    isWithGst: row.gstPercent !== null,
    gstPercent: row.gstPercent,
    gstAmount: row.gstAmount,
    hsnCode: row.hsnCode,
    isApproved: true,
  };
}
