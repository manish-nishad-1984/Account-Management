import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InMemoryUserRepository, UserRepository } from "./user.repository";
import { ENV, type Env } from "../../config/env";

/**
 * Seeds one user so the API can be exercised before the database adapter exists.
 * Development only — it refuses to run under any other NODE_ENV, and it seeds a
 * LEGACY PLAINTEXT password on purpose so the C-1 migration path is exercised by
 * an ordinary login rather than only by unit tests.
 */
@Injectable()
export class DevSeed implements OnModuleInit {
  private readonly logger = new Logger(DevSeed.name);

  constructor(
    private readonly users: UserRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.env.NODE_ENV !== "development") {
      return;
    }
    if (!(this.users instanceof InMemoryUserRepository)) {
      return;
    }

    this.users.seed({
      id: "00000000-0000-0000-0000-000000000001",
      userName: "devuser",
      isActive: true,
      password: "DevPassword1",
      permissions: ["invoice.view", "invoice.approve"],
      siteIds: ["site-a"],
      companyIds: ["company-a"],
    });
    this.logger.warn("Seeded in-memory dev user 'devuser' — development only");
  }
}
