import { Module } from "@nestjs/common";
import { ClientIncomesController } from "./client-incomes.controller";
import { ClientIncomesRepository } from "./client-incomes.repository";

@Module({
  controllers: [ClientIncomesController],
  providers: [ClientIncomesRepository],
  // The site-wise balance sheet reads income through this repository.
  exports: [ClientIncomesRepository],
})
export class ClientIncomesModule {}
