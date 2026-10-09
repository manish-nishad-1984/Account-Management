import { Module } from "@nestjs/common";
import { ClientIncomesModule } from "../client-incomes/client-incomes.module";
import { ReportsModule } from "../reports/reports.module";
import { BalanceSheetController } from "./balance-sheet.controller";
import { BalanceSheetService } from "./balance-sheet.service";

@Module({
  imports: [ClientIncomesModule, ReportsModule],
  controllers: [BalanceSheetController],
  providers: [BalanceSheetService],
})
export class BalanceSheetModule {}
