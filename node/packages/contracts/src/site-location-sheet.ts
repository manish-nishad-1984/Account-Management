import { z } from "zod";

/**
 * "Import locations" (client, 12 Oct 2026, reshaped 14 Oct 2026): a spreadsheet of
 * a site's locations and their addresses.
 *
 * TWO COLUMNS, NO INVOICE. The first version named an invoice by number and
 * supplier; the client then dropped those columns, which leaves the sheet as the
 * pair the Site Location screen already holds — a location name and its Location
 * Address — applied to ONE site (the one chosen in the top header).
 *
 * A name the site already has takes the sheet's address; a new name is added. A
 * blank address cell leaves an existing location's address as it is. Nothing is
 * ever removed.
 */
export const SITE_LOCATION_SHEET_COLUMNS = [
  { key: "siteLocation", header: "Site location", required: true },
  { key: "locationAddress", header: "Location Address", required: false },
] as const;

export const SITE_LOCATION_SHEET_MAX_ROWS = 5_000;
export const SITE_LOCATION_SHEET_ACCEPT = ".xlsx";
export const SITE_LOCATION_ADDRESS_MAX = 500;

export const siteLocationSheetResultSchema = z.object({
  rowCount: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  /** Spreadsheet row numbers, as Excel shows them. Any error means nothing was saved. */
  errors: z.array(
    z.object({
      row: z.number().int().nonnegative(),
      column: z.string().nullable(),
      message: z.string(),
    }),
  ),
});
export type SiteLocationSheetResult = z.infer<typeof siteLocationSheetResultSchema>;
