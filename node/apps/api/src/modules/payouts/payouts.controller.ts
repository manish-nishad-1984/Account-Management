import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  createPayoutListSchema,
  hasPermission,
  listQuerySchema,
  updatePayoutListSchema,
  type CreatePayoutList,
  type ListQuery,
  type ListResponse,
  type PayoutListDetail,
  type PayoutListRow,
  type PayoutOutstandingResponse,
  type UpdatePayoutList,
} from "@accountmanagement/contracts";
import { PayoutsRepository } from "./payouts.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * Subject `payout`, from the form row "Payout" that migration 0022 inserts.
 * A list is a plan and never touches the ledger, so there is no approval.
 */
const SUBJECT = "payout";

@Controller("payout-lists")
export class PayoutsController {
  constructor(private readonly payouts: PayoutsRepository) {}

  @Get()
  @Permissions("payout.view")
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<PayoutListRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: false,
    };
    const [page, total] = await Promise.all([this.payouts.list(query), this.payouts.total(query.search)]);
    return { rows: page.rows.map((row) => ({ ...row, capabilities })), nextCursor: page.nextCursor, total };
  }

  /** A static segment beside `:id` — Fastify prefers it whatever the order. */
  @Get("outstanding")
  @Permissions("payout.view")
  outstanding(): Promise<PayoutOutstandingResponse> {
    return this.payouts.outstanding();
  }

  @Get(":id")
  @Permissions("payout.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<PayoutListDetail> {
    return this.payouts.findById(id);
  }

  @Post()
  @Permissions("payout.add")
  create(
    @Body(new ZodValidationPipe(createPayoutListSchema)) body: CreatePayoutList,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PayoutListDetail> {
    return this.payouts.create(body, actorId(caller));
  }

  /** The same body as create: a PATCH sends the whole list and replaces its lines. */
  @Patch(":id")
  @Permissions("payout.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePayoutListSchema)) body: UpdatePayoutList,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PayoutListDetail> {
    return this.payouts.update(id, body, actorId(caller));
  }

  @Delete(":id")
  @Permissions("payout.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.payouts.remove(id, actorId(caller));
  }
}
