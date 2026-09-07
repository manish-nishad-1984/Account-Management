import { Module } from "@nestjs/common";
import { InventoryInwardController } from "./inventory-inward.controller";
import { InventoryInwardRepository } from "./inventory-inward.repository";

/**
 * Inventory inward — Phase 3, and the first module built against the shell's
 * site scope from the start rather than retrofitted.
 *
 * A module of its own, though the source serves it from `SalesController` and
 * `SalesRepo.cs`. Those five methods share nothing with sales invoices but the
 * file they sit in.
 *
 * The repository is exported for the dashboard's pending-approval queue, which
 * must read these rows through the same filters rather than growing its own idea
 * of what counts as pending.
 */
@Module({
  controllers: [InventoryInwardController],
  providers: [InventoryInwardRepository],
  exports: [InventoryInwardRepository],
})
export class InventoryInwardModule {}
