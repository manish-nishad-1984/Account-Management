import { Module } from "@nestjs/common";
import { AgenciesController } from "./agencies.controller";
import { AgenciesRepository } from "./agencies.repository";

@Module({
  controllers: [AgenciesController],
  providers: [AgenciesRepository],
})
export class AgenciesModule {}
