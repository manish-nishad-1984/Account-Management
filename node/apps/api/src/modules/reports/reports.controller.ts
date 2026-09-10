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
   * ~~`details-report`, from the `Details Report` form row.~~ **THAT WAS WRONG,
   * AND IT MADE THIS REPORT UNREACHABLE FOR EVERYONE.**
   *
   * DOC 19 QUESTION 14 IS ANSWERED, from the legacy source rather than a guess.
   * `InvoiceMasterController.PayOutInvoice` — the screen this ports, served at
   * `/InvoiceMaster/PayOutInvoice` — carries
   * `[FormPermissionAttribute("Reports & Payments-View")]`, and so does
   * `GetInvoiceDetails`, which fills it. `Details Report` and `Sales Report` are
   * checked NOWHERE in the .NET solution: they are dead rows in the `Form`
   * table, both `IsActive = false`, so the permission builder produces no
   * subject for them and nobody can hold one.
   *
   * The port had split ONE legacy screen across THREE subjects — payments under
   * `reports-payments`, this ledger under `details-report`, the sales summary
   * under `sales-report` — and only the first matched the legacy app. The other
   * two answered 403 for every user on the live site, on a report the old system
   * shows to anyone holding `Reports & Payments-View`.
   *
   * All three panels now use the subject the legacy screen actually asks for,
   * which is the one `payments.controller.ts` has used all along.
   */
  @Get("ledger")
  @Permissions("reports-payments.view")
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
  @Permissions("reports-payments.view")
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
   * TWO ROUTES RATHER THAN ONE, and the reason is no longer the guard — both
   * now ask for `reports-payments.view`, because that is what the legacy screen
   * asks for. It is worth keeping the note about why they were never merged into
   * one route with two permissions: `PermissionsGuard` requires EVERY permission
   * listed, not any of them, so a route naming two subjects demands both and
   * locks out the person holding exactly one. The repository method is shared,
   * which was the win worth having; the route is not.
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
  @Permissions("reports-payments.view")
  async ledgerXlsx(
    @Query(new ZodValidationPipe(ledgerExportQuerySchema))
    filter: ReturnType<typeof ledgerExportQuerySchema.parse>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const bytes = await this.exports.ledgerWorkbook(filter);
    await this.sendFile(reply, bytes, reportFileName("Ledger", new Date(), "xlsx"), ".xlsx");
  }

  @Get("ledger/export.pdf")
  @Permissions("reports-payments.view")
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
  @Permissions("reports-payments.view")
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
  @Permissions("reports-payments.view")
  async balancesXlsx(
    @Query(new ZodValidationPipe(balancesExportQuerySchema))
    filter: ReturnType<typeof balancesExportQuerySchema.parse>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const bytes = await this.exports.balancesWorkbook(filter, "Balances");
    await this.sendFile(reply, bytes, reportFileName("Balances", new Date(), "xlsx"), ".xlsx");
  }

  @Get("balances/export.pdf")
  @Permissions("reports-payments.view")
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
  @Permissions("reports-payments.view")
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
  @Permissions("reports-payments.view")
  async salesPdf(
    @Query(new ZodValidationPipe(salesExportQuerySchema))
    filter: ReturnType<typeof salesExportQuerySchema.parse>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const bytes = await this.exports.balancesPdf({ ...filter, direction: "in" }, "Sales report");
    await this.sendFile(reply, bytes, reportFileName("Sales-Report", new Date(), "pdf"), ".pdf");
  }

  @Get("sales")
  @Permissions("reports-payments.view")
  salesReport(
    @Query(new ZodValidationPipe(salesRequestSchema))
    query: ReturnType<typeof salesRequestSchema.parse>,
  ): Promise<BalancesResponse> {
    const { limit, offset, ...filter } = query;
    return this.reports.balances({ ...filter, direction: "in" }, { limit, offset });
  }
}
