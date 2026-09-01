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
  createCompanySchema,
  hasPermission,
  listQuerySchema,
  updateCompanySchema,
  type CompanyDetail,
  type CompanyRow,
  type CreateCompany,
  type ListResponse,
  type UpdateCompany,
} from "@accountmanagement/contracts";
import { CompaniesRepository } from "./companies.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * Subject `company` matches the permission names the .NET app already uses —
 * `[FormPermissionAttribute("Company-View")]` and its Add/Edit/Delete siblings —
 * so the migrated `Form` rows keep working without a mapping table.
 *
 * All four rights exist in the source, so all four routes here are guarded by
 * the one that corresponds. Note the difference from the .NET side: there the
 * attribute sits on the MVC action in the Web tier, and the API endpoint behind
 * it has no authorization at all, so calling the API directly bypasses every one
 * of them (assessment finding C-6). Here the guard is on the API itself.
 */
const SUBJECT = "company";

@Controller("companies")
export class CompaniesController {
  constructor(private readonly companies: CompaniesRepository) {}

  @Get()
  @Permissions("company.view")
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ReturnType<typeof listQuerySchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<CompanyRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };

    const [page, total] = await Promise.all([
      this.companies.list(query),
      this.companies.total(query.search),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  /**
   * The full record, including the bank account number and IFSC that the list
   * deliberately withholds. Still only `company.view` — the point of keeping
   * them off the list is that reading them is one request per company and
   * therefore visible, not that it needs a second right.
   */
  @Get(":id")
  @Permissions("company.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<CompanyDetail> {
    return this.companies.findById(id);
  }

  @Post()
  @Permissions("company.add")
  create(
    @Body(new ZodValidationPipe(createCompanySchema)) body: CreateCompany,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<CompanyDetail> {
    return this.companies.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("company.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCompanySchema)) body: UpdateCompany,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<CompanyDetail> {
    return this.companies.update(id, body, actorId(caller));
  }

  /** Soft delete. 409 with the count if users are still assigned. */
  @Delete(":id")
  @Permissions("company.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.companies.remove(id, actorId(caller));
  }
}
