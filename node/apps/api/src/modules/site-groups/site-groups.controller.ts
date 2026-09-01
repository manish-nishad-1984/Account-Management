import { Controller, Get, Query } from "@nestjs/common";
import {
  hasPermission,
  listQuerySchema,
  type ListResponse,
  type SiteGroupRow,
} from "@accountmanagement/contracts";
import { SiteGroupsRepository } from "./site-groups.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * Subject `group`, matching `[FormPermissionAttribute("Group-View")]`.
 *
 * Note what is NOT in the .NET code: there is no `Group-Add`, `Group-Edit` or
 * `Group-Delete` attribute anywhere in the solution — only `Group-View`. Creating
 * and deleting site groups is therefore unauthorised in the app today, an
 * instance of assessment finding C-6. The capability flags below are still
 * computed from `group.add`/`.edit`/`.delete`, so when the write endpoints land
 * they are gated from the first commit rather than retrofitted. Nobody holds
 * those rights yet, which is the correct default.
 */
const SUBJECT = "group";

@Controller("site-groups")
export class SiteGroupsController {
  constructor(private readonly groups: SiteGroupsRepository) {}

  @Get()
  @Permissions("group.view")
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ReturnType<typeof listQuerySchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<SiteGroupRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };

    const [page, total] = await Promise.all([
      this.groups.list(query),
      this.groups.total(query.search),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
    };
  }
}
