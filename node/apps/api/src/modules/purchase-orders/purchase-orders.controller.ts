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
  createPurchaseOrderSchema,
  hasPermission,
  listQuerySchema,
  setApprovalSchema,
  updatePurchaseOrderSchema,
  type BulkApproval,
  type BulkApprovalResult,
  type CreatePurchaseOrder,
  type ListResponse,
  type PurchaseOrderDetail,
  type PurchaseOrderRow,
  type SetApproval,
  type UpdatePurchaseOrder,
} from "@accountmanagement/contracts";
import { PurchaseOrdersRepository } from "./purchase-orders.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * The subject is `purchase-orders` — PLURAL — from the ACTIVE `Form.FormName`
 * row, "Purchase Orders".
 *
 * RESOLVED AGAINST PRODUCTION, 8 Sep 2026, after the first deploy of this screen
 * answered it the expensive way: `GET /purchase-orders` returned
 * `403 Missing permission: purchase-order.view` for a user holding every right
 * the screen needs. This module shipped singular and was unusable for ten
 * minutes.
 *
 * The reason is worth keeping, because it is not simply "the plural won".
 * Production's `forms` table holds THREE rows for this one screen:
 *
 *   id | form_name            | is_active
 *   10 | Purchase Order       | f
 *   12 | Create PurchaseOrder | f
 *   14 | Purchase Orders      | t
 *
 * All three are granted to all three users, so counting grants distinguishes
 * nothing. Only id 14 is ACTIVE, and the permission builder filters on
 * `is_active` — so only `purchase-orders.*` ever reaches a token. That also
 * matches the seven `FormName == "Purchase Orders"` checks in the Razor views,
 * which were right all along.
 *
 * §5f's enumeration listed "Purchase Order" and was not careless: that row is
 * really there. It read a form name WITHOUT filtering on `is_active` and picked
 * a retired one.
 *
 * SO THE §5f RULE NEEDS A CLAUSE: read the subject off `forms`, and read it off
 * a row where `is_active` is true. A retired row with the obvious name will
 * happily mislead you, and every call 403s for everyone.
 */
const SUBJECT = "purchase-orders";

const filterSchema = z.object({
  siteId: z.string().uuid().optional(),
  isApproved: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  /**
   * The legacy list defaults this to Active rather than All. The default lives in
   * the screen, which can say what it is filtering; a repository that quietly
   * dropped inactive orders would answer "all orders" with some of them.
   */
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});

const listRequestSchema = listQuerySchema.and(filterSchema);

@Controller("purchase-orders")
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersRepository) {}

  @Get()
  @Permissions("purchase-orders.view")
  async list(
    @Query(new ZodValidationPipe(listRequestSchema))
    query: ReturnType<typeof listRequestSchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<PurchaseOrderRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };

    const filters = {
      siteId: query.siteId,
      isApproved: query.isApproved,
      isActive: query.isActive,
    };

    const [page, total] = await Promise.all([
      this.orders.list(query, filters),
      this.orders.total(query.search, filters),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  @Get(":id")
  @Permissions("purchase-orders.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<PurchaseOrderDetail> {
    return this.orders.findById(id);
  }

  /** The order number is issued here, per company, not accepted from the body. */
  @Post()
  @Permissions("purchase-orders.add")
  create(
    @Body(new ZodValidationPipe(createPurchaseOrderSchema)) body: CreatePurchaseOrder,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PurchaseOrderDetail> {
    return this.orders.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("purchase-orders.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePurchaseOrderSchema)) body: UpdatePurchaseOrder,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PurchaseOrderDetail> {
    return this.orders.update(id, body, actorId(caller));
  }

  @Patch(":id/approval")
  @Permissions("purchase-orders.approve")
  setApproval(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setApprovalSchema)) body: SetApproval,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PurchaseOrderDetail> {
    return this.orders.setApproval(id, body.isApproved, actorId(caller));
  }

  /**
   * Bulk approve from the dashboard queue — the fifth of the six panels, and the
   * first of the two §5p had to leave saying "not migrated" because the table did
   * not exist.
   */
  @Post("approvals")
  @Permissions("purchase-orders.approve")
  async setApprovalMany(
    @Body(new ZodValidationPipe(bulkApprovalSchema)) body: BulkApproval,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<BulkApprovalResult> {
    const updated = await this.orders.setApprovalMany(body.ids, body.isApproved, actorId(caller));
    return { updated };
  }

  @Delete(":id")
  @Permissions("purchase-orders.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.orders.remove(id, actorId(caller));
  }
}
