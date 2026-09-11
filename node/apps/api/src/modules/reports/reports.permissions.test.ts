import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { ReportsController } from "./reports.controller";
import { PaymentsController } from "../payments/payments.controller";

/**
 * ONE LEGACY SCREEN, ONE PERMISSION.
 *
 * `/InvoiceMaster/PayOutInvoice` is three panels — a payout summary, a
 * running-balance payment report, and the payment actions on its rows — and the
 * .NET controller guards the whole thing with ONE right:
 *
 *   [FormPermissionAttribute("Reports & Payments-View")]
 *   public IActionResult PayOutInvoice()
 *
 * The port split it across three subjects instead: payments under
 * `reports-payments`, the ledger under `details-report`, the sales summary under
 * `sales-report`. Only the first matched. `Details Report` and `Sales Report` are
 * checked NOWHERE in the .NET solution and are `IsActive = false` in production,
 * so the permission builder emits no subject for them and no user can hold one —
 * which made a report the old system shows freely answer 403 for everyone.
 *
 * This test exists because that failure is invisible from inside the API: every
 * unit test passed, the routes worked for a user granted the invented subject,
 * and only a real login against real permission data showed it.
 */

const permissionsOf = (controller: object, method: string): string[] => {
  const handler = (controller as Record<string, unknown>)[method];
  return (Reflect.getMetadata("permissions", handler as object) as string[] | undefined) ?? [];
};

const REPORT_ROUTES = [
  "ledger",
  "balances",
  "ledgerXlsx",
  "ledgerPdf",
  "ledgerByPartyXlsx",
  "balancesXlsx",
  "balancesPdf",
  "salesXlsx",
  "salesPdf",
  "salesReport",
] as const;

describe("report permissions", () => {
  it.each(REPORT_ROUTES)("%s asks for the right the legacy screen asks for", (method) => {
    expect(permissionsOf(ReportsController.prototype, method)).toEqual([
      "reports-payments.view",
    ]);
  });

  /**
   * The two dead subjects must not come back. Naming either one here is the same
   * as taking the screen away: nobody is granted them, and nobody can be.
   */
  it.each(REPORT_ROUTES)("%s does not ask for a subject nobody can hold", (method) => {
    const required = permissionsOf(ReportsController.prototype, method);
    expect(required.join(",")).not.toContain("details-report");
    expect(required.join(",")).not.toContain("sales-report");
  });

  /**
   * The payments panel of the same screen was always right, and this pins the
   * two together: they are one screen and must not drift apart again.
   */
  it("matches the payments panel of the same screen", () => {
    expect(permissionsOf(PaymentsController.prototype, "list")).toEqual([
      "reports-payments.view",
    ]);
  });
});
