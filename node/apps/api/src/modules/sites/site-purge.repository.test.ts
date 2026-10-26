import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createPurchaseInvoiceSchema } from "@accountmanagement/contracts";
import { SitesRepository } from "./sites.repository";
import { PurchaseInvoicesRepository } from "../purchase-invoices/purchase-invoices.repository";
import { PaymentsRepository } from "../payments/payments.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

/** A site deleted with everything in it, in one go (client, 26 Oct 2026). */
describe("SitesRepository.purge (real PostgreSQL)", () => {
  let db: Database;
  let repo: SitesRepository;
  let akwada: string;
  let surat: string;

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new SitesRepository(db);
    const [a, s] = await db.insert(schema.sites).values([{ name: "Akwada", isActive: true }, { name: "Surat", isActive: true }]).returning();
    akwada = a!.id;
    surat = s!.id;
    const [unit] = await db.insert(schema.units).values({ name: "Bag" }).returning();
    const [item] = await db.insert(schema.items).values({ name: "Cement", unitId: unit!.id, pricePerUnit: "100.00" }).returning();
    const [company] = await db.insert(schema.companies).values({ name: "DH PATEL", invoicePrefix: "DHP" }).returning();
    const [supplier] = await db.insert(schema.suppliers).values({ name: "SHAH ENTERPRISE" }).returning();
    const [user] = await db
      .insert(schema.users)
      .values({ firstName: "F", lastName: "L", email: "u@example.com", phoneNo: "0", userName: "u", password: "x" })
      .returning();
    await db.insert(schema.userSites).values([{ userId: user!.id, siteId: akwada }, { userId: user!.id, siteId: surat }]);
    await db.insert(schema.siteLocations).values([{ siteId: akwada, name: "Block A" }, { siteId: surat, name: "Block A" }]);

    const invoices = new PurchaseInvoicesRepository(db);
    const payments = new PaymentsRepository(db);
    for (const siteId of [akwada, surat]) {
      await invoices.create(
        createPurchaseInvoiceSchema.parse({
          supplierInvoiceNo: `B-${siteId.slice(0, 4)}`,
          supplierId: supplier!.id,
          companyId: company!.id,
          siteId,
          documentDate: "2026-09-10T00:00:00.000Z",
          items: [{ itemId: item!.id, unitId: unit!.id, quantity: "10", unitPrice: "100", gstPercent: "18" }],
        }),
        ACTOR,
      );
      await payments.createMany(
        [{ direction: "out", kind: "payment", partyId: supplier!.id, companyId: company!.id, siteId, siteLocationId: null, paymentDate: "2026-10-01T00:00:00.000Z", amount: "500.00", description: null, method: null, referenceNo: null }],
        ACTOR,
      );
    }
  });

  it("shows what the site holds, then takes the site and all of it, and leaves the other site alone", async () => {
    const before = await repo.contents(akwada);
    expect(before).toMatchObject({ siteName: "Akwada", purchaseInvoices: 1, payments: 1, locations: 1, users: 1, billedTotal: "1180.00", paidTotal: "500.00" });

    await repo.purge(akwada, ACTOR);

    const [site] = await db.select().from(schema.sites).where(eq(schema.sites.id, akwada));
    expect(site!.isDeleted).toBe(true);
    expect((await db.select().from(schema.purchaseInvoices)).map((row) => row.siteId)).toEqual([surat]);
    const livePayments = (await db.select().from(schema.payments)).filter((row) => !row.isDeleted);
    expect(livePayments.map((row) => row.siteId)).toEqual([surat]);
    expect((await db.select().from(schema.userSites)).map((row) => row.siteId)).toEqual([surat]);
    expect((await db.select().from(schema.siteLocations)).filter((row) => !row.isDeleted).map((row) => row.siteId)).toEqual([surat]);

    const [audit] = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.entity, "site"));
    expect(audit).toMatchObject({ entityId: akwada, action: "deleted", label: "Akwada" });
    expect(audit!.facts).toContainEqual(["Purchase invoices", "1 (1180.00)"]);

    await expect(repo.contents(akwada)).rejects.toThrow("Site not found");
    expect(await repo.contents(surat)).toMatchObject({ purchaseInvoices: 1, payments: 1 });
  });
});
