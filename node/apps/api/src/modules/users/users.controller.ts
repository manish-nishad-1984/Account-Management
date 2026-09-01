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
  Put,
  Query,
} from "@nestjs/common";
import {
  createUserSchema,
  hasPermission,
  listQuerySchema,
  saveUserPermissionsSchema,
  updateUserSchema,
  type CreateUser,
  type ListResponse,
  type SaveUserPermissions,
  type UpdateUser,
  type UserDetail,
  type UserPermissions,
  type UserRow,
} from "@accountmanagement/contracts";
import { UsersRepository } from "./users.repository";
import { UserPermissionsRepository } from "./user-permissions.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

const SUBJECT = "user";

@Controller("users")
export class UsersController {
  constructor(
    private readonly users: UsersRepository,
    private readonly permissions: UserPermissionsRepository,
  ) {}

  @Get()
  @Permissions("user.view")
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ReturnType<typeof listQuerySchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<UserRow>> {
    const granted = caller?.permissions ?? [];

    // Capability flags are computed once per request, not per row, because these
    // rights are not row-dependent yet. When they become row-dependent (site
    // scoping), this is the single place that changes.
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };

    const [page, total] = await Promise.all([
      this.users.list(query),
      this.users.total(query.search),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  /**
   * The site and company lists the user form assigns from.
   *
   * Declared before `:id` deliberately. Nest matches routes in declaration
   * order, so a `@Get(":id")` above this one would swallow `/users/options` and
   * hand "options" to ParseUUIDPipe as an id.
   */
  @Get("options")
  @Permissions("user.view")
  options(): Promise<{
    sites: { id: string; name: string }[];
    companies: { id: string; name: string }[];
  }> {
    return this.users.assignmentOptions();
  }

  @Get(":id")
  @Permissions("user.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<UserDetail> {
    return this.users.findById(id);
  }

  @Post()
  @Permissions("user.add")
  create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUser,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<UserDetail> {
    return this.users.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("user.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUser,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<UserDetail> {
    return this.users.update(id, body, actorId(caller));
  }

  /** Soft delete, revoking refresh tokens. Refuses to delete the caller. */
  @Delete(":id")
  @Permissions("user.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.users.remove(id, actorId(caller));
  }

  /**
   * The permission matrix. Guarded by `user.view` to read and `user.edit` to
   * write — the same rights that govern the user record itself.
   *
   * There is no separate "manage permissions" right, because there is no form to
   * derive one from: `UserwisePermission` is an action on `UserController`, under
   * the `User List` form, not a form of its own. Inventing a subject here would
   * produce a permission string that no migrated `Form` row could ever grant.
   */
  @Get(":id/permissions")
  @Permissions("user.view")
  findPermissions(@Param("id", ParseUUIDPipe) id: string): Promise<UserPermissions> {
    return this.permissions.findForUser(id);
  }

  /** A full replacement of the matrix, applied in one transaction. */
  @Put(":id/permissions")
  @Permissions("user.edit")
  savePermissions(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(saveUserPermissionsSchema)) body: SaveUserPermissions,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<UserPermissions> {
    return this.permissions.replaceForUser(id, body.rows, actorId(caller));
  }
}
