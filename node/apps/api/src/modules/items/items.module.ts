import { Module } from "@nestjs/common";
import { ItemsController, UnitsController } from "./items.controller";
import { ItemsRepository } from "./items.repository";
import { UnitsRepository } from "./units.repository";
import { ItemSheetService } from "./item-sheet.service";

/**
 * Items and units ship as one module: units exist to be the unit an item is
 * measured in, they are guarded by the item permissions, and the item form
 * cannot render without them.
 *
 * The spreadsheet import/export is a SERVICE rather than more repository
 * methods, because it is the one part of this module that has a workflow —
 * parse, validate the whole file, resolve against the database, then write or
 * refuse. Repositories here stay a thin layer over SQL.
 */
@Module({
  controllers: [ItemsController, UnitsController],
  providers: [ItemsRepository, UnitsRepository, ItemSheetService],
})
export class ItemsModule {}
