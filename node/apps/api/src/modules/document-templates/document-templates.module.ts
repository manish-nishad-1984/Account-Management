import { Module } from "@nestjs/common";
import { DocumentPrintController, DocumentTemplatesController } from "./document-templates.controller";
import { DocumentTemplatesRepository } from "./document-templates.repository";
import { PrintDocumentsRepository } from "./print-documents.repository";
import { SalesInvoicesModule } from "../sales-invoices/sales-invoices.module";
import { PurchaseInvoicesModule } from "../purchase-invoices/purchase-invoices.module";

/**
 * Print layouts, and the print data they are drawn with.
 *
 * Imports the two invoice modules for their exported repositories only — the
 * invoice itself is read through the same `findById` the invoice screens use,
 * and nothing in either module changed for this.
 */
@Module({
  imports: [SalesInvoicesModule, PurchaseInvoicesModule],
  controllers: [DocumentTemplatesController, DocumentPrintController],
  providers: [DocumentTemplatesRepository, PrintDocumentsRepository],
})
export class DocumentTemplatesModule {}
