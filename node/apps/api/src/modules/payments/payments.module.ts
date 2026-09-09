import { Module } from "@nestjs/common";
import { PaymentsController } from "./payments.controller";
import { PaymentsRepository } from "./payments.repository";

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsRepository],
})
export class PaymentsModule {}
