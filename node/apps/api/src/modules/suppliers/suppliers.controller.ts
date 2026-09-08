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
  createSupplierSchema,
  hasPermission,
  listQuerySchema,
  setApprovalSchema,
  updateSupplierSchema,
  type BulkApproval,
  type BulkApprovalResult,
  type CreateSupplier,
  type ListResponse,
  type SetApproval,
  type SupplierDetail,
  type SupplierRow,
  type UpdateSupplier,
} from "@accountmanagement/contracts";
import { SuppliersRepository } from "./suppliers.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * Subject `supplier`, matching `[FormPermissionAttribute("Supplier-View")]`.
 *
 * EDIT AND DELETE ARE GUARDED HERE THOUGH THEY ARE NOT IN THE SOURCE, and that
 * is a deliberate departure rather than an oversight.
 *
 * `SupplierController` carries `Supplier-View` and `Supplier-Add` and nothing
 * else: `UpdateSupplierDetails` (line 108), `DeleteSupplierDetails` (line 130)
 * and `ActiveDeactiveSupplier` (line 150) have no `[FormPermissionAttribute]` at
 * all. Anyone who can reach the site can edit or delete any supplier. That is
 * assessment finding C-6 — the same class of hole the global default-deny
 * `AuthGuard` exists to close — not a business rule someone chose.
 *
 * The convention that ported rules keep their defects applies to BUSINESS rules,
 * where reproducing the current answer is what makes the port verifiable. It does
 * not extend to reproducing a missing authorization check. Both rights are
 * expressible: permissions derive from the five boolean columns on
 * `user_form_permissions`, so `supplier.edit` and `supplier.delete` come from the
 * existing Supplier form row with no schema change and no new concept.
 *
 * This is worth putting to the business, because it will change who can do what
 * on day one: whoever currently edits suppliers needs the Edit box ticked.
 */
const SUBJECT = "supplier";

/**
 * The list's filters. `isApproved=false` is the dashboard's pending queue.
 *
 * Coerced from the string explicitly rather than left to truthiness, where the
 * string "false" is true.
 */
const filterSchema = z.object({
  isApproved: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});

const listRequestSchema = listQuerySchema.and(filterSchema);

@Controller("suppliers")
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersRepository) {}

  @Get()
  @Permissions("supplier.view")
  async list(
    @Query(new ZodValidationPipe(listRequestSchema))
    query: ReturnType<typeof listRequestSchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<SupplierRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };

    const filters = { isApproved: query.isApproved };

    const [page, total] = await Promise.all([
      this.suppliers.list(query, filters),
      this.suppliers.total(query.search, filters),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  @Get(":id")
  @Permissions("supplier.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<SupplierDetail> {
    return this.suppliers.findById(id);
  }

  @Post()
  @Permissions("supplier.add")
  create(
    @Body(new ZodValidationPipe(createSupplierSchema)) body: CreateSupplier,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SupplierDetail> {
    return this.suppliers.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("supplier.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema)) body: UpdateSupplier,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SupplierDetail> {
    return this.suppliers.update(id, body, actorId(caller));
  }

  /**
   * Approval, stated rather than toggled, and guarded.
   *
   * `ActiveDeactiveSupplier` (`SupplierController.cs:150`) is the third of the
   * three methods on that controller carrying no `[FormPermissionAttribute]` at
   * all — see the note on `SUBJECT` above. Same departure, same reason.
   */
  @Patch(":id/approval")
  @Permissions("supplier.approve")
  setApproval(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setApprovalSchema)) body: SetApproval,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SupplierDetail> {
    return this.suppliers.setApproval(id, body.isApproved, actorId(caller));
  }

  /** Bulk approve from the dashboard queue. One UPDATE, not one per row. */
  @Post("approvals")
  @Permissions("supplier.approve")
  async setApprovalMany(
    @Body(new ZodValidationPipe(bulkApprovalSchema)) body: BulkApproval,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<BulkApprovalResult> {
    const updated = await this.suppliers.setApprovalMany(
      body.ids,
      body.isApproved,
      actorId(caller),
    );
    return { updated };
  }

  @Delete(":id")
  @Permissions("supplier.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.suppliers.remove(id, actorId(caller));
  }
}
