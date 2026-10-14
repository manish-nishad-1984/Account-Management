import { Module } from "@nestjs/common";
import { SiteLocationsController } from "./site-locations.controller";
import { SiteLocationSheetService } from "./site-location-sheet.service";
import { SiteLocationsRepository } from "./site-locations.repository";

@Module({
  controllers: [SiteLocationsController],
  providers: [SiteLocationsRepository, SiteLocationSheetService],
})
export class SiteLocationsModule {}
