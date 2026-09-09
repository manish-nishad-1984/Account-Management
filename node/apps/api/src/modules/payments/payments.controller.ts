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
import { z } from "zod";
import {
  createPaymentBatchSchema,
  hasPermission,
  listQuerySchema,
  PAYMENT_DIRECTIONS,
  updatePaymentSchema,
  type CreatePaymentBatch,
  type ListResponse,
  type PaymentBatchResult,
  type PaymentDetail,
  type PaymentRow,
  type UpdatePayment,
} from "@accountmanagement/contracts";
import { PaymentsRepository } from "./payments.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * `Reports & Payments` is the form name on `/Report/ReportDetails` itself
 * (`FormName == "Reports & Payments"`, twice), which slugifies to this.
 *
 * THAT SCREEN CHECKS THREE DIFFERENT FORM NAMES. Counted in the source rather
 * than guessed, which §5f made a rule after `nav.ts` carried six subjects no
 * `Form` row granted:
 *
 *   ReportDetails.cshtml   2x  "Reports & Payments"
 *   its partials           3x  "Details Report & Payout"
 *   its partials           1x  "Reports"
 *
 * One screen, three subjects, and a right granted under one of them does
 * nothing for the checks written against the other two. Doc 11 already flagged
 * this ("Three different permission-name strings for one screen") without
 * saying which wins: none does, because each check reads only its own name.
 *
 * The port uses ONE subject per screen — this for payments, `details-report`
 * for the ledger, `sales-report` for the sales summary — and doc 19 Question 14
 * asks which of the three legacy names actually carries the grants in
 * production, because that decides who can still work on day one.
 */
const SUBJECT = "reports-payments";

const filterSchema = z.object({
  direction: z.enum(PAYMENT_DIRECTIONS).optional(),
  partyId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
});

const listRequestSchema = listQuerySchema.and(filterSchema);

@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsRepository) {}

  @Get()
  @Permissions("reports-payments.view")
  async list(
    @Query(new ZodValidationPipe(listRequestSchema))
    query: ReturnType<typeof listRequestSchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<PaymentRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: false,
    };

    const filters = {
      direction: query.direction,
      partyId: query.partyId,
      companyId: query.companyId,
      siteId: query.siteId,
    };

    const [page, total] = await Promise.all([
      this.payments.list(query, filters),
      this.payments.total(query.search, filters),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  @Get(":id")
  @Permissions("reports-payments.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<PaymentDetail> {
    return this.payments.findById(id);
  }

  /**
   * The repeater posts as a batch, matching `InsertPayOutDetailsReport`.
   *
   * 200 rather than 201: the response is a count, not a created resource, and
   * there is no single Location to point at. `POST /items/import` is the same
   * shape for the same reason.
   */
  @Post()
  @Permissions("reports-payments.add")
  @HttpCode(200)
  async create(
    @Body(new ZodValidationPipe(createPaymentBatchSchema)) body: CreatePaymentBatch,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PaymentBatchResult> {
    const created = await this.payments.createMany(body.payments, actorId(caller));
    return { created };
  }

  @Patch(":id")
  @Permissions("reports-payments.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePaymentSchema)) body: UpdatePayment,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PaymentDetail> {
    return this.payments.update(id, body, actorId(caller));
  }

  @Delete(":id")
  @Permissions("reports-payments.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.payments.remove(id, actorId(caller));
  }
}
