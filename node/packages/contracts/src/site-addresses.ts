import { z } from "zod";
import { requiredText } from "./fields";
import { siteLocationSchema } from "./site-locations";
import { siteContactSchema } from "./sites";

/**
 * The delivery addresses belonging to a site.
 *
 * A site has ONE address of its own, on `sites`, and any number of others here —
 * `SiteAddress` in the source, which the legacy purchase order screen already
 * listed under "Shipping Addresses". Nothing in this application could add to
 * that list until now: the 24 rows that exist came in with the import.
 *
 * ONE FREE-TEXT BLOCK, NOT A STRUCTURED ADDRESS, matching both the source column
 * and what the business asked for. There is no area, no city and no PIN code
 * here to fall out of step with the line above it.
 *
 * The id is an INTEGER, not a uuid: `AId` is an identity column in SQL Server
 * and the import carries the source's own ids so that orders already placed keep
 * pointing at the address they named.
 */

export const siteAddressSchema = z.object({
  id: z.number().int(),
  siteId: z.string().uuid(),
  address: z.string(),
});
export type SiteAddress = z.infer<typeof siteAddressSchema>;

export const siteAddressesResponseSchema = z.object({
  rows: z.array(siteAddressSchema),
});
export type SiteAddressesResponse = z.infer<typeof siteAddressesResponseSchema>;

/**
 * 500 characters, the same ceiling as the address on `sites`. The live rows run
 * to a couple of hundred: a full postal address with the PIN code inside it.
 */
export const saveSiteAddressSchema = z.object({
  address: requiredText("Address", 500),
});
export type SaveSiteAddress = z.infer<typeof saveSiteAddressSchema>;

/**
 * One place a document can be shipped to.
 *
 * The site's own address, its delivery addresses from the Site master, and the
 * addresses from the Site Location screen arrive as ONE list, because that is
 * the choice being made — a person picking where a delivery goes does not care
 * which table the line came from. `source` says which, so the screen can label
 * them, and so a future session can tell them apart without guessing at the text.
 */
export const addressChoiceSchema = z.object({
  /** Stable within one site: `site`, `site-shipping`, `extra-<id>` or `location-<id>`. */
  key: z.string(),
  source: z.enum(["site", "site-shipping", "extra", "location"]),
  address: z.string(),
});
export type AddressChoice = z.infer<typeof addressChoiceSchema>;

/**
 * Everything an order or invoice form needs from its site, in one request.
 *
 * The rule the business set on 15 Sep 2026: the BILLING address is our own
 * site's address and nothing else, so it is shown, not chosen; the SHIPPING
 * address is exactly one of the site's addresses, chosen from a list. The
 * location names are what the Location select offers, and the CONTACTS are the
 * site's contact list from the Site master, one of which the form picks as the
 * document's contact person.
 */
export const siteDocumentOptionsSchema = z.object({
  billingAddress: z.string().nullable(),
  shippingAddresses: z.array(addressChoiceSchema),
  locations: z.array(siteLocationSchema),
  contacts: z.array(siteContactSchema),
});
export type SiteDocumentOptions = z.infer<typeof siteDocumentOptionsSchema>;
