import { z } from "zod";
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
  confirmPayoutListSchema,
  createPayoutListSchema,
  hasPermission,
  listQuerySchema,
  payoutDetailRequestSchema,
  updatePayoutListSchema,
  type ConfirmPayoutList,
  type CreatePayoutList,
  type ListQuery,
  type ListResponse,
  type PayoutDetailRequest,
  type PayoutDetailResponse,
  type PayoutListDetail,
  type PayoutListRow,
  type PayoutOutstandingResponse,
  type SalaryDueResponse,
  type UpdatePayoutList,
} from "@accountmanagement/contracts";
import { PayoutsRepository } from "./payouts.repository";
import { EmployeesRepository } from "../employees/employees.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { dateRangeFilterSchema, dateRangeOf, type DateRangeFilter } from "../../common/date-range";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * Subject `payout`, from the form row "Payout" that migration 0022 inserts.
 * A list is a plan and never touches the ledger, so there is no approval.
 */
const SUBJECT = "payout";

/** The site in the header's filter, or nothing for every site. */
/** The list screen's one extra filter: the company the list was built for. */
const listFilterSchema = listQuerySchema.extend({ companyId: z.string().uuid().optional() }).merge(dateRangeFilterSchema);

const outstandingQuerySchema = z.object({ siteId: z.string().uuid().optional(), companyId: z.string().uuid().optional() });

const salariesDueQuerySchema = z.object({
  listDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  companyId: z.string().uuid().optional(),
});

@Controller("payout-lists")
export class PayoutsController {
  constructor(
    private readonly payouts: PayoutsRepository,
    private readonly employees: EmployeesRepository,
  ) {}

  @Get()
  @Permissions("payout.view")
  async list(
    @Query(new ZodValidationPipe(listFilterSchema)) query: ListQuery & { companyId?: string } & DateRangeFilter,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<PayoutListRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      // "Approve" on the Payout form is the right to CONFIRM a list (and reverse it).
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };
    const [page, total] = await Promise.all([
      this.payouts.list(query, query.companyId, dateRangeOf(query)),
      this.payouts.total(query.search, query.companyId, dateRangeOf(query)),
    ]);
    return { rows: page.rows.map((row) => ({ ...row, capabilities })), nextCursor: page.nextCursor, total };
  }

  /** A static segment beside `:id` — Fastify prefers it whatever the order. */
  @Get("outstanding")
  @Permissions("payout.view")
  outstanding(
    @Query(new ZodValidationPipe(outstandingQuerySchema)) query: { siteId?: string; companyId?: string },
  ): Promise<PayoutOutstandingResponse> {
    return this.payouts.outstanding(query.siteId, query.companyId);
  }

  /** "Export to Excel" with details: the parties and bills of the lists named. */
  @Post("lines")
  @Permissions("payout.view")
  @HttpCode(200)
  async lines(
    @Body(new ZodValidationPipe(payoutDetailRequestSchema)) body: PayoutDetailRequest,
  ): Promise<PayoutDetailResponse> {
    const [lines, salaries] = await Promise.all([this.payouts.linesOf(body.ids), this.payouts.salariesOf(body.ids)]);
    return { lines, salaries };
  }

  /**
   * The salaries still to be paid on a list for `listDate` (client, 23 Oct 2026):
   * each active employee's unpaid months before the list's month.
   */
  @Get("salaries-due")
  @Permissions("payout.view")
  async salariesDue(
    @Query(new ZodValidationPipe(salariesDueQuerySchema)) query: { listDate: string; companyId?: string },
  ): Promise<SalaryDueResponse> {
    return { rows: await this.employees.salariesDue(query.listDate, query.companyId) };
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

  /**
   * CONFIRM: the owner has paid, and this user records it. Makes the payments and
   * settles the bills; see PayoutsRepository.confirm. Its own right, `payout.approve`,
   * because it moves the ledger.
   */
  @Post(":id/confirm")
  @Permissions("payout.approve")
  confirm(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(confirmPayoutListSchema)) body: ConfirmPayoutList,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PayoutListDetail> {
    return this.payouts.confirm(id, body, actorId(caller));
  }

  /** Undo a confirmation: removes the payments it made and opens its bills again. */
  @Post(":id/reverse")
  @Permissions("payout.approve")
  reverse(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PayoutListDetail> {
    return this.payouts.reverse(id, actorId(caller));
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
