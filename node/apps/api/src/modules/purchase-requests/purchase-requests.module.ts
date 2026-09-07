import { Module } from "@nestjs/common";
import { PurchaseRequestsController } from "./purchase-requests.controller";
import { PurchaseRequestsRepository } from "./purchase-requests.repository";

/**
 * Purchase requests — the first transaction module, Phase 3 of the roadmap.
 *
 * The repository is exported because the dashboard's pending-approval queue
 * reads the same rows, and it must read them through the same filters rather
 * than growing its own copy of "what counts as pending".
 */
@Module({
  controllers: [PurchaseRequestsController],
  providers: [PurchaseRequestsRepository],
  exports: [PurchaseRequestsRepository],
})
export class PurchaseRequestsModule {}
