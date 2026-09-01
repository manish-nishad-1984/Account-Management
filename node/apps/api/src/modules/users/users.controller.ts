import { Controller, Get, Query } from "@nestjs/common";
import {
  hasPermission,
  listQuerySchema,
  type ListResponse,
  type UserRow,
} from "@accountmanagement/contracts";
import { UsersRepository } from "./users.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { AccessTokenClaims } from "../auth/token.service";

const SUBJECT = "user";

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersRepository) {}

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
}
