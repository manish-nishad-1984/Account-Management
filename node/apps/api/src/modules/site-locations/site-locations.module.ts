import { Module } from "@nestjs/common";
import { SiteLocationsController } from "./site-locations.controller";
import { SiteLocationsRepository } from "./site-locations.repository";

@Module({
  controllers: [SiteLocationsController],
  providers: [SiteLocationsRepository],
})
export class SiteLocationsModule {}
