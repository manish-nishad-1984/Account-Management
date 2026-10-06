import { z } from "zod";
import { optionalUuidId, uuidId } from "./fields";
import { rowCapabilitiesSchema } from "./pagination";

/**
 * SITE LOCATIONS — the screen that was Site Groups, renamed and reshaped by the
 * business on 15 Sep 2026.
 *
 * One entry per SITE. The form picks the site, then keeps ONE list for it: a
 * location and the address deliveries to it go to, entered together as a PAIR.
 *
 * THE BUSINESS REVERSED ITSELF, and the history is worth keeping. On 15 Sep 2026
 * it chose two independent lists — names in one, addresses in the other — over an
 * address per name. On 17 Sep it asked for the pair instead. The second answer is
 * the better one: "Block A" and "Plot 5, Bardoli Road" are one place, and two
 * lists could not say which address belonged to which block, which is exactly
 * what a delivery needs to know.
 *
 * ONE ADDRESS PER LOCATION, not many. The business chose the strict pair.
 *
 * EITHER HALF MAY BE BLANK. The rows migrated from the old two-list shape have an
 * address and no name — there was no record of which name went with which
 * address, and inventing one would have put a wrong address on a live site. They
 * are carried across for someone to name on screen. A row with BOTH halves blank
 * is dropped on save.
 *
 * The permission is still the `group` subject — the legacy `Group` form — because
 * the rights people hold were granted on that form and nothing else checks them.
 */

/** A site as it appears on the list: its name and a preview of its locations. */
export const siteLocationRowSchema = z.object({
  /** The SITE's id. The list is one row per site, so this is the row's identity. */
  id: z.string(),
  siteName: z.string(),
  /** How many pairs the site has. */
  locationCount: z.number().int().nonnegative(),
  /**
   * How many of those pairs have an address filled in.
   *
   * It is a PROGRESS figure now rather than a second list's length: after the
   * migration a site can hold pairs with no address and pairs with no name, and
   * "7 locations, 3 with an address" is the thing someone tidying this up needs
   * to see from the list.
   */
  addressCount: z.number().int().nonnegative(),
  /** Up to a handful of location names, so the grid shows what is there. */
  locationNames: z.array(z.string()),
  capabilities: rowCapabilitiesSchema,
});
export type SiteLocationRow = z.infer<typeof siteLocationRowSchema>;

export const SITE_LOCATION_SORT_FIELDS = ["siteName"] as const;
export type SiteLocationSortField = (typeof SITE_LOCATION_SORT_FIELDS)[number];

export const siteLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** "" where nobody has given this location an address yet. */
  address: z.string(),
});
export type SiteLocation = z.infer<typeof siteLocationSchema>;

/**
 * A location as a DOCUMENT sees it: just enough to name it in a select.
 *
 * Deliberately not `siteLocationSchema`, which carries the address half of the
 * pair. An order form offers the site's addresses in its own shipping list;
 * sending the address again inside the Location option would put the same words
 * on the screen twice, from two controls that mean different things.
 */
/**
 * `address` is the location's OWN address, always — even when it repeats the site's
 * address or another entry in the shipping list, which the list drops. Shipping is
 * read from here, not looked up in that list: a location whose address matched one
 * already offered used to find nothing there and leave shipping blank (6 Oct 2026).
 */
export const locationChoiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
});
export type LocationChoice = z.infer<typeof locationChoiceSchema>;

export const siteLocationDetailSchema = z.object({
  siteId: z.string(),
  siteName: z.string(),
  locations: z.array(siteLocationSchema),
});
export type SiteLocationDetail = z.infer<typeof siteLocationDetailSchema>;

/**
 * Writing a site's locations and addresses.
 *
 * A pair carries its id back when it already exists, because DOCUMENTS REFERENCE
 * LOCATIONS BY ID: renaming "Block A" to "Block A (East)" must stay the same
 * location, or every order raised against it would lose its name. A pair left out
 * of the list is soft-deleted, and the orders keep showing the name they were
 * raised with.
 *
 * NEITHER HALF IS `requiredText`, and that is deliberate rather than lax. The
 * migrated rows have an address and no name; someone setting up a new block may
 * know its name before its address. Requiring both would make the screen
 * unsaveable in exactly the states it exists to let people fix. A pair with both
 * halves blank is dropped, which is the case a `+` pressed once too often
 * produces — not a mistake worth a validation message.
 */
const pairHalf = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`);

export const saveSiteLocationsSchema = z.object({
  locations: z
    .array(
      z.object({
        id: optionalUuidId,
        name: pairHalf("Location name", 200),
        address: pairHalf("Address", 500),
      }),
    )
    .max(100, "A site can have at most 100 locations"),
});
export type SaveSiteLocations = z.infer<typeof saveSiteLocationsSchema>;

/** Creating an entry names the site; editing addresses it in the URL. */
export const createSiteLocationsSchema = saveSiteLocationsSchema.extend({ siteId: uuidId });
export type CreateSiteLocations = z.infer<typeof createSiteLocationsSchema>;
