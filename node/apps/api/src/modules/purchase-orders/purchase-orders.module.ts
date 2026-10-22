import { Module } from "@nestjs/common";
import { PurchaseOrdersController } from "./purchase-orders.controller";
import { PurchaseOrdersRepository } from "./purchase-orders.repository";
import { TermsTemplatesController } from "./terms-templates.controller";
import { TermsTemplatesRepository } from "./terms-templates.repository";

/**
 * Purchase orders — the first header-with-lines document, and the first that
 * carries money.
 *
 * The repository is exported for the same reason as purchase requests: the
 * dashboard's pending queue must read these rows through the same filters as the
 * list screen, not through its own idea of what "pending" means.
 */
@Module({
  controllers: [PurchaseOrdersController, TermsTemplatesController],
  providers: [PurchaseOrdersRepository, TermsTemplatesRepository],
  exports: [PurchaseOrdersRepository],
})
export class PurchaseOrdersModule {}
