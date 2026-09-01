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
