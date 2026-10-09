import { z } from "zod";
import {
  GRID_EXPORT_MAX_ROWS,
  MAX_PAGE_SIZE,
  formatExportDate,
  listResponseSchema,
  type GridExportRequest,
} from "@accountmanagement/contracts";
import { apiRequest, postForBlob } from "./api-client";
import { saveBlob } from "./download";
import type { ListFilters, ListParams } from "./list-query";

/**
 * "Export to Excel" for a list screen (client, 9 Oct 2026).
 *
 * The screen says what each column of the sheet is; this fetches the WHOLE
 * filtered set the screen is showing — not just the page on screen — and hands
 * it to the server, which makes the file. The same search, sort and filters the
 * grid uses go with it, so the file is what the person is looking at.
 */

export interface ExportColumn<T> {
  header: string;
  /** Width in characters. */
  width?: number;
  /**
   * "right" for a figure. A right-aligned column is written as NUMBERS in the
   * file, so Excel can sum and sort it; everything else stays text.
   */
  align?: "left" | "right";
  /** The cell's text. A figure is a plain decimal — `1234.50`, no grouping. */
  value: (row: T) => string | number | null | undefined;
}

/** A tick-box or flag as people write it in a sheet. */
export const exportYesNo = (value: boolean | null | undefined): string =>
  value === null || value === undefined ? "" : value ? "Yes" : "No";

/** A date as `dd-mm-yyyy`, the way every report sheet writes it. */
export const exportDate = (value: string | null | undefined): string => formatExportDate(value);

/** An amount as a plain decimal string, so the file holds a real number. */
export const exportAmount = (value: string | number | null | undefined): string =>
  value === null || value === undefined || value === "" ? "" : String(value);

const rowSchema = z.custom<never>((value) => typeof value === "object" && value !== null);

/**
 * Every row of the filtered set, page by page.
 *
 * A cursor is only valid for the ordering and filters that produced it, so the
 * same sort, search and filters go on every request. Stops, with a sentence a
 * person can act on, when the set is larger than a sheet should be.
 */
export async function fetchAllRows<T>(
  resource: string,
  params: Partial<Pick<ListParams, "sortBy" | "sortDir" | "search">>,
  filters: ListFilters = {},
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;

  for (;;) {
    const search = new URLSearchParams({ limit: String(MAX_PAGE_SIZE) });
    if (cursor) search.set("cursor", cursor);
    if (params.sortBy) search.set("sortBy", params.sortBy);
    if (params.sortDir) search.set("sortDir", params.sortDir);
    if (params.search) search.set("search", params.search);
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== "") search.set(key, String(value));
    }

    const page = await apiRequest(`/${resource}?${search.toString()}`, {
      schema: listResponseSchema(rowSchema) as unknown as z.ZodType<{
        rows: T[];
        nextCursor: string | null;
        total: number | null;
      }>,
    });

    rows.push(...page.rows);
    if (rows.length > GRID_EXPORT_MAX_ROWS) {
      throw new Error(
        `More than ${GRID_EXPORT_MAX_ROWS.toLocaleString("en-IN")} rows match. ` +
          "Narrow the search or the filters and export again.",
      );
    }
    if (!page.nextCursor || page.rows.length === 0) return rows;
    cursor = page.nextCursor;
  }
}

const cellText = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? "" : String(value);

/** The request the server turns into a file. Separate from the download so it can be tested. */
export function buildExportRequest<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  sheetName: string,
  fileName: string,
): GridExportRequest {
  return {
    sheetName,
    fileName,
    columns: columns.map((column) => ({
      header: column.header,
      width: column.width ?? 18,
      align: column.align ?? "left",
    })),
    rows: rows.map((row) => columns.map((column) => cellText(column.value(row)))),
  };
}

export async function downloadGridExcel<T>({
  resource,
  params,
  filters,
  columns,
  sheetName,
  fileName,
  rows: given,
}: {
  resource: string;
  params?: Partial<Pick<ListParams, "sortBy" | "sortDir" | "search">>;
  filters?: ListFilters;
  columns: ExportColumn<T>[];
  sheetName: string;
  fileName: string;
  /** For a screen that already holds its whole set; skips the fetch. */
  rows?: T[];
}): Promise<void> {
  const rows = given ?? (await fetchAllRows<T>(resource, params ?? {}, filters));
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = await postForBlob(
    "/grid-exports/xlsx",
    buildExportRequest(rows, columns, sheetName, `${fileName}-${stamp}`),
  );
  saveBlob(blob, `${fileName}-${stamp}.xlsx`);
}
