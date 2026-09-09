import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { AuthGuard } from "./common/auth/auth.guard";
import { PermissionsGuard } from "./common/auth/permissions.guard";
import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./db/database.module";
import { StorageModule } from "./common/storage/storage.module";
import { loadEnv } from "./config/env";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { UsersModule } from "./modules/users/users.module";
import { CompaniesModule } from "./modules/companies/companies.module";
import { SitesModule } from "./modules/sites/sites.module";
import { SiteGroupsModule } from "./modules/site-groups/site-groups.module";
import { SuppliersModule } from "./modules/suppliers/suppliers.module";
import { ItemsModule } from "./modules/items/items.module";
import { PurchaseRequestsModule } from "./modules/purchase-requests/purchase-requests.module";
import { PurchaseOrdersModule } from "./modules/purchase-orders/purchase-orders.module";
import { PurchaseInvoicesModule } from "./modules/purchase-invoices/purchase-invoices.module";
import { SalesInvoicesModule } from "./modules/sales-invoices/sales-invoices.module";
import { InventoryInwardModule } from "./modules/inventory-inward/inventory-inward.module";
import { InwardChallansModule } from "./modules/inward-challans/inward-challans.module";

const env = loadEnv();

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    // Global, like ConfigModule: a feature module injects DOCUMENT_STORAGE
    // without importing anything.
    StorageModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        transport:
          env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
        redact: ["req.headers.authorization", "req.headers.cookie", "req.body.password"],
      },
    }),
    AuthModule,
    HealthModule,
    UsersModule,
    CompaniesModule,
    SitesModule,
    SiteGroupsModule,
    SuppliersModule,
    ItemsModule,
    PurchaseRequestsModule,
    PurchaseOrdersModule,
    PurchaseInvoicesModule,
    SalesInvoicesModule,
    InventoryInwardModule,
    InwardChallansModule,
  ],
  providers: [
    // Order matters: authenticate, then authorise.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
