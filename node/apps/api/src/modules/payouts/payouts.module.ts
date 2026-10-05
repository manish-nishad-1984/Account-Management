import { Module } from "@nestjs/common";
import { ReportsModule } from "../reports/reports.module";
import { PayoutsController } from "./payouts.controller";
import { PayoutsRepository } from "./payouts.repository";

/** Imports ReportsModule for the one repository that already knows what each supplier is owed. */
@Module({
  imports: [ReportsModule],
  controllers: [PayoutsController],
  providers: [PayoutsRepository],
})
export class PayoutsModule {}
