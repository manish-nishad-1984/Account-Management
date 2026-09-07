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
  createSiteSchema,
  hasPermission,
  listQuerySchema,
  updateSiteSchema,
  type CreateSite,
  type ListResponse,
  type SiteDetail,
  type SiteRow,
  type SiteScopeResponse,
  type UpdateSite,
} from "@accountmanagement/contracts";
import { SitesRepository } from "./sites.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
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

  /**
   * The site scope for the application header.
   *
   * DELIBERATELY CARRIES NO `@Permissions`. Every signed-in user needs to pick a
   * site, including one with no `site.view` right — that right guards the Site
   * MASTER screen, where sites are created and edited, and requiring it here
   * would leave a site clerk unable to choose the site they work on. The
   * projection is two columns wide for the same reason.
   *
   * Declared above `@Get(":id")` to read in the obvious order. Fastify routes on
   * a radix tree and prefers the static segment over the parametric one whatever
   * the declaration order, which is how `users/options` and
   * `purchase-requests/approvals` already work — verified against
   * `printRoutes()`, where `assignable` and `:id` are siblings under `sites/`.
   */
  @Get("assignable")
  scope(@CurrentUser() caller: AccessTokenClaims | undefined): Promise<SiteScopeResponse> {
    return this.sites.scopeFor(caller?.sub);
  }

  @Get(":id")
  @Permissions("site.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<SiteDetail> {
    return this.sites.findById(id);
  }

  @Post()
  @Permissions("site.add")
  create(
    @Body(new ZodValidationPipe(createSiteSchema)) body: CreateSite,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SiteDetail> {
    return this.sites.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("site.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSiteSchema)) body: UpdateSite,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SiteDetail> {
    return this.sites.update(id, body, actorId(caller));
  }

  /** Soft delete. 409 naming the users or groups still attached. */
  @Delete(":id")
  @Permissions("site.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.sites.remove(id, actorId(caller));
  }
}
