import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import {
  balanceSheetQuerySchema,
  type BalanceSheetDetail,
  type BalanceSheetResponse,
} from "@accountmanagement/contracts";
import { BalanceSheetService } from "./balance-sheet.service";
import { Permissions } from "../../common/auth/permissions.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";

const detailQuerySchema = balanceSheetQuerySchema.omit({ siteId: true });

/**
 * The site-wise Balance Sheet. It adds up income and expense, so it asks for BOTH
 * rights - `PermissionsGuard` requires every permission a route lists - and a
 * person who can see only one of the two does not see the combination.
 */
@Controller("balance-sheet")
export class BalanceSheetController {
  constructor(private readonly sheet: BalanceSheetService) {}

  @Get()
  @Permissions("reports-payments.view", "income.view")
  sheetOf(
    @Query(new ZodValidationPipe(balanceSheetQuerySchema)) query: ReturnType<typeof balanceSheetQuerySchema.parse>,
  ): Promise<BalanceSheetResponse> {
    return this.sheet.sheet(query);
  }

  /** A static segment first would shadow `:siteId`; this one is distinct by its prefix. */
  @Get("site/:siteId")
  @Permissions("reports-payments.view", "income.view")
  detail(
    @Param("siteId", ParseUUIDPipe) siteId: string,
    @Query(new ZodValidationPipe(detailQuerySchema)) query: ReturnType<typeof detailQuerySchema.parse>,
  ): Promise<BalanceSheetDetail> {
    return this.sheet.detail(siteId, query);
  }
}
