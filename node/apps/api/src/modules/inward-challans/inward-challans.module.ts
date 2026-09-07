import { Module } from "@nestjs/common";
import { InwardChallansController } from "./inward-challans.controller";
import { InwardChallansRepository } from "./inward-challans.repository";

/**
 * Inward challans — the third transaction module, completing Phase 3 apart from
 * file upload, which needs a storage decision. See the note at the foot of the
 * controller.
 *
 * Exported for the dashboard's pending-approval queue.
 */
@Module({
  controllers: [InwardChallansController],
  providers: [InwardChallansRepository],
  exports: [InwardChallansRepository],
})
export class InwardChallansModule {}
