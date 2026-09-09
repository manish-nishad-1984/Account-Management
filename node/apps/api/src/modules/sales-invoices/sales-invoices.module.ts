import { Module } from "@nestjs/common";
import { SalesInvoicesController } from "./sales-invoices.controller";
import { SalesInvoicesRepository } from "./sales-invoices.repository";

/**
 * Sales invoices — the purchase invoice with the direction reversed.
 *
 * The repository is exported so any future queue or report reads these rows
 * through the same filters as the list screen.
 */
@Module({
  controllers: [SalesInvoicesController],
  providers: [SalesInvoicesRepository],
  exports: [SalesInvoicesRepository],
})
export class SalesInvoicesModule {}
