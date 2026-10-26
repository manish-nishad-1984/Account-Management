import { Module } from "@nestjs/common";
import { GridPreferencesController } from "./grid-preferences.controller";
import { GridPreferencesRepository } from "./grid-preferences.repository";
import { DateTagsController } from "./date-tags.controller";
import { DateTagsRepository } from "./date-tags.repository";

@Module({
  // The Excel Export's date tags are the same kind of thing: a person's own preference.
  controllers: [GridPreferencesController, DateTagsController],
  providers: [GridPreferencesRepository, DateTagsRepository],
})
export class GridPreferencesModule {}
