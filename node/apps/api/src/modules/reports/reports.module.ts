import { Module } from "@nestjs/common";
import { ReportsController } from "./reports.controller";
import { ReportsRepository } from "./reports.repository";
import { ReportExportService } from "./report-export.service";

/**
 * Reports are READ-ONLY and own no table. The payments they read belong to
 * `PaymentsModule`; this module exists so the two report grids are one thing to
 * find, which the source spreads across `ReportController`, `SalesController`,
 * `SupplierInvoiceRepo` and `SalesRepo`.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsRepository, ReportExportService],
})
export class ReportsModule {}
