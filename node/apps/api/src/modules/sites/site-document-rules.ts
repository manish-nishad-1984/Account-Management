import { BadRequestException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/database";
import { siteLocations, sites } from "../../db/schema";

/**
 * The two rules an order or invoice at a site must follow, set by the business
 * on 15 Sep 2026. Plain functions over a database handle rather than a Nest
 * provider, so the purchase order, purchase invoice and sales invoice
 * repositories can apply them inside their own transactions without importing
 * the sites module.
 */

export const blankToNull = (value: string | null): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * THE BILLING ADDRESS IS OUR SITE'S ADDRESS, and nothing else.
 *
 * Copied onto the document as text when it is saved, so correcting the site's
 * address later does not rewrite a bill already issued. A document with no site
 * has no billing address.
 */
export async function billingAddressOf(db: Database, siteId: string | null): Promise<string | null> {
  if (!siteId) return null;
  const [site] = await db
    .select({ address: sites.address })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  return blankToNull(site?.address ?? null);
}

/**
 * A document's location must be one of ITS site's locations.
 *
 * The form only offers those, but a crafted request could otherwise file an
 * order at one site under another site's location, and every screen showing the
 * location would carry it there.
 */
export async function assertLocationAtSite(
  db: Database,
  locationId: string | null | undefined,
  siteId: string | null,
): Promise<void> {
  if (!locationId) return;
  const [location] = await db
    .select({ siteId: siteLocations.siteId })
    .from(siteLocations)
    .where(eq(siteLocations.id, locationId))
    .limit(1);
  if (!location || location.siteId !== siteId) {
    throw new BadRequestException("That location does not belong to the chosen site");
  }
}

/**
 * Both rules, for a PARTIAL update of a document that has a site and a location.
 *
 * Either field may be absent from the patch, and the rules are about the pair,
 * so the half that was not sent is read back through `stored`. The billing
 * address is recopied only when the site itself was sent — editing an old
 * document's notes must not rewrite the address it was billed to.
 *
 * Returns the columns to add to the patch.
 */
export async function placementPatch(
  db: Database,
  change: { siteId?: string | null; siteLocationId?: string | null },
  stored: () => Promise<{ siteId: string | null; siteLocationId: string | null }>,
): Promise<{ billingAddress?: string | null }> {
  if (change.siteId === undefined && change.siteLocationId === undefined) return {};
  const current = await stored();
  const siteId = change.siteId !== undefined ? change.siteId : current.siteId;
  const locationId =
    change.siteLocationId !== undefined ? change.siteLocationId : current.siteLocationId;
  await assertLocationAtSite(db, locationId, siteId);
  return change.siteId !== undefined ? { billingAddress: await billingAddressOf(db, siteId) } : {};
}
