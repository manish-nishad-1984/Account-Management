import { z } from "zod";
import { requiredText, uuidId } from "./fields";
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

/**
 * A group, in full: its name, the sites in it, and its addresses.
 *
 * THREE TABLES BEHIND IT, one in the source. `GroupMaster` stores the cross
 * product of (site x address) with the name repeated in every row, so a group of
 * 4 sites and 3 addresses is 12 rows there and three shapes here.
 */
export const siteGroupDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  siteIds: z.array(z.string()),
  addresses: z.array(z.object({ id: z.string(), address: z.string() })),
});
export type SiteGroupDetail = z.infer<typeof siteGroupDetailSchema>;

/**
 * Writing a group.
 *
 * ADDRESSES ARE SENT AS PLAIN TEXT, not as rows with ids, and a save REPLACES
 * the set. Their ids are internal: a purchase order records the address it was
 * placed against as text on the order itself, so no document points at these
 * rows and rewriting them breaks nothing. Sending ids back and forth would imply
 * a stability they do not have and that nothing needs.
 *
 * The name is unique case-insensitively, enforced by an index rather than by a
 * check-then-insert — the source checks `Any(x => x.GroupName == name)` in
 * application code with no constraint behind it, which a race defeats.
 */
export const createSiteGroupSchema = z.object({
  name: requiredText("Group name", 200),
  siteIds: z.array(uuidId).max(500).default([]),
  addresses: z.array(requiredText("Address", 500)).max(50).default([]),
});
export type CreateSiteGroup = z.infer<typeof createSiteGroupSchema>;

export const updateSiteGroupSchema = createSiteGroupSchema.partial();
export type UpdateSiteGroup = z.infer<typeof updateSiteGroupSchema>;
