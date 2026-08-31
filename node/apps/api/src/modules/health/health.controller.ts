import { Controller, Get } from "@nestjs/common";
import { financialYear } from "@accountmanagement/domain";
import { Public } from "../../common/auth/public.decorator";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  check() {
    const now = new Date();
    return {
      status: "ok",
      timestamp: now.toISOString(),
      // Proves the shared domain package is wired end to end through the API.
      financialYear: financialYear.format(financialYear.currentAsProduced(now)),
    };
  }
}
