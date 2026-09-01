import { z } from "zod";
import { rowCapabilitiesSchema } from "./pagination";

/**
 * A site group.
 *
 * `siteCount` and `addressCount` are counts of two separate things. In SQL Server
 * they are entangled: `GroupMaster` holds one row per (site x address) pair, so
 * "how many sites are in this group" cannot be answered without a GROUP BY, and a
 * group with 4 sites and 3 addresses looks like 12 of something. Here they are
 * two independent counts because they are two independent facts.
 */
export const siteGroupRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  siteCount: z.number().int().nonnegative(),
  addressCount: z.number().int().nonnegative(),
  /** Up to a handful of member site names, so the grid can show the group's shape. */
  siteNames: z.array(z.string()),
  capabilities: rowCapabilitiesSchema,
});
export type SiteGroupRow = z.infer<typeof siteGroupRowSchema>;

export const SITE_GROUP_SORT_FIELDS = ["name", "createdAt"] as const;
export type SiteGroupSortField = (typeof SITE_GROUP_SORT_FIELDS)[number];
