import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  createBalanceSheetSchema,
  hasPermission,
  listQuerySchema,
  updateBalanceSheetSchema,
  type BalanceSheetPreview,
  type CreateBalanceSheet,
  type ListQuery,
  type ListResponse,
  type SavedBalanceSheetDetail,
  type SavedBalanceSheetRow,
  type UpdateBalanceSheet,
} from "@accountmanagement/contracts";
import { SavedBalanceSheetsRepository } from "./saved-balance-sheets.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/** Subject `balance-sheets`, from the form row "Balance Sheets" that migration 0027 inserts. */
const SUBJECT = "balance-sheets";

/** The list screen's one extra filter: the company the sheet was made for. */
const listFilterSchema = listQuerySchema.extend({ companyId: z.string().uuid().optional() });

/**
 * Saved Balance Sheets. A sheet adds up income and expense, so working one out
 * needs `balance-sheets.add` (or `.edit`), which the migration grants only to
 * people who already hold Income; the figures are worked out here, never taken
 * from the body.
 */
@Controller("balance-sheets")
export class SavedBalanceSheetsController {
  constructor(private readonly sheets: SavedBalanceSheetsRepository) {}

  @Get()
  @Permissions("balance-sheets.view")
  async list(
    @Query(new ZodValidationPipe(listFilterSchema)) query: ListQuery & { companyId?: string },
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<SavedBalanceSheetRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: false,
    };
    const [page, total] = await Promise.all([
      this.sheets.list(query, query.companyId),
      this.sheets.total(query.search, query.companyId),
    ]);
    return { rows: page.rows.map((row) => ({ ...row, capabilities })), nextCursor: page.nextCursor, total };
  }

  /** The sheet as it would be, for the form's Generate. A static segment, so it never reads as `:id`. */
  @Post("preview")
  @Permissions("balance-sheets.add")
  @HttpCode(200)
  preview(
    @Body(new ZodValidationPipe(createBalanceSheetSchema)) body: CreateBalanceSheet,
  ): Promise<BalanceSheetPreview> {
    return this.sheets.preview(body);
  }

  @Get(":id")
  @Permissions("balance-sheets.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<SavedBalanceSheetDetail> {
    return this.sheets.findById(id);
  }

  @Post()
  @Permissions("balance-sheets.add")
  create(
    @Body(new ZodValidationPipe(createBalanceSheetSchema)) body: CreateBalanceSheet,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SavedBalanceSheetDetail> {
    return this.sheets.create(body, actorId(caller));
  }

  /** Works the sheet out afresh from the new filters and replaces its rows. */
  @Patch(":id")
  @Permissions("balance-sheets.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateBalanceSheetSchema)) body: UpdateBalanceSheet,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SavedBalanceSheetDetail> {
    return this.sheets.update(id, body, actorId(caller));
  }

  @Delete(":id")
  @Permissions("balance-sheets.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.sheets.remove(id, actorId(caller));
  }
}
