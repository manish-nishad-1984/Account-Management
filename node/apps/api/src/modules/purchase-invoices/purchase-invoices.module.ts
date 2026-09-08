import { Module } from "@nestjs/common";
import { PurchaseInvoicesController } from "./purchase-invoices.controller";
import { PurchaseInvoicesRepository } from "./purchase-invoices.repository";

/**
 * Purchase invoices — the document B-2 was written about.
 *
 * The repository is exported so the dashboard's sixth approval queue reads these
 * rows through the same filters as the list screen, rather than through its own
 * idea of what "pending" means.
 */
@Module({
  controllers: [PurchaseInvoicesController],
  providers: [PurchaseInvoicesRepository],
  exports: [PurchaseInvoicesRepository],
})
export class PurchaseInvoicesModule {}
