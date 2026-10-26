import { Module } from "@nestjs/common";
import { SitesController } from "./sites.controller";
import { SitesRepository } from "./sites.repository";
import { AuthModule } from "../auth/auth.module";

@Module({
  // The password check before a site is deleted with everything in it.
  imports: [AuthModule],
  controllers: [SitesController],
  providers: [SitesRepository],
})
export class SitesModule {}
