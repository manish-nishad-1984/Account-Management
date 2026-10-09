import { Module } from "@nestjs/common";
import { GridExportController } from "./grid-export.controller";

@Module({ controllers: [GridExportController] })
export class GridExportModule {}
