import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";

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

export const SITE_SORT_FIELDS = ["name", "createdAt"] as const;
export type SiteSortField = (typeof SITE_SORT_FIELDS)[number];
