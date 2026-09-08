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
  createPurchaseInvoiceSchema,
  hasPermission,
  listQuerySchema,
  setApprovalSchema,
  updatePurchaseInvoiceSchema,
  type BulkApproval,
  type BulkApprovalResult,
  type CreatePurchaseInvoice,
  type ListResponse,
  type PurchaseInvoiceDetail,
  type PurchaseInvoiceRow,
  type SetApproval,
  type UpdatePurchaseInvoice,
} from "@accountmanagement/contracts";
import { PurchaseInvoicesRepository } from "./purchase-invoices.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * The subject is `purchase-invoice` — SINGULAR, and NOT the plural its neighbour
 * uses.
 *
 * Read off the live `forms` table on 8 Sep 2026, BEFORE this file was written,
 * because the purchase order module got it wrong the other way round and spent a
 * production deploy discovering it:
 *
 *   id | form_name           | controller    | is_active
 *    6 | Create Invoice      | InvoiceMaster | f
 *    9 | Purchase  Invoice   | InvoiceMaster | t      <- DOUBLE SPACE, and active
 *   27 | Sales Invoice       | Sales         | t
 *
 * Two traps in one row. The active name is SINGULAR while purchase orders' is
 * plural, so the neighbouring module is the wrong template; and it contains a
 * DOUBLE SPACE, which is harmless only because `slug()` collapses runs of
 * non-alphanumerics with a `+` quantifier. A slug that replaced single
 * characters would yield `purchase--invoice` and 403 everything. Verified by
 * running the real `slug` over the real string rather than reading it.
 *
 * `Create Invoice` is INACTIVE and is granted to all three users, so its grants
 * never reach a token — the §5f trap exactly.
 *
 * Grants on id 9 in production, which also tells us the rights split is real:
 *   ckalathiya, chintanauro  view/add/edit/delete/approve
 *   ac                       view + approve only
 */
const SUBJECT = "purchase-invoice";

const filterSchema = z.object({
  siteId: z.string().uuid().optional(),
  /** The legacy list filters by COMPANY — people work one company at a time. */
  companyId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  invoiceType: z.string().max(50).optional(),
  isApproved: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});

const listRequestSchema = listQuerySchema.and(filterSchema);

@Controller("purchase-invoices")
export class PurchaseInvoicesController {
  constructor(private readonly invoices: PurchaseInvoicesRepository) {}

  @Get()
  @Permissions("purchase-invoice.view")
  async list(
    @Query(new ZodValidationPipe(listRequestSchema))
    query: ReturnType<typeof listRequestSchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<PurchaseInvoiceRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };

    const filters = {
      siteId: query.siteId,
      companyId: query.companyId,
      supplierId: query.supplierId,
      invoiceType: query.invoiceType,
      isApproved: query.isApproved,
    };

    const [page, total] = await Promise.all([
      this.invoices.list(query, filters),
      this.invoices.total(query.search, filters),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  @Get(":id")
  @Permissions("purchase-invoice.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<PurchaseInvoiceDetail> {
    return this.invoices.findById(id);
  }

  /**
   * The totals are computed here, never taken from the body — including the TDS
   * term the live screen's winning calculator does not read at all.
   */
  @Post()
  @Permissions("purchase-invoice.add")
  create(
    @Body(new ZodValidationPipe(createPurchaseInvoiceSchema)) body: CreatePurchaseInvoice,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PurchaseInvoiceDetail> {
    return this.invoices.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("purchase-invoice.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePurchaseInvoiceSchema)) body: UpdatePurchaseInvoice,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PurchaseInvoiceDetail> {
    return this.invoices.update(id, body, actorId(caller));
  }

  @Patch(":id/approval")
  @Permissions("purchase-invoice.approve")
  setApproval(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setApprovalSchema)) body: SetApproval,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<PurchaseInvoiceDetail> {
    return this.invoices.setApproval(id, body.isApproved, actorId(caller));
  }

  /**
   * Bulk approve from the dashboard queue — the SIXTH panel, and the last one
   * §5p had to leave saying "not migrated" because its table did not exist.
   */
  @Post("approvals")
  @Permissions("purchase-invoice.approve")
  async setApprovalMany(
    @Body(new ZodValidationPipe(bulkApprovalSchema)) body: BulkApproval,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<BulkApprovalResult> {
    const updated = await this.invoices.setApprovalMany(body.ids, body.isApproved, actorId(caller));
    return { updated };
  }

  /** A real delete — `SupplierInvoice` has no soft-delete column to set. */
  @Delete(":id")
  @Permissions("purchase-invoice.delete")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.invoices.remove(id);
  }
}
