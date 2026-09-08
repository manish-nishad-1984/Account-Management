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
 * The subject is `purchase-order`, from `Form.FormName` = "Purchase Order".
 *
 * UNRESOLVED, AND IT MUST BE CHECKED BEFORE THIS SCREEN GOES LIVE.
 *
 * The PO Razor views check `FormName == "Purchase Orders"` — PLURAL, seven times
 * across `POListView.cshtml` and its partials, counted not sampled. The dev seed
 * and §5f's enumeration of the production `forms` table both say "Purchase Order",
 * SINGULAR. They cannot both be right, and `Migration-Assessment/db-extract/` is
 * still empty, so the production table cannot be consulted from here.
 *
 * If production holds the plural, the derived subject is `purchase-orders` and
 * every call from this controller 403s for everyone — which is precisely the §5f
 * trap, where six screens carried subjects no `Form` row granted and were inert
 * only because they were placeholders.
 *
 * One line to change if it goes the other way. Do not guess it a second time:
 * read it off `forms`.
 */
const SUBJECT = "purchase-order";

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
  @Permissions("purchase-order.view")
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
  @Permissions("purchase-order.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<PurchaseOrderDetail> {
    return this.orders.findById(id);
  }

  /** The order number is issued here, per company, not accepted from the body. */
  @Post()
  @Permissions("purchase-order.add")
  create(
    @Body(new ZodValidationPipe(createPurchaseOrderSchema)) body: CreatePurchaseOrder,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PurchaseOrderDetail> {
    return this.orders.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("purchase-order.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePurchaseOrderSchema)) body: UpdatePurchaseOrder,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PurchaseOrderDetail> {
    return this.orders.update(id, body, actorId(caller));
  }

  @Patch(":id/approval")
  @Permissions("purchase-order.approve")
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
  @Permissions("purchase-order.approve")
  async setApprovalMany(
    @Body(new ZodValidationPipe(bulkApprovalSchema)) body: BulkApproval,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<BulkApprovalResult> {
    const updated = await this.orders.setApprovalMany(body.ids, body.isApproved, actorId(caller));
    return { updated };
  }

  @Delete(":id")
  @Permissions("purchase-order.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.orders.remove(id, actorId(caller));
  }
}
