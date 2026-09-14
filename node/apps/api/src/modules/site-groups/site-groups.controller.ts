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
  createSiteGroupSchema,
  hasPermission,
  listQuerySchema,
  updateSiteGroupSchema,
  type CreateSiteGroup,
  type ListResponse,
  type SiteGroupDetail,
  type SiteGroupRow,
  type UpdateSiteGroup,
} from "@accountmanagement/contracts";
import { SiteGroupsRepository } from "./site-groups.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * Subject `group`, matching `[FormPermissionAttribute("Group-View")]`.
 *
 * THE WRITE ROUTES LANDED 14 Sep 2026, ASKED FOR BY THE BUSINESS. Until then
 * this controller was read-only and said why: there is no `Group-Add`,
 * `Group-Edit` or `Group-Delete` attribute anywhere in the .NET solution, only
 * `Group-View`, so changing a group was unauthorised there — assessment finding
 * C-6. The screen carried a notice to that effect.
 *
 * What settled it is that the RIGHTS ALREADY EXIST IN THE DATA. Permissions are
 * rows in `user_form_permissions`, one per user per form, with separate view,
 * add, edit and delete flags — and against the live database the Group form
 * (id 25, active) already grants all four to `ckalathiya` and `chintanauro`.
 * The .NET app simply never read three of those columns for this form.
 *
 * So nothing here is a new right. Each route below asks for the flag that was
 * always there, and a user without it gets the same 403 as on every other
 * master.
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

  @Get(":id")
  @Permissions("group.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<SiteGroupDetail> {
    return this.groups.findById(id);
  }

  @Post()
  @Permissions("group.add")
  create(
    @Body(new ZodValidationPipe(createSiteGroupSchema)) body: CreateSiteGroup,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SiteGroupDetail> {
    return this.groups.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("group.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSiteGroupSchema)) body: UpdateSiteGroup,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SiteGroupDetail> {
    return this.groups.update(id, body, actorId(caller));
  }

  /** Soft delete. 409 naming the documents that still use the group. */
  @Delete(":id")
  @Permissions("group.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.groups.remove(id, actorId(caller));
  }
}
