import { Module } from "@nestjs/common";
import { SitesController } from "./sites.controller";
import { SitesRepository } from "./sites.repository";

@Module({
  controllers: [SitesController],
  providers: [SitesRepository],
})
export class SitesModule {}
