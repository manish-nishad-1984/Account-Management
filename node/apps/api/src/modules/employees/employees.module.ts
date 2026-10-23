import { Module } from "@nestjs/common";
import { EmployeesController } from "./employees.controller";
import { EmployeesRepository } from "./employees.repository";

/** Exports the repository: the payout list asks it for the salaries still due. */
@Module({
  controllers: [EmployeesController],
  providers: [EmployeesRepository],
  exports: [EmployeesRepository],
})
export class EmployeesModule {}
