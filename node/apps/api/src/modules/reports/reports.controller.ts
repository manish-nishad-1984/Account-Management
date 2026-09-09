import { Controller, Get, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import {
  ATTACHMENT_TYPES,
  balancesExportQuerySchema,
  balancesQuerySchema,
  ledgerExportQuerySchema,
  reportFileName,
  reportFilterSchema,
  salesExportQuerySchema,
  type BalancesResponse,
  type LedgerResponse,
} from "@accountmanagement/contracts";
import { ReportsRepository } from "./reports.repository";
import { ReportExportService } from "./report-export.service";
import { Permissions } from "../../common/auth/permissions.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { contentDisposition } from "../../common/storage/content-disposition";

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
  constructor(
    private readonly reports: ReportsRepository,
    private readonly exports: ReportExportService,
  ) {}

  /**
   * Sends a rendered report file.
   *
   * The headers matter as much as the bytes. `nosniff` and an explicit
   * disposition stop a browser deciding for itself that a spreadsheet is
   * something it should render, and `no-store` keeps a report of one site's
   * balances out of a shared machine's disk cache. Identical to the item export
   * of §5o, which is where this shape was settled.
   */
  private async sendFile(
    reply: FastifyReply,
    bytes: Buffer,
    fileName: string,
    extension: ".xlsx" | ".pdf",
  ): Promise<void> {
    await reply
      .header("Content-Type", ATTACHMENT_TYPES[extension]!)
      .header("Content-Length", bytes.byteLength)
      .header("Content-Disposition", contentDisposition(fileName))
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, no-store")
      .send(bytes);
  }

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
  /**
   * THE SEVEN DOWNLOADS.
   *
   * Each is a GET with the panel's own filters, so a report and its export are
   * the same URL with a different suffix and a person can bookmark either. The
   * legacy versions are POSTs carrying a JSON body, which is why none of their
   * exports can be linked to or re-run from a browser history.
   *
   * The permission on each is the permission of the PANEL it renders. An export
   * is a copy of what the screen already showed, so a right to download that a
   * right to view does not already imply would be a control nobody could
   * explain. The legacy actions carry no permission attribute at all — finding
   * C-6, which this port does not reproduce.
   */
  @Get("ledger/export.xlsx")
  @Permissions("details-report.view")
  async ledgerXlsx(
    @Query(new ZodValidationPipe(ledgerExportQuerySchema))
    filter: ReturnType<typeof ledgerExportQuerySchema.parse>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const bytes = await this.exports.ledgerWorkbook(filter);
    await this.sendFile(reply, bytes, reportFileName("Ledger", new Date(), "xlsx"), ".xlsx");
  }

  @Get("ledger/export.pdf")
  @Permissions("details-report.view")
  async ledgerPdf(
    @Query(new ZodValidationPipe(ledgerExportQuerySchema))
    filter: ReturnType<typeof ledgerExportQuerySchema.parse>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const bytes = await this.exports.ledgerPdf(filter);
    await this.sendFile(reply, bytes, reportFileName("Ledger", new Date(), "pdf"), ".pdf");
  }

  /** "Supplier Excel" — the same rows, one section and one total per party. */
  @Get("ledger/by-party.xlsx")
  @Permissions("details-report.view")
  async ledgerByPartyXlsx(
    @Query(new ZodValidationPipe(ledgerExportQuerySchema))
    filter: ReturnType<typeof ledgerExportQuerySchema.parse>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const bytes = await this.exports.ledgerBySupplierWorkbook(filter);
    await this.sendFile(
      reply,
      bytes,
      reportFileName("Ledger-by-supplier", new Date(), "xlsx"),
      ".xlsx",
    );
  }

  @Get("balances/export.xlsx")
  @Permissions("details-report.view")
  async balancesXlsx(
    @Query(new ZodValidationPipe(balancesExportQuerySchema))
    filter: ReturnType<typeof balancesExportQuerySchema.parse>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const bytes = await this.exports.balancesWorkbook(filter, "Balances");
    await this.sendFile(reply, bytes, reportFileName("Balances", new Date(), "xlsx"), ".xlsx");
  }

  @Get("balances/export.pdf")
  @Permissions("details-report.view")
  async balancesPdf(
    @Query(new ZodValidationPipe(balancesExportQuerySchema))
    filter: ReturnType<typeof balancesExportQuerySchema.parse>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const bytes = await this.exports.balancesPdf(filter, "Payout summary");
    await this.sendFile(reply, bytes, reportFileName("Balances", new Date(), "pdf"), ".pdf");
  }

  /**
   * The sales report's own pair, on its own right.
   *
   * Same two reasons as the `sales` route above: `PermissionsGuard` requires
   * every permission listed, so these cannot share a route with the balances
   * pair, and the direction is fixed rather than accepted from the query.
   */
  @Get("sales/export.xlsx")
  @Permissions("sales-report.view")
  async salesXlsx(
    @Query(new ZodValidationPipe(salesExportQuerySchema))
    filter: ReturnType<typeof salesExportQuerySchema.parse>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const bytes = await this.exports.balancesWorkbook(
      { ...filter, direction: "in" },
      "Sales report",
    );
    await this.sendFile(reply, bytes, reportFileName("Sales-Report", new Date(), "xlsx"), ".xlsx");
  }

  @Get("sales/export.pdf")
  @Permissions("sales-report.view")
  async salesPdf(
    @Query(new ZodValidationPipe(salesExportQuerySchema))
    filter: ReturnType<typeof salesExportQuerySchema.parse>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const bytes = await this.exports.balancesPdf({ ...filter, direction: "in" }, "Sales report");
    await this.sendFile(reply, bytes, reportFileName("Sales-Report", new Date(), "pdf"), ".pdf");
  }

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
