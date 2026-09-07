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
  createInventoryInwardSchema,
  hasPermission,
  listQuerySchema,
  setApprovalSchema,
  updateInventoryInwardSchema,
  type CreateInventoryInward,
  type InventoryInwardDetail,
  type InventoryInwardRow,
  type ListResponse,
  type SetApproval,
  type UpdateInventoryInward,
} from "@accountmanagement/contracts";
import { InventoryInwardRepository } from "./inventory-inward.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * The subject is `inventory-inward`, from `Form.FormName` = "Inventory Inward".
 *
 * NOT from the controller, which in the source is `Sales` — inventory inward
 * lives inside `SalesRepo.cs` alongside sales invoices. A controller-derived
 * subject would give anyone who can see a sales invoice the run of the stock
 * ledger, and vice versa.
 */
const SUBJECT = "inventory-inward";

const filterSchema = z.object({
  siteId: z.string().uuid().optional(),
  isApproved: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});

const listRequestSchema = listQuerySchema.and(filterSchema);

@Controller("inventory-inward")
export class InventoryInwardController {
  constructor(private readonly inventory: InventoryInwardRepository) {}

  @Get()
  @Permissions("inventory-inward.view")
  async list(
    @Query(new ZodValidationPipe(listRequestSchema))
    query: ReturnType<typeof listRequestSchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<InventoryInwardRow> & { unallocated: number }> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };

    const filters = { siteId: query.siteId, isApproved: query.isApproved };

    const [page, total, unallocated] = await Promise.all([
      this.inventory.list(query, filters),
      this.inventory.total(query.search, filters),
      this.inventory.unallocatedCount(),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
      /**
       * Rows with no site, which every imported row is. Returned so the screen
       * can say WHY a site-scoped list is showing rows from no site at all,
       * rather than leaving it looking like the scope is broken. Reaches zero
       * when the history is backfilled, and the notice disappears with it.
       */
      unallocated,
    };
  }

  @Get(":id")
  @Permissions("inventory-inward.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<InventoryInwardDetail> {
    return this.inventory.findById(id);
  }

  /** Created unapproved. The source hard-codes `IsApproved = true`; see the schema. */
  @Post()
  @Permissions("inventory-inward.add")
  create(
    @Body(new ZodValidationPipe(createInventoryInwardSchema)) body: CreateInventoryInward,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<InventoryInwardDetail> {
    return this.inventory.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("inventory-inward.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateInventoryInwardSchema)) body: UpdateInventoryInward,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<InventoryInwardDetail> {
    return this.inventory.update(id, body, actorId(caller));
  }

  /**
   * Its own endpoint with its own right, for the same reason as on purchase
   * requests: in the source `ApproveInventoryDetails` is reachable by anyone who
   * can reach the controller, and the approve right is checked only in the view.
   */
  @Patch(":id/approval")
  @Permissions("inventory-inward.approve")
  setApproval(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setApprovalSchema)) body: SetApproval,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<InventoryInwardDetail> {
    return this.inventory.setApproval(id, body.isApproved, actorId(caller));
  }

  /** A real soft delete. The source deletes the row outright — see the schema. */
  @Delete(":id")
  @Permissions("inventory-inward.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.inventory.remove(id, actorId(caller));
  }
}
