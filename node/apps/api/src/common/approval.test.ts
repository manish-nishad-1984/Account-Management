import { describe, expect, it } from "vitest";
import { approvalOnUpdate, approvedOnCreate } from "./approval";
import type { AccessTokenClaims } from "../modules/auth/token.service";

/**
 * The business rule of 17 Sep 2026, in one place.
 *
 * "Jo user ko approve ki permission hai, vo jo bhi entry kare use approval ki
 * need nahi hai; jise permission nahi hai, uski entry approval me jayegi."
 *
 * These tests are the rule. The eight controllers only call these two functions,
 * so what is asserted here is what every approvable screen does.
 */
const caller = (...permissions: string[]): AccessTokenClaims => ({
  sub: "11111111-1111-1111-1111-111111111111",
  permissions,
  siteIds: [],
  companyIds: [],
});

describe("who needs approval on create", () => {
  it("approves the work of someone who holds the approve right", () => {
    expect(approvedOnCreate(caller("item.add", "item.approve"), "item")).toBe(true);
  });

  it("sends the work of someone without it to the queue", () => {
    expect(approvedOnCreate(caller("item.add", "item.edit"), "item")).toBe(false);
  });

  /**
   * The right is PER SUBJECT. Someone who can approve purchase orders does not
   * thereby self-approve items — the mistake that would quietly widen every
   * approver into an approver of everything.
   */
  it("does not let an approve right on one subject carry to another", () => {
    const poApprover = caller("purchase-orders.approve", "item.add");
    expect(approvedOnCreate(poApprover, "purchase-orders")).toBe(true);
    expect(approvedOnCreate(poApprover, "item")).toBe(false);
  });

  /** A request with no token reached a guarded route: nothing is auto-approved. */
  it("approves nothing when there is no caller", () => {
    expect(approvedOnCreate(undefined, "item")).toBe(false);
  });

  it("is not fooled by a right that merely starts with the subject name", () => {
    expect(approvedOnCreate(caller("item-price.approve"), "item")).toBe(false);
  });
});

describe("what an edit does to an approved record", () => {
  /**
   * THE HALF THAT GIVES THE RULE TEETH. Without it a clerk who cannot approve a
   * purchase order could still change the amount on one that was already
   * approved, and nobody would look at it again.
   */
  it("sends a record back to pending when a non-approver edits it", () => {
    expect(approvalOnUpdate(caller("purchase-orders.edit"), "purchase-orders")).toEqual({
      isApproved: false,
    });
  });

  /**
   * An approver's edit leaves the flag exactly as it stands — it does NOT force
   * it true. Forcing it would silently re-approve a record an approver had just
   * deliberately sent back.
   */
  it("leaves the flag alone when an approver edits", () => {
    expect(approvalOnUpdate(caller("purchase-orders.edit", "purchase-orders.approve"), "purchase-orders")).toEqual(
      {},
    );
  });

  it("sends a record back to pending when there is no caller", () => {
    expect(approvalOnUpdate(undefined, "item")).toEqual({ isApproved: false });
  });

  /**
   * Spread into an update body, the approver's result must add no key at all —
   * an `isApproved: undefined` would be a key Drizzle then has an opinion about.
   */
  it("adds no key at all for an approver, so an update body is untouched", () => {
    const body = { name: "Edited" };
    const merged = { ...body, ...approvalOnUpdate(caller("item.approve"), "item") };
    expect(Object.keys(merged)).toEqual(["name"]);
  });
});
