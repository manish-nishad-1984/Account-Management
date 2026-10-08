import { Module } from "@nestjs/common";
import { ReportsModule } from "../reports/reports.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsRepository } from "./payments.repository";

@Module({
  imports: [ReportsModule],
  controllers: [PaymentsController],
  providers: [PaymentsRepository],
})
export class PaymentsModule {}
