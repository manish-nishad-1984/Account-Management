import { z } from "zod";
import { optionalUuidId, requiredText, uuidId } from "./fields";
import { rowCapabilitiesSchema } from "./pagination";

/**
 * SITE LOCATIONS — the screen that was Site Groups, renamed and reshaped by the
 * business on 15 Sep 2026.
 *
 * One entry per SITE. The form picks the site, then keeps two independent lists
 * for it: the location NAMES inside the site ("Block A", "Store yard"), and the
 * ADDRESSES deliveries to the site can go to. The business chose two separate
 * lists over an address per name.
 *
 * The permission is still the `group` subject — the legacy `Group` form — because
 * the rights people hold were granted on that form and nothing else checks them.
 */

/** A site as it appears on the list: its name and a preview of its locations. */
export const siteLocationRowSchema = z.object({
  /** The SITE's id. The list is one row per site, so this is the row's identity. */
  id: z.string(),
  siteName: z.string(),
  locationCount: z.number().int().nonnegative(),
  addressCount: z.number().int().nonnegative(),
  /** Up to a handful of location names, so the grid shows what is there. */
  locationNames: z.array(z.string()),
  capabilities: rowCapabilitiesSchema,
});
export type SiteLocationRow = z.infer<typeof siteLocationRowSchema>;

export const SITE_LOCATION_SORT_FIELDS = ["siteName"] as const;
export type SiteLocationSortField = (typeof SITE_LOCATION_SORT_FIELDS)[number];

export const siteLocationSchema = z.object({ id: z.string(), name: z.string() });
export type SiteLocation = z.infer<typeof siteLocationSchema>;

export const siteLocationDetailSchema = z.object({
  siteId: z.string(),
  siteName: z.string(),
  locations: z.array(siteLocationSchema),
  addresses: z.array(z.object({ id: z.string(), address: z.string() })),
});
export type SiteLocationDetail = z.infer<typeof siteLocationDetailSchema>;

/**
 * Writing a site's locations and addresses.
 *
 * A location carries its id back when it already exists, because DOCUMENTS
 * REFERENCE LOCATIONS BY ID: renaming "Block A" to "Block A (East)" must stay the
 * same location, or every order raised against it would lose its name. A name
 * left out of the list is soft-deleted, and the orders keep showing it.
 *
 * Addresses carry no id. No document references them — a document copies the
 * address text it was raised with — so the list is replaced outright.
 */
export const saveSiteLocationsSchema = z.object({
  locations: z
    .array(z.object({ id: optionalUuidId, name: requiredText("Location name", 200) }))
    .max(100, "A site can have at most 100 locations"),
  addresses: z
    .array(requiredText("Address", 500))
    .max(50, "A site can have at most 50 location addresses"),
});
export type SaveSiteLocations = z.infer<typeof saveSiteLocationsSchema>;

/** Creating an entry names the site; editing addresses it in the URL. */
export const createSiteLocationsSchema = saveSiteLocationsSchema.extend({ siteId: uuidId });
export type CreateSiteLocations = z.infer<typeof createSiteLocationsSchema>;
