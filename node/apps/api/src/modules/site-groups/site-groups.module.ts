import { Module } from "@nestjs/common";
import { SiteGroupsController } from "./site-groups.controller";
import { SiteGroupsRepository } from "./site-groups.repository";

@Module({
  controllers: [SiteGroupsController],
  providers: [SiteGroupsRepository],
})
export class SiteGroupsModule {}
