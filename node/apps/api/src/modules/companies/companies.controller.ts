import { Controller, Get, Query } from "@nestjs/common";
import {
  hasPermission,
  listQuerySchema,
  type CompanyRow,
  type ListResponse,
} from "@accountmanagement/contracts";
import { CompaniesRepository } from "./companies.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * Subject `company` matches the permission names the .NET app already uses —
 * `[FormPermissionAttribute("Company-View")]` and its Add/Edit/Delete siblings —
 * so the migrated `Form` rows keep working without a mapping table.
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
}
