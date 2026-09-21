import { hasPermission } from "@accountmanagement/contracts";
import type { AccessTokenClaims } from "../modules/auth/token.service";

/**
 * WHO NEEDS APPROVAL, decided by the writer's own approve right.
 *
 * The business rule, given on 17 Sep 2026: someone who holds `<subject>.approve`
 * does not need their own work approved — whatever they enter is approved as it
 * is saved. Everyone else's work goes to the approval queue, exactly as it did
 * before. It applies only where an approval provision already exists, which is
 * the eight subjects with an approve endpoint: item, supplier, inward-challan,
 * inventory-inward, purchase-orders, purchase-request, purchase-invoice and
 * sales-invoice.
 *
 * THE DECISION IS MADE FROM THE ACCESS TOKEN, NEVER FROM THE REQUEST BODY, and
 * that is the whole reason this is a server-side helper rather than a field on a
 * form. `isApproved` used to be a checkbox on the item and supplier forms, which
 * under this rule would be a bypass: a clerk with no approve right could tick it
 * and self-approve. The flag is no longer something a caller can state.
 */
export function approvedOnCreate(
  caller: AccessTokenClaims | undefined,
  subject: string,
): boolean {
  return hasPermission(caller?.permissions ?? [], subject, "approve");
}

/**
 * What an EDIT does to a record that was already approved.
 *
 * An approver's edit leaves the flag alone; a non-approver's edit sends the
 * record back to pending. The business chose this on 17 Sep 2026 over leaving
 * the flag untouched, and it is the choice that makes the rule mean anything:
 * without it, a clerk could not approve a purchase order but could change the
 * amount on one that was already approved, and nobody would look at it again.
 *
 * Returns the override to merge into the update, or nothing when the flag
 * should be left as it stands. `undefined` rather than `true` for an approver
 * is deliberate — forcing `true` on every approver edit would silently
 * re-approve a record an approver had just deliberately sent back.
 */
export function approvalOnUpdate(
  caller: AccessTokenClaims | undefined,
  subject: string,
): { isApproved: false } | Record<string, never> {
  return approvedOnCreate(caller, subject) ? {} : { isApproved: false };
}
