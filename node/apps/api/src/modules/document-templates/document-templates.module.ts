import { Module } from "@nestjs/common";
import { DocumentPrintController, DocumentTemplatesController } from "./document-templates.controller";
import { DocumentTemplatesRepository } from "./document-templates.repository";
import { PrintDocumentsRepository } from "./print-documents.repository";
import { SalesInvoicesModule } from "../sales-invoices/sales-invoices.module";
import { PurchaseInvoicesModule } from "../purchase-invoices/purchase-invoices.module";
import { PurchaseOrdersModule } from "../purchase-orders/purchase-orders.module";

/**
 * Print layouts, and the print data they are drawn with.
 *
 * Imports the invoice and order modules for their exported repositories only —
 * the document itself is read through the same `findById` its own screen uses,
 * and nothing in those modules changed for this.
 */
@Module({
  imports: [SalesInvoicesModule, PurchaseInvoicesModule, PurchaseOrdersModule],
  controllers: [DocumentTemplatesController, DocumentPrintController],
  providers: [DocumentTemplatesRepository, PrintDocumentsRepository],
})
export class DocumentTemplatesModule {}
