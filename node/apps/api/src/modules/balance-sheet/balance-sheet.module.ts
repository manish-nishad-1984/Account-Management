import { Module } from "@nestjs/common";
import { ClientIncomesModule } from "../client-incomes/client-incomes.module";
import { ReportsModule } from "../reports/reports.module";
import { BalanceSheetController } from "./balance-sheet.controller";
import { BalanceSheetService } from "./balance-sheet.service";
import { SavedBalanceSheetsController } from "./saved-balance-sheets.controller";
import { SavedBalanceSheetsRepository } from "./saved-balance-sheets.repository";

@Module({
  imports: [ClientIncomesModule, ReportsModule],
  controllers: [BalanceSheetController, SavedBalanceSheetsController],
  providers: [BalanceSheetService, SavedBalanceSheetsRepository],
})
export class BalanceSheetModule {}
