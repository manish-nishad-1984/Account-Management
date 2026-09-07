import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";
import { geographyId, mobileNo, optionalText, pincode, requiredText } from "./fields";

/**
 * A site row.
 *
 * `contactPersonName` / `contactPersonPhoneNo` are spelled correctly here; the
 * source columns are `ContectPersonName` / `ContectPersonPhoneNo`.
 *
 * No company is exposed. There is no Company-to-Site relationship in the source
 * schema, so a company column here would be inventing one — see the note on
 * `sites.company_id` in the Drizzle schema.
 */
export const siteRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  contactPersonName: z.string().nullable(),
  contactPersonPhoneNo: z.string().nullable(),
  area: z.string().nullable(),
  pincode: z.string().nullable(),
  /** Users assigned to this site, via the junction table that replaced the CSV column. */
  userCount: z.number().int().nonnegative(),
  /** Site groups this site belongs to. */
  groupCount: z.number().int().nonnegative(),
  capabilities: rowCapabilitiesSchema,
});
export type SiteRow = z.infer<typeof siteRowSchema>;

/**
 * The full record, for the edit form.
 *
 * Billing and shipping addresses are two parallel column sets, reproduced rather
 * than normalised: `SiteAddress` already exists in the source for additional
 * shipping addresses, and collapsing both into one structure is a business
 * decision rather than a mechanical one.
 *
 * `companyId` is absent, here as on the row. There is no Company-to-Site
 * relationship in the source schema; the column exists in Drizzle but nothing
 * derives it from production data, so the form does not offer to set it.
 */
export const siteDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  contactPersonName: z.string().nullable(),
  contactPersonPhoneNo: z.string().nullable(),
  address: z.string().nullable(),
  area: z.string().nullable(),
  cityId: z.number().int().nullable(),
  stateId: z.number().int().nullable(),
  countryId: z.number().int().nullable(),
  pincode: z.string().nullable(),
  shippingAddress: z.string().nullable(),
  shippingArea: z.string().nullable(),
  shippingCityId: z.number().int().nullable(),
  shippingStateId: z.number().int().nullable(),
  shippingCountryId: z.number().int().nullable(),
  shippingPincode: z.string().nullable(),
});
export type SiteDetail = z.infer<typeof siteDetailSchema>;

export const createSiteSchema = z.object({
  name: requiredText("Site name", 200),
  isActive: z.boolean().default(true),
  contactPersonName: optionalText(200),
  contactPersonPhoneNo: mobileNo,
  address: optionalText(500),
  area: optionalText(200),
  cityId: geographyId,
  stateId: geographyId,
  countryId: geographyId,
  pincode,
  shippingAddress: optionalText(500),
  shippingArea: optionalText(200),
  shippingCityId: geographyId,
  shippingStateId: geographyId,
  shippingCountryId: geographyId,
  shippingPincode: pincode,
});
export type CreateSite = z.infer<typeof createSiteSchema>;

export const updateSiteSchema = createSiteSchema.partial();
export type UpdateSite = z.infer<typeof updateSiteSchema>;

export const SITE_SORT_FIELDS = ["name", "createdAt"] as const;
export type SiteSortField = (typeof SITE_SORT_FIELDS)[number];

/**
 * The site scope offered in the application header.
 *
 * A separate, deliberately thin shape rather than a reuse of `siteRowSchema`:
 * every signed-in user reads this, including users with no `site.view` right at
 * all, so it carries a name and an id and nothing else. Counts, contact details
 * and addresses stay behind the Site master screen's permission.
 */
export const siteScopeOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type SiteScopeOption = z.infer<typeof siteScopeOptionSchema>;

/**
 * `Main_Layout.cshtml` builds this dropdown from `UserSession.SiteData`, and the
 * two cases it distinguishes are reproduced here rather than merged:
 *
 *  - `assigned` — the user has rows in `user_sites`. The old layout offers those
 *    sites and NO "All Site" entry, so an assigned user always works one site.
 *  - `all` — the user has no assignment at all. The old layout falls back to
 *    `GetSiteNameList` and prepends "All Site", so an unassigned user sees
 *    everything by default.
 *
 * This is a PRESENTATION rule, not an access control, and it was not one in the
 * source either: the .NET endpoints never checked the session's site against the
 * row being read or written. Narrowing the dropdown does not stop a request for
 * another site's data. Real per-site authorisation is a separate decision and is
 * recorded with finding C-6.
 */
export const siteScopeResponseSchema = z.object({
  scope: z.enum(["assigned", "all"]),
  sites: z.array(siteScopeOptionSchema),
});
export type SiteScopeResponse = z.infer<typeof siteScopeResponseSchema>;
