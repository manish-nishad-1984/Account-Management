import { Module } from "@nestjs/common";
import { GridPreferencesController } from "./grid-preferences.controller";
import { GridPreferencesRepository } from "./grid-preferences.repository";

@Module({
  controllers: [GridPreferencesController],
  providers: [GridPreferencesRepository],
})
export class GridPreferencesModule {}
