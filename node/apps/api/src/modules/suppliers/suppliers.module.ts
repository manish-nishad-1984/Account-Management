import { Module } from "@nestjs/common";
import { SuppliersController } from "./suppliers.controller";
import { SuppliersRepository } from "./suppliers.repository";

@Module({
  controllers: [SuppliersController],
  providers: [SuppliersRepository],
})
export class SuppliersModule {}
