import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  ATTACHMENT_TYPES,
  createItemSchema,
  createUnitSchema,
  hasPermission,
  itemSheetFileName,
  listQuerySchema,
  updateItemSchema,
  updateUnitSchema,
  type CreateItem,
  type CreateUnit,
  type ItemDetail,
  type ItemRow,
  type ItemSheetImportResult,
  type ListResponse,
  type UnitRow,
  type UpdateItem,
  type UpdateUnit,
} from "@accountmanagement/contracts";
import { ItemsRepository } from "./items.repository";
import { UnitsRepository } from "./units.repository";
import { ItemSheetRejected, ItemSheetService } from "./item-sheet.service";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import { contentDisposition } from "../../common/storage/content-disposition";
import { readUploads } from "../../common/storage/multipart";
import { assertSpreadsheet } from "../../common/spreadsheet/assert-spreadsheet";
import type { AccessTokenClaims } from "../auth/token.service";

/** Matches `[FormPermissionAttribute("Item-View")]` and its Add/Edit/Delete siblings. */
const SUBJECT = "item";

/**
 * The export takes only the list's search box.
 *
 * Not the full `listQuerySchema`: `limit` and `cursor` are meaningless for a
 * file that is the whole filtered set by definition, and accepting them would
 * invite a caller to believe paging applies. `sortBy` is absent for the same
 * reason — a price list is read alphabetically.
 */
const exportQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});

@Controller("items")
export class ItemsController {
  constructor(
    private readonly items: ItemsRepository,
    private readonly sheets: ItemSheetService,
  ) {}

  @Get()
  @Permissions("item.view")
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ReturnType<typeof listQuerySchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<ItemRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };

    const [page, total] = await Promise.all([
      this.items.list(query),
      this.items.total(query.search),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  /**
   * The catalogue as an `.xlsx` — the legacy screen's "Download File".
   *
   * Declared before `:id` for readability only. Fastify's radix tree prefers
   * the static segment whatever the declaration order, which `sites/assignable`
   * and `users/options` already rely on.
   *
   * Guarded by `item.view`, the right for the list this is a rendering of. The
   * legacy action carries no `[FormPermissionAttribute]` at all, so anyone who
   * can reach the site can download the entire price list — finding C-6 again,
   * and closed here for the reason supplier edit was: a missing authorization
   * check is not a business rule to be faithfully reproduced.
   */
  @Get("export")
  @Permissions("item.view")
  async export(
    @Query(new ZodValidationPipe(exportQuerySchema)) query: { search?: string },
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const bytes = await this.sheets.export(query.search);

    await reply
      .header("Content-Type", ATTACHMENT_TYPES[".xlsx"]!)
      .header("Content-Length", bytes.byteLength)
      .header("Content-Disposition", contentDisposition(itemSheetFileName(new Date())))
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, no-store")
      .send(bytes);
  }

  /**
   * "Upload File" — replaces `ItemMasterController.ImportExcelFile`.
   *
   * `item.add`, which is the right the legacy action carries. Rows matching an
   * existing live item are refused rather than applied, so this only ever adds;
   * if it is ever made an upsert it needs `item.edit` as well.
   */
  @Post("import")
  @Permissions("item.add")
  @HttpCode(200)
  async import(
    @Req() request: FastifyRequest,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ItemSheetImportResult> {
    const files = await readUploads(request);
    if (files.length !== 1) {
      throw new BadRequestException("Send one spreadsheet, not several.");
    }

    const file = files[0]!;
    assertSpreadsheet(file.fileName, file.bytes);

    try {
      return await this.sheets.import(file.bytes, actorId(caller));
    } catch (error) {
      if (error instanceof ItemSheetRejected) {
        // The whole result, not just a sentence. The screen renders a table of
        // every bad row, so the file gets fixed once rather than one upload per
        // problem — which is what the legacy importer's return-on-first-error
        // costs a user cleaning a 758-row catalogue.
        throw new BadRequestException({
          message: `Nothing was imported. ${error.result.errors.length} ${
            error.result.errors.length === 1 ? "problem" : "problems"
          } to fix.`,
          ...error.result,
        });
      }
      throw error;
    }
  }

  @Get(":id")
  @Permissions("item.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<ItemDetail> {
    return this.items.findById(id);
  }

  @Post()
  @Permissions("item.add")
  create(
    @Body(new ZodValidationPipe(createItemSchema)) body: CreateItem,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ItemDetail> {
    return this.items.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("item.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateItemSchema)) body: UpdateItem,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ItemDetail> {
    return this.items.update(id, body, actorId(caller));
  }

  @Delete(":id")
  @Permissions("item.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.items.remove(id, actorId(caller));
  }
}

/**
 * Units are managed from the Items screen and guarded by the ITEM permissions.
 *
 * `UnitMaster` has no form row and no `[FormPermissionAttribute]` anywhere in the
 * .NET solution — units are edited, if at all, straight in the database. Rather
 * than invent a `unit` subject that no migrated `Form` row would ever grant, the
 * unit list is treated as part of the item master: if you may add an item you may
 * add the unit it is measured in.
 *
 * Reading units needs only `item.view`, because the item form cannot render its
 * unit dropdown without them.
 */
@Controller("units")
export class UnitsController {
  constructor(private readonly units: UnitsRepository) {}

  @Get()
  @Permissions("item.view")
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ReturnType<typeof listQuerySchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<UnitRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: false,
    };

    const [page, total] = await Promise.all([
      this.units.list(query),
      this.units.total(query.search),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  @Post()
  @Permissions("item.add")
  async create(
    @Body(new ZodValidationPipe(createUnitSchema)) body: CreateUnit,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<UnitRow> {
    const row = await this.units.create(body, actorId(caller));
    return { ...row, capabilities: { canEdit: true, canDelete: true, canApprove: false } };
  }

  @Patch(":id")
  @Permissions("item.edit")
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateUnitSchema)) body: UpdateUnit,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<UnitRow> {
    const row = await this.units.update(id, body, actorId(caller));
    return { ...row, capabilities: { canEdit: true, canDelete: true, canApprove: false } };
  }

  /** Hard delete — 409 with the count if any live item still uses the unit. */
  @Delete(":id")
  @Permissions("item.delete")
  @HttpCode(204)
  remove(@Param("id", ParseIntPipe) id: number): Promise<void> {
    return this.units.remove(id);
  }
}
