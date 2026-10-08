import {
  Body,
  BadRequestException,
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
import { ReportsRepository } from "../reports/reports.repository";
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
  constructor(
    private readonly payments: PaymentsRepository,
    private readonly reports: ReportsRepository,
  ) {}

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
    await this.checkNamedBills(body.payments);
    const created = await this.payments.createMany(body.payments, actorId(caller));
    return { created };
  }

  /**
   * A payment may name the bills it pays. Each must be a bill of THIS party,
   * company and site that still has that much to pay - the same pending the
   * Pending Outstanding report shows - or the whole batch is refused, with the
   * row and bill in the message.
   */
  private async checkNamedBills(batch: CreatePaymentBatch["payments"]): Promise<void> {
    const toPaise = (value: string) => Math.round(Number.parseFloat(value) * 100);
    for (const [index, payment] of batch.entries()) {
      if (payment.allocations.length === 0) continue;
      if (payment.direction !== "out" || payment.kind !== "payment") {
        throw new BadRequestException(`Row ${index + 1}: only a payment to a supplier can name bills`);
      }
      const open = new Map<string, { pending: number; displayNo: string }>();
      for (let offset = 0; ; offset += 200) {
        const page = await this.reports.pendingLedger(
          { direction: "out", partyId: payment.partyId, companyId: payment.companyId, siteId: payment.siteId ?? undefined },
          { limit: 200, offset },
        );
        for (const row of page.rows) open.set(`${row.source}:${row.documentId}`, { pending: toPaise(row.pending), displayNo: row.displayNo });
        if (page.nextCursor === null) break;
      }
      for (const named of payment.allocations) {
        const bill = open.get(`${named.source}:${named.documentId}`);
        if (!bill) {
          throw new BadRequestException(`Row ${index + 1}: a bill named is not owed to this supplier at this site and company`);
        }
        if (toPaise(named.amount) > bill.pending) {
          throw new BadRequestException(`Row ${index + 1}: only ${(bill.pending / 100).toFixed(2)} is pending on ${bill.displayNo}`);
        }
      }
    }
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
