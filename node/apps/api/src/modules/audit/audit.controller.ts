import { Controller, ForbiddenException, Get, Query } from "@nestjs/common";
import {
  auditQuerySchema,
  hasPermission,
  type AuditEntity,
  type AuditListResponse,
  type AuditQuery,
} from "@accountmanagement/contracts";
import { AuditRepository } from "./audit.repository";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * Whoever may see a record may see its history - the right that opens the screen
 * the record lives on. Checked here rather than with @Permissions(), because the
 * right depends on which record is asked for.
 */
const VIEW_RIGHT: Record<AuditEntity, string> = {
  "purchase-invoice": "purchase-invoice",
  payment: "reports-payments",
  "payout-list": "payout",
  site: "site",
};

@Controller("audit")
export class AuditController {
  constructor(private readonly audit: AuditRepository) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<AuditListResponse> {
    if (!hasPermission(caller?.permissions ?? [], VIEW_RIGHT[query.entity], "view")) {
      throw new ForbiddenException("You do not have the right to see this history");
    }
    return { rows: await this.audit.list(query) };
  }
}
