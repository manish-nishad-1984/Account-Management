import {
  BadRequestException,
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
  Req,
} from "@nestjs/common";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import {
  clientIncomeFilterSchema,
  createClientIncomeSchema,
  hasPermission,
  listQuerySchema,
  updateClientIncomeSchema,
  type ClientIncomeDetail,
  type ClientIncomeRow,
  type CreateClientIncome,
  type IncomeImportPreview,
  type IncomeImportResult,
  type ListResponse,
  type UpdateClientIncome,
} from "@accountmanagement/contracts";
import { ClientIncomesRepository } from "./client-incomes.repository";
import { IncomeImportRejected, IncomeImportService } from "./income-import.service";
import { readUploads } from "../../common/storage/multipart";
import { assertSpreadsheet } from "../../common/spreadsheet/assert-spreadsheet";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { dateRangeOf } from "../../common/date-range";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/** Subject `income`, from the form row "Income" that migration 0025 inserts. */
const SUBJECT = "income";

const listRequestSchema = listQuerySchema.and(clientIncomeFilterSchema);

/** What the person verified on the import preview. */
const importConfirmSchema = z.object({
  count: z.coerce.number().int().nonnegative(),
  total: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
});

@Controller("client-incomes")
export class ClientIncomesController {
  constructor(
    private readonly incomes: ClientIncomesRepository,
    private readonly importer: IncomeImportService,
  ) {}

  /** "Import income" from the balance sheet, step 1 (client, 26 Oct 2026): every row checked, nothing saved. */
  @Post("import/preview")
  @Permissions("income.add")
  @HttpCode(200)
  async importPreview(@Req() request: FastifyRequest): Promise<IncomeImportPreview> {
    const file = await this.oneSpreadsheet(request);
    return this.importer.preview(file.bytes);
  }

  /** Step 2: the same file, with the count and total the person verified. All or nothing. */
  @Post("import")
  @Permissions("income.add")
  @HttpCode(200)
  async importIncomes(
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(importConfirmSchema)) confirm: { count: number; total: string },
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<IncomeImportResult> {
    const file = await this.oneSpreadsheet(request);
    try {
      return await this.importer.import(file.bytes, actorId(caller), confirm);
    } catch (error) {
      if (error instanceof IncomeImportRejected) {
        throw new BadRequestException({
          message: `Nothing was imported. ${error.preview.errors.length} ${error.preview.errors.length === 1 ? "problem" : "problems"} to fix.`,
          ...error.preview,
        });
      }
      throw error;
    }
  }

  private async oneSpreadsheet(request: FastifyRequest) {
    const files = await readUploads(request);
    if (files.length !== 1) {
      throw new BadRequestException("Send one spreadsheet, not several.");
    }
    const file = files[0]!;
    assertSpreadsheet(file.fileName, file.bytes);
    return file;
  }

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
    const filter = { siteId: query.siteId, companyId: query.companyId, clientId: query.clientId, ...dateRangeOf(query) };
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
