import { Module } from "@nestjs/common";
import { InwardChallansController } from "./inward-challans.controller";
import { InwardChallansRepository } from "./inward-challans.repository";
import { InwardChallanDocumentsService } from "./inward-challan-documents.service";

/**
 * Inward challans — the third transaction module, and the first with files.
 *
 * Attachments go through DOCUMENT_STORAGE, which StorageModule provides
 * globally. Nothing here knows whether that is a disk or a bucket.
 *
 * Exported for the dashboard's pending-approval queue.
 */
@Module({
  controllers: [InwardChallansController],
  providers: [InwardChallansRepository, InwardChallanDocumentsService],
  exports: [InwardChallansRepository],
})
export class InwardChallansModule {}
