import { Controller, Get, Query } from "@nestjs/common";
import {
  hasPermission,
  listQuerySchema,
  type ListResponse,
  type SiteRow,
} from "@accountmanagement/contracts";
import { SitesRepository } from "./sites.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { AccessTokenClaims } from "../auth/token.service";

/** Matches `[FormPermissionAttribute("Site-View")]` in the .NET controllers. */
const SUBJECT = "site";

@Controller("sites")
export class SitesController {
  constructor(private readonly sites: SitesRepository) {}

  @Get()
  @Permissions("site.view")
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ReturnType<typeof listQuerySchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<SiteRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };

    const [page, total] = await Promise.all([
      this.sites.list(query),
      this.sites.total(query.search),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
    };
  }
}
