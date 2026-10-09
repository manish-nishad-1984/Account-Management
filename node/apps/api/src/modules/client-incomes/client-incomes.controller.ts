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
  clientIncomeFilterSchema,
  createClientIncomeSchema,
  hasPermission,
  listQuerySchema,
  updateClientIncomeSchema,
  type ClientIncomeDetail,
  type ClientIncomeRow,
  type CreateClientIncome,
  type ListResponse,
  type UpdateClientIncome,
} from "@accountmanagement/contracts";
import { ClientIncomesRepository } from "./client-incomes.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/** Subject `income`, from the form row "Income" that migration 0025 inserts. */
const SUBJECT = "income";

const listRequestSchema = listQuerySchema.and(clientIncomeFilterSchema);

@Controller("client-incomes")
export class ClientIncomesController {
  constructor(private readonly incomes: ClientIncomesRepository) {}

  @Get()
  @Permissions("income.view")
  async list(
    @Query(new ZodValidationPipe(listRequestSchema)) query: ReturnType<typeof listRequestSchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<ClientIncomeRow> & { totalAmount: string }> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: false,
    };
    const filter = { siteId: query.siteId, companyId: query.companyId, clientId: query.clientId };
    const [page, total, totalAmount] = await Promise.all([
      this.incomes.list(query, filter),
      this.incomes.total(query.search, filter),
      this.incomes.sumOf(query.search, filter),
    ]);
    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
      totalAmount,
    };
  }

  @Get(":id")
  @Permissions("income.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<ClientIncomeDetail> {
    return this.incomes.findById(id);
  }

  @Post()
  @Permissions("income.add")
  create(
    @Body(new ZodValidationPipe(createClientIncomeSchema)) body: CreateClientIncome,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ClientIncomeDetail> {
    return this.incomes.create(body, actorId(caller));
  }

  /** The same body as create: the whole entry is sent and replaces the old one. */
  @Patch(":id")
  @Permissions("income.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateClientIncomeSchema)) body: UpdateClientIncome,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ClientIncomeDetail> {
    return this.incomes.update(id, body, actorId(caller));
  }

  @Delete(":id")
  @Permissions("income.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.incomes.remove(id, actorId(caller));
  }
}
