import { z } from "zod";

/**
 * DELETE A SITE WITH EVERYTHING IN IT (client, 26 Oct 2026: "to delete a site I
 * have to delete every invoice, then its data, then deactivate it; give me one
 * option, with a password").
 *
 * The screen first shows what the site holds; the delete then asks for the
 * person's OWN login password, and takes the site and all of it in one go: its
 * requests, orders, challans, arrivals, purchase and sales invoices, payments
 * (those made from a payout list too), income, locations, addresses and the
 * users' access to it. All or nothing, recorded in the audit trail.
 */
export const siteContentsSchema = z.object({
  siteName: z.string(),
  purchaseRequests: z.number().int(),
  purchaseOrders: z.number().int(),
  inwardChallans: z.number().int(),
  inventoryArrivals: z.number().int(),
  purchaseInvoices: z.number().int(),
  salesInvoices: z.number().int(),
  payments: z.number().int(),
  incomes: z.number().int(),
  locations: z.number().int(),
  users: z.number().int(),
  /** What the purchase invoices come to, and the payments: so the size of it is plain. */
  billedTotal: z.string(),
  paidTotal: z.string(),
});
export type SiteContents = z.infer<typeof siteContentsSchema>;

export const purgeSiteSchema = z.object({
  password: z.string().min(1, "Enter your password"),
});
export type PurgeSite = z.infer<typeof purgeSiteSchema>;
