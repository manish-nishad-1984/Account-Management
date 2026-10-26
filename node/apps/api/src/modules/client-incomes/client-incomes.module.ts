import { Module } from "@nestjs/common";
import { ClientIncomesController } from "./client-incomes.controller";
import { ClientIncomesRepository } from "./client-incomes.repository";
import { IncomeImportService } from "./income-import.service";

@Module({
  controllers: [ClientIncomesController],
  providers: [ClientIncomesRepository, IncomeImportService],
  // The site-wise balance sheet reads income through this repository.
  exports: [ClientIncomesRepository],
})
export class ClientIncomesModule {}
