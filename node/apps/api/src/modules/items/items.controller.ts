import {
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
} from "@nestjs/common";
import {
  createItemSchema,
  createUnitSchema,
  hasPermission,
  listQuerySchema,
  updateItemSchema,
  updateUnitSchema,
  type CreateItem,
  type CreateUnit,
  type ItemDetail,
  type ItemRow,
  type ListResponse,
  type UnitRow,
  type UpdateItem,
  type UpdateUnit,
} from "@accountmanagement/contracts";
import { ItemsRepository } from "./items.repository";
import { UnitsRepository } from "./units.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/** Matches `[FormPermissionAttribute("Item-View")]` and its Add/Edit/Delete siblings. */
const SUBJECT = "item";

@Controller("items")
export class ItemsController {
  constructor(private readonly items: ItemsRepository) {}

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
