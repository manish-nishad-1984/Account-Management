import { Module } from "@nestjs/common";
import { ItemsController, UnitsController } from "./items.controller";
import { ItemsRepository } from "./items.repository";
import { UnitsRepository } from "./units.repository";

/**
 * Items and units ship as one module: units exist to be the unit an item is
 * measured in, they are guarded by the item permissions, and the item form
 * cannot render without them.
 */
@Module({
  controllers: [ItemsController, UnitsController],
  providers: [ItemsRepository, UnitsRepository],
})
export class ItemsModule {}
