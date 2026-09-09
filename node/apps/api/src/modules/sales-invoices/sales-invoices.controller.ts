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
  createSalesInvoiceSchema,
  hasPermission,
  listQuerySchema,
  setApprovalSchema,
  updateSalesInvoiceSchema,
  type BulkApproval,
  type BulkApprovalResult,
  type CreateSalesInvoice,
  type ListResponse,
  type SalesInvoiceDetail,
  type SalesInvoiceRow,
  type SetApproval,
  type UpdateSalesInvoice,
} from "@accountmanagement/contracts";
import { SalesInvoicesRepository } from "./sales-invoices.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * The subject is `sales-invoice`, SINGULAR — from production `forms` id 27,
 * "Sales Invoice", active, controller `Sales`. Read off the live table before
 * this file was written.
 *
 * The controller name is NOT the subject and this row is the clearest reason
 * why: `Sales` also serves Inventory Inward (id 29), so a controller-derived
 * subject would collapse two unrelated screens into one permission.
 *
 * Production grants on id 27:
 *   ckalathiya, chintanauro  view/add/edit/delete/approve
 *   ac                       APPROVE ONLY — is_view_allow is false
 *
 * That last row is not a mistake to smooth over. `ac` can approve a sales
 * invoice from the dashboard queue while being unable to open this list, and
 * each decorator below is checked independently, so that is exactly what
 * happens. If the business wants approvers to be able to read what they are
 * approving, that is a grant to change in the data, not a guard to loosen here.
 */
const SUBJECT = "sales-invoice";

const filterSchema = z.object({
  siteId: z.string().uuid().optional(),
  /** The legacy list's company dropdown defaults to a real company, not "All". */
  companyId: z.string().uuid().optional(),
  /** The CUSTOMER. Named for what it means, not for the table it points at. */
  customerId: z.string().uuid().optional(),
  invoiceType: z.string().max(50).optional(),
  isApproved: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});

const listRequestSchema = listQuerySchema.and(filterSchema);

@Controller("sales-invoices")
export class SalesInvoicesController {
  constructor(private readonly invoices: SalesInvoicesRepository) {}

  @Get()
  @Permissions("sales-invoice.view")
  async list(
    @Query(new ZodValidationPipe(listRequestSchema))
    query: ReturnType<typeof listRequestSchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<SalesInvoiceRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };

    const filters = {
      siteId: query.siteId,
      companyId: query.companyId,
      customerId: query.customerId,
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
  @Permissions("sales-invoice.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<SalesInvoiceDetail> {
    return this.invoices.findById(id);
  }

  /**
   * The invoice number is issued here, per company and financial year, and is
   * not accepted from the body — the legacy form's Invoice No box is empty and
   * EDITABLE, so a number there can be typed over before submit.
   */
  @Post()
  @Permissions("sales-invoice.add")
  create(
    @Body(new ZodValidationPipe(createSalesInvoiceSchema)) body: CreateSalesInvoice,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SalesInvoiceDetail> {
    return this.invoices.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("sales-invoice.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSalesInvoiceSchema)) body: UpdateSalesInvoice,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SalesInvoiceDetail> {
    return this.invoices.update(id, body, actorId(caller));
  }

  @Patch(":id/approval")
  @Permissions("sales-invoice.approve")
  setApproval(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setApprovalSchema)) body: SetApproval,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SalesInvoiceDetail> {
    return this.invoices.setApproval(id, body.isApproved, actorId(caller));
  }

  @Post("approvals")
  @Permissions("sales-invoice.approve")
  async setApprovalMany(
    @Body(new ZodValidationPipe(bulkApprovalSchema)) body: BulkApproval,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<BulkApprovalResult> {
    const updated = await this.invoices.setApprovalMany(body.ids, body.isApproved, actorId(caller));
    return { updated };
  }

  @Delete(":id")
  @Permissions("sales-invoice.delete")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.invoices.remove(id);
  }
}
