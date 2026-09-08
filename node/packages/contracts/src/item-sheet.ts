import { z } from "zod";

/**
 * The Item Master spreadsheet — ONE column set, shared by export and import.
 *
 * The legacy system has both halves and they do not fit together. The export
 * (`ItemMasterController.DownloadItemListDemoExcelFile`) writes the headers
 *
 *     Item Name | Unit type | PricePerUnit | Gst(%) | HSN Code
 *
 * and the import (`ItemMasterController.ImportExcelFile`) reads its columns by
 * the names
 *
 *     ItemName | UnitType | PricePerUnit | GSTPer | HSNCode
 *
 * Four of the five do not match. So the file the "Download File" button
 * produces cannot be fed back to the "Upload File" button beside it —
 * download-edit-upload, which is the entire reason a pair of buttons exists on
 * a screen holding 758 items, has never worked. It fails silently, too: the
 * missing column throws per row inside a `catch` that writes to
 * `Console.WriteLine` and continues, so every row is dropped and the user is
 * told "Failed to insert item details".
 *
 * The fix is not to pick one of the two spellings. It is to have ONE list, in
 * the contracts package, that the exporter writes and the importer reads — so
 * the two cannot drift again without a test failing.
 *
 * Headers are matched leniently on the way in (see `normaliseHeader`), which
 * costs nothing and means a file produced by the OLD system — in either of its
 * two spellings — still imports.
 */

export type ItemSheetKey =
  | "name"
  | "unitName"
  | "pricePerUnit"
  | "gstPercent"
  | "gstAmount"
  | "hsnCode";

export interface ItemSheetColumn {
  key: ItemSheetKey;
  /** What the export writes, and what a user reading the file sees. */
  header: string;
  /**
   * Extra NORMALISED spellings the import accepts. The column's own header is
   * always accepted and is not repeated here.
   */
  aliases: readonly string[];
  /** A missing required column is a whole-file error, not a per-row one. */
  required: boolean;
  width: number;
}

/**
 * Normalises a header for matching: lower case, letters and digits only.
 *
 * This is what makes `Item Name`, `ItemName` and `ITEM NAME` the same column,
 * and it is why most of the legacy mismatch needs no alias at all —
 * `Unit type` and `UnitType` both normalise to `unittype`. Only the GST column
 * genuinely disagrees (`Gst(%)` -> `gst`, `GSTPer` -> `gstper`), so only that
 * one carries aliases.
 */
export const normaliseHeader = (header: string): string =>
  header.toLowerCase().replace(/[^a-z0-9]/g, "");

export const ITEM_SHEET_COLUMNS: readonly ItemSheetColumn[] = [
  { key: "name", header: "Item Name", aliases: [], required: true, width: 42 },
  { key: "unitName", header: "Unit Type", aliases: ["unit", "unitname"], required: true, width: 16 },
  {
    key: "pricePerUnit",
    header: "Price Per Unit",
    aliases: ["price", "rate"],
    required: true,
    width: 16,
  },
  {
    key: "gstPercent",
    header: "GST %",
    // `Gst(%)` normalises to `gst`, which is the legacy EXPORT's spelling, and
    // `GSTPer` is the legacy IMPORT's. Both land here.
    aliases: ["gstper", "gstpercent", "gstpercentage", "gstrate"],
    required: false,
    width: 10,
  },
  {
    key: "gstAmount",
    header: "GST Amount",
    aliases: ["gstamt", "gstvalue"],
    required: false,
    width: 14,
  },
  { key: "hsnCode", header: "HSN Code", aliases: ["hsn", "hsnsac"], required: false, width: 14 },
];

/**
 * `GST Amount` is a column DELIBERATELY, even though the legacy sheet has none.
 *
 * The legacy importer derives it — `pricePerUnit / 100 * gstper` — and stores
 * the result. If our exporter left the column out and our importer derived it
 * the same way, then downloading the catalogue and uploading it back would
 * silently REWRITE every stored GST amount with a computed one. GST is stored
 * and never computed in this system (see `items.ts`), precisely because which
 * calculator is correct is still open as finding B-2; a round trip that quietly
 * recomputes it would answer that question by accident, in bulk, across the
 * whole catalogue.
 *
 * So the export writes what is stored, and the import uses the column when it
 * is present. Deriving only happens when the column is absent — which is
 * exactly the legacy file, where there is nothing to preserve.
 */
export const ITEM_SHEET_SHEET_NAME = "Items";

/** The file the export produces. Dated, like the legacy one. */
export const itemSheetFileName = (now: Date): string => {
  const stamp = now.toISOString().slice(0, 10);
  return `items-${stamp}.xlsx`;
};

/**
 * A cap on the import, so a wrong file cannot become a long transaction.
 *
 * The live catalogue is 758 items. 20,000 is far beyond any real edit and still
 * small enough to validate and insert in one go, which is what lets the import
 * stay all-or-nothing.
 */
export const ITEM_SHEET_MAX_ROWS = 20_000;

export const ITEM_SHEET_ACCEPT = ".xlsx";

/**
 * One thing wrong with one cell.
 *
 * `row` is the SPREADSHEET row number — the number showing in Excel's gutter,
 * header row included — not an index into the parsed data. The legacy message
 * reports `itemDetailsList.IndexOf(itemDetails) + 1`, which is off by one
 * against the file the user is looking at because it does not count the header,
 * so "row 4" sends them to row 5. Someone fixing a 700-row sheet needs the
 * number to be the one on their screen.
 */
export const itemSheetErrorSchema = z.object({
  row: z.number().int().nonnegative(),
  /** The header of the offending column, or null for a whole-row problem. */
  column: z.string().nullable(),
  message: z.string(),
});
export type ItemSheetError = z.infer<typeof itemSheetErrorSchema>;

/**
 * What an import did, or would have done.
 *
 * The import is ALL-OR-NOTHING and reports EVERY error at once. The legacy
 * version returns on the first bad row with a single sentence, so a catalogue
 * with fifteen unknown units takes fifteen upload-and-wait cycles to clean.
 * Collecting the failures costs one pass over data already in memory.
 */
export const itemSheetImportResultSchema = z.object({
  /** Data rows found in the file, header excluded. */
  rowCount: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  /** Previously deleted items brought back and overwritten — see below. */
  revived: z.number().int().nonnegative(),
  errors: z.array(itemSheetErrorSchema),
});
export type ItemSheetImportResult = z.infer<typeof itemSheetImportResultSchema>;
