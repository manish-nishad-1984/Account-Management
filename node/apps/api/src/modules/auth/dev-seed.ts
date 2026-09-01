import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InMemoryUserRepository, UserRepository } from "./user.repository";
import { ENV, type Env } from "../../config/env";
import { DATABASE, type Database } from "../../db/database";
import { companies, forms, sites, userFormPermissions, users, userSites } from "../../db/schema";

const DEV_PASSWORD = "DevPassword1";

/**
 * Seeds data so the app can be exercised locally.
 *
 * Development only. Passwords are seeded as LEGACY PLAINTEXT on purpose, so that
 * signing in exercises the real C-1 migration path rather than a shortcut.
 */
@Injectable()
export class DevSeed implements OnModuleInit {
  private readonly logger = new Logger(DevSeed.name);

  constructor(
    private readonly repository: UserRepository,
    @Inject(ENV) private readonly env: Env,
    @Inject(DATABASE) private readonly db: Database | null,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.env.NODE_ENV !== "development") {
      return;
    }

    if (this.db) {
      await this.seedDatabase(this.db);
      return;
    }

    if (this.repository instanceof InMemoryUserRepository) {
      this.repository.seed({
        id: "00000000-0000-0000-0000-000000000001",
        userName: "devuser",
        isActive: true,
        password: DEV_PASSWORD,
        permissions: ["invoice.view", "invoice.approve", "user.view", "user.edit"],
        siteIds: [],
        companyIds: [],
      });
      this.logger.warn("Seeded in-memory dev user 'devuser'");
    }
  }

  private async seedDatabase(db: Database): Promise<void> {
    const existing = await db.select({ id: users.id }).from(users).limit(1);
    if (existing.length > 0) {
      return;
    }

    const [company] = await db
      .insert(companies)
      .values({ name: "D H Infra" })
      .returning();

    const insertedSites = await db
      .insert(sites)
      .values([
        { name: "Ahmedabad Site", companyId: company!.id },
        { name: "Rajkot Site", companyId: company!.id },
        { name: "Surat Site", companyId: company!.id },
      ])
      .returning();

    await db.insert(forms).values([
      { id: 1, formName: "User", controller: "User", formGroup: "Masters", isActive: true },
      { id: 2, formName: "Supplier Invoice", controller: "Invoice", formGroup: "Invoicing", isActive: true },
      { id: 3, formName: "Purchase Order", controller: "PurchaseOrder", formGroup: "Purchase", isActive: true },
    ]);

    // One administrator plus 40 others, so the grid has several pages to walk.
    const seeded = await db
      .insert(users)
      .values([
        {
          firstName: "Dev",
          lastName: "User",
          email: "devuser@example.com",
          phoneNo: "9000000000",
          userName: "devuser",
          password: DEV_PASSWORD,
          passwordIsLegacy: true,
        },
        ...Array.from({ length: 40 }, (_, i) => ({
          firstName: FIRST_NAMES[i % FIRST_NAMES.length]!,
          lastName: LAST_NAMES[i % LAST_NAMES.length]!,
          email: `user${String(i + 1).padStart(2, "0")}@example.com`,
          phoneNo: `98${String(10000000 + i)}`,
          userName: `user${String(i + 1).padStart(2, "0")}`,
          password: DEV_PASSWORD,
          // Two thirds still on plaintext, so the "Legacy password" badge is visible.
          passwordIsLegacy: i % 3 !== 0,
          isActive: i % 7 !== 0,
        })),
      ])
      .returning({ id: users.id, userName: users.userName });

    const admin = seeded.find((u) => u.userName === "devuser")!;
    await db.insert(userFormPermissions).values([
      { userId: admin.id, formId: 1, isViewAllow: true, isAddAllow: true, isEditAllow: true, isDeleteAllow: true },
      { userId: admin.id, formId: 2, isViewAllow: true, isEditAllow: true, isApproved: true },
      { userId: admin.id, formId: 3, isViewAllow: true },
    ]);

    await db.insert(userSites).values(
      seeded.flatMap((user, index) =>
        insertedSites
          .slice(0, (index % 3) + 1)
          .map((site) => ({ userId: user.id, siteId: site.id })),
      ),
    );

    this.logger.warn(
      `Seeded ${seeded.length} users. Sign in as 'devuser' / '${DEV_PASSWORD}'.`,
    );
  }
}

const FIRST_NAMES = ["Amit", "Priya", "Rahul", "Neha", "Vikram", "Anjali", "Suresh", "Meera"];
const LAST_NAMES = ["Patel", "Shah", "Desai", "Mehta", "Joshi", "Trivedi", "Parmar", "Shah"];
