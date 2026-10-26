import { Module } from "@nestjs/common";
import {
  AgencyPersonsController,
  InventoryIssuesController,
  InventoryItemsController,
  InventoryPhotosController,
} from "./inventory-stock.controller";
import { InventoryStockRepository } from "./inventory-stock.repository";
import { InventoryPhotosService } from "./inventory-photos.service";

/**
 * The inventory item master, its stock, issues to agencies and receiving them
 * back (client, 26 Oct 2026). The photos service is exported for New Arrival,
 * which takes a photo too.
 */
@Module({
  controllers: [InventoryPhotosController, InventoryItemsController, AgencyPersonsController, InventoryIssuesController],
  providers: [InventoryStockRepository, InventoryPhotosService],
  exports: [InventoryStockRepository, InventoryPhotosService],
})
export class InventoryStockModule {}
