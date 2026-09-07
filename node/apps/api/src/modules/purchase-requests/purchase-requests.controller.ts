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
  bulkApprovalSchema,
  createPurchaseRequestSchema,
  hasPermission,
  listQuerySchema,
  setApprovalSchema,
  updatePurchaseRequestSchema,
  type BulkApproval,
  type BulkApprovalResult,
  type CreatePurchaseRequest,
  type ListResponse,
  type PurchaseRequestDetail,
  type PurchaseRequestRow,
  type SetApproval,
  type UpdatePurchaseRequest,
} from "@accountmanagement/contracts";
import { PurchaseRequestsRepository } from "./purchase-requests.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * The subject is `purchase-request`, from `Form.FormName` = "Purchase Request".
 *
 * Derived from the FORM NAME, not the controller: `PurchaseMaster` serves
 * purchase requests AND purchase orders, so a controller-derived subject would
 * grant one the other's rights. That is the same defect fixed in
 * `drizzle-user.repository.ts`, and this is the module where it would first have
 * done real damage.
 */
const SUBJECT = "purchase-request";

/**
 * Filters the list accepts beyond the shared paging contract.
 *
 * `isApproved` drives the dashboard's pending queue. It is a string on the query
 * string, so it is coerced explicitly rather than left to JavaScript truthiness,
 * where "false" is true.
 */
const filterSchema = z.object({
  siteId: z.string().uuid().optional(),
  isApproved: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});

const listRequestSchema = listQuerySchema.and(filterSchema);

@Controller("purchase-requests")
export class PurchaseRequestsController {
  constructor(private readonly requests: PurchaseRequestsRepository) {}

  @Get()
  @Permissions("purchase-request.view")
  async list(
    @Query(new ZodValidationPipe(listRequestSchema))
    query: ReturnType<typeof listRequestSchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<PurchaseRequestRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };

    const filters = { siteId: query.siteId, isApproved: query.isApproved };

    const [page, total] = await Promise.all([
      this.requests.list(query, filters),
      this.requests.total(query.search, filters),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  @Get(":id")
  @Permissions("purchase-request.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<PurchaseRequestDetail> {
    return this.requests.findById(id);
  }

  /** The request number is issued here, not accepted from the body. */
  @Post()
  @Permissions("purchase-request.add")
  create(
    @Body(new ZodValidationPipe(createPurchaseRequestSchema)) body: CreatePurchaseRequest,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PurchaseRequestDetail> {
    return this.requests.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("purchase-request.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePurchaseRequestSchema)) body: UpdatePurchaseRequest,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PurchaseRequestDetail> {
    return this.requests.update(id, body, actorId(caller));
  }

  /**
   * Approval is its own endpoint with its own right.
   *
   * In the source, approving is a plain update reachable by anyone who can reach
   * the controller — the `approve` right existed in the permission matrix and was
   * checked only in the Razor view, so a view-only clerk could approve by calling
   * the API directly (assessment C-6). `@Permissions` closes that here.
   */
  @Patch(":id/approval")
  @Permissions("purchase-request.approve")
  setApproval(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setApprovalSchema)) body: SetApproval,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PurchaseRequestDetail> {
    return this.requests.setApproval(id, body.isApproved, actorId(caller));
  }

  /** Bulk approve from the dashboard queue. One UPDATE, not one per row. */
  @Post("approvals")
  @Permissions("purchase-request.approve")
  async setApprovalMany(
    @Body(new ZodValidationPipe(bulkApprovalSchema)) body: BulkApproval,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<BulkApprovalResult> {
    const updated = await this.requests.setApprovalMany(
      body.ids,
      body.isApproved,
      actorId(caller),
    );
    return { updated };
  }

  @Delete(":id")
  @Permissions("purchase-request.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.requests.remove(id, actorId(caller));
  }
}
