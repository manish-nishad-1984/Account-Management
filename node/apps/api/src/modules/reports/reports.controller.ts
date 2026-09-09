import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import {
  balancesQuerySchema,
  reportFilterSchema,
  type BalancesResponse,
  type LedgerResponse,
} from "@accountmanagement/contracts";
import { ReportsRepository } from "./reports.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";

/**
 * The two report grids.
 *
 * Paging is OFFSET here, uniquely in this system, and `reports.repository.ts`
 * says why: a running balance depends on every row before it, so a keyset
 * cursor would have to re-scan the prefix that the window function already
 * scans. The limit is capped so a report cannot ask for the whole ledger in one
 * response — which is exactly what the legacy grids do (`paging: false`), and
 * `14-reports-and-payments.md` point 2 warns that enabling paging is a visible
 * change users will notice.
 */
const pagingSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
});

const ledgerQuerySchema = reportFilterSchema.and(pagingSchema);
const balancesRequestSchema = balancesQuerySchema.and(pagingSchema);

/** The sales report is one direction of the summary; it cannot ask for the other. */
const salesRequestSchema = balancesQuerySchema
  .omit({ direction: true })
  .and(pagingSchema);

@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsRepository) {}

  /**
   * Panel 2, "Payment Report" — the running-balance ledger.
   *
   * `details-report`, from the `Details Report` form row §5f read off the
   * production `forms` table. The screen's own partials check
   * `"Details Report & Payout"` and `"Reports"` instead; see the note in
   * `payments.controller.ts` and doc 19 Question 14.
   */
  @Get("ledger")
  @Permissions("details-report.view")
  ledger(
    @Query(new ZodValidationPipe(ledgerQuerySchema))
    query: ReturnType<typeof ledgerQuerySchema.parse>,
  ): Promise<LedgerResponse> {
    const { limit, offset, ...filter } = query;
    return this.reports.ledger(filter, { limit, offset });
  }

  /**
   * Panel 1, "Payout Summary". Its own filter row carries a Purchase/Sales
   * toggle, so `direction` is a parameter rather than fixed.
   */
  @Get("balances")
  @Permissions("details-report.view")
  balances(
    @Query(new ZodValidationPipe(balancesRequestSchema))
    query: ReturnType<typeof balancesRequestSchema.parse>,
  ): Promise<BalancesResponse> {
    const { limit, offset, ...filter } = query;
    return this.reports.balances(filter, { limit, offset });
  }

  /**
   * `/Sales/SalesReport` — the same aggregate, its own screen, its own right.
   *
   * TWO ROUTES RATHER THAN ONE, and the reason is the guard rather than the
   * query. `PermissionsGuard` requires EVERY permission listed on a route, not
   * any of them — `required.filter(p => !granted.has(p))` must come back empty.
   * So `@Permissions("details-report.view", "sales-report.view")` would demand
   * both rights and lock out the person who holds exactly the one the legacy
   * screen asks for. The repository method is shared, which was the win worth
   * having; the route is not.
   *
   * `/Sales/SalesReport` carries NO `[FormPermissionAttribute]` at all — doc 11
   * screen 30 flags it, and this is the fourth screen in a row where that is
   * true (§5o download, §5t history, supplier edit in §5b). A missing
   * authorization check is not a business rule to reproduce faithfully.
   */
  @Get("sales")
  @Permissions("sales-report.view")
  salesReport(
    @Query(new ZodValidationPipe(salesRequestSchema))
    query: ReturnType<typeof salesRequestSchema.parse>,
  ): Promise<BalancesResponse> {
    const { limit, offset, ...filter } = query;
    return this.reports.balances({ ...filter, direction: "in" }, { limit, offset });
  }
}
