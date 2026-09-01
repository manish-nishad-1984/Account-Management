import { Module } from "@nestjs/common";
import { CompaniesController } from "./companies.controller";
import { CompaniesRepository } from "./companies.repository";

@Module({
  controllers: [CompaniesController],
  providers: [CompaniesRepository],
})
export class CompaniesModule {}
