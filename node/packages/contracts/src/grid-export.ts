import { z } from "zod";

/**
 * "Export to Excel" on a list screen.
 *
 * THE BROWSER ASSEMBLES THE ROWS, THE SERVER MAKES THE FILE. A list screen
 * already knows its own columns and how each one reads (a supplier's location is
 * area plus pincode, an invoice's party is a name looked up from an id), so the
 * screen says what goes in the sheet, and the one place that talks to a
 * spreadsheet library turns it into an `.xlsx`. The alternative — a bespoke
 * export route for each of sixteen screens — is sixteen copies of a list query
 * that can drift from the screen it is meant to mirror.
 *
 * Rows are strings. A figure in a right-aligned column becomes a number in the
 * file; everything else stays text. See `figureOrText` in the API.
 */

/** More than this and the screen is asked to narrow the search instead. */
export const GRID_EXPORT_MAX_ROWS = 20_000;
export const GRID_EXPORT_MAX_COLUMNS = 40;

export const gridExportColumnSchema = z.object({
  header: z.string().max(120),
  /** Width in characters. */
  width: z.number().int().min(4).max(80).default(18),
  align: z.enum(["left", "right"]).default("left"),
});
export type GridExportColumn = z.infer<typeof gridExportColumnSchema>;

export const gridExportRequestSchema = z.object({
  /** Becomes the sheet's name; the server makes it safe for Excel. */
  sheetName: z.string().trim().min(1).max(60),
  /** The file's name without the extension; the server makes it safe. */
  fileName: z.string().trim().min(1).max(80),
  columns: z.array(gridExportColumnSchema).min(1).max(GRID_EXPORT_MAX_COLUMNS),
  rows: z.array(z.array(z.string().max(2000))).max(GRID_EXPORT_MAX_ROWS),
});
export type GridExportRequest = z.infer<typeof gridExportRequestSchema>;
