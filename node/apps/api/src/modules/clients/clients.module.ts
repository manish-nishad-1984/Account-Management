import { Module } from "@nestjs/common";
import { ClientsController } from "./clients.controller";
import { ClientsRepository } from "./clients.repository";

@Module({
  controllers: [ClientsController],
  providers: [ClientsRepository],
})
export class ClientsModule {}
