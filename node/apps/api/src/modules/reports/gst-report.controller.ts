import { Controller, Get, Query } from "@nestjs/common";
import { gstReportQuerySchema, type GstReport, type GstReportQuery } from "@accountmanagement/contracts";
import { GstReportService } from "./gst-report.service";
import { Permissions } from "../../common/auth/permissions.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";

/**
 * Input GST by supplier, bill and rate, for the month's return (client,
 * 22 Oct 2026). Read from purchase invoices, so it asks for their right.
 */
@Controller("reports/gst")
export class GstReportController {
  constructor(private readonly gst: GstReportService) {}

  @Get()
  @Permissions("purchase-invoice.view")
  report(@Query(new ZodValidationPipe(gstReportQuerySchema)) query: GstReportQuery): Promise<GstReport> {
    return this.gst.report(query);
  }
}
