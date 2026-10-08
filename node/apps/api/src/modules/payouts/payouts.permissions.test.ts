import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { PayoutsController } from "./payouts.controller";

const permissionsOf = (method: string): string[] => {
  const handler = (PayoutsController.prototype as unknown as Record<string, object>)[method]!;
  return (Reflect.getMetadata("permissions", handler) as string[] | undefined) ?? [];
};

/**
 * Every route is guarded by the `payout` subject: none falls through to the
 * default-deny guard by accident, and none borrows `reports-payments`, which
 * would make the list readable by anyone who can merely view a report.
 */
describe("payout list permissions", () => {
  it.each([
    ["list", "payout.view"],
    ["outstanding", "payout.view"],
    ["findOne", "payout.view"],
    ["create", "payout.add"],
    ["update", "payout.edit"],
    ["remove", "payout.delete"],
    ["confirm", "payout.approve"],
    ["reverse", "payout.approve"],
  ])("%s asks for %s", (method, right) => {
    expect(permissionsOf(method)).toEqual([right]);
  });
});
