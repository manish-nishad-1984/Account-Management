import { Module } from "@nestjs/common";
import { ReportsModule } from "../reports/reports.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsRepository } from "./payments.repository";
import { PaymentImportService } from "./payment-import.service";

@Module({
  imports: [ReportsModule],
  controllers: [PaymentsController],
  providers: [PaymentsRepository, PaymentImportService],
})
export class PaymentsModule {}
