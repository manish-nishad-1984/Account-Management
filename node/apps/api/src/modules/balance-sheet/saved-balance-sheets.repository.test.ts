import { beforeEach, describe, expect, it } from "vitest";
import {
  createBalanceSheetSchema,
  createClientIncomeSchema,
  createClientSchema,
  createPurchaseInvoiceSchema,
  listQuerySchema,
} from "@accountmanagement/contracts";
import { NotFoundException } from "@nestjs/common";
import { BalanceSheetService } from "./balance-sheet.service";
import { SavedBalanceSheetsRepository } from "./saved-balance-sheets.repository";
import { ClientIncomesRepository } from "../client-incomes/client-incomes.repository";
import { ClientsRepository } from "../clients/clients.repository";
import { PaymentsRepository } from "../payments/payments.repository";
import { PurchaseInvoicesRepository } from "../purchase-invoices/purchase-invoices.repository";
import { ReportsRepository } from "../reports/reports.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

/**
 * Saved Balance Sheets: the report worked out for a company, a range of income
 * dates and a range of invoice dates, and kept as it was worked out.
 */
describe("SavedBalanceSheetsRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: SavedBalanceSheetsRepository;
  let incomes: ClientIncomesRepository;
  let invoices: PurchaseInvoicesRepository;
  let payments: PaymentsRepository;

  let akwada: string;
  let patel: string;
  let maharaj: string;
  let supplierId: string;
  let clientId: string;
  let itemId: string;
  let unitId: number;

  const sheet = (overrides: Record<string, unknown> = {}) => createBalanceSheetSchema.parse(overrides);

  const income = (companyId: string, amount: string, incomeDate = "2026-10-05") =>
    incomes.create(createClientIncomeSchema.parse({ incomeDate, siteId: akwada, companyId, clientId, amount }), ACTOR);

  const invoice = (companyId: string, no: string, amount: string, documentDate = "2026-09-10T00:00:00.000Z") =>
    invoices.create(
      createPurchaseInvoiceSchema.parse({
        supplierInvoiceNo: no,
        supplierId,
        companyId,
        siteId: akwada,
        documentDate,
        items: [{ itemId, unitId, quantity: "1", unitPrice: amount }],
      }),
      ACTOR,
    );

  const pay = (companyId: string, amount: string, paymentDate = "2026-09-20T00:00:00.000Z") =>
    payments.createMany(
      [
        {
          direction: "out" as const,
          kind: "payment" as const,
          partyId: supplierId,
          companyId,
          siteId: akwada,
          siteLocationId: null,
          paymentDate,
          amount,
          description: null,
          method: null,
          referenceNo: null,
        },
      ],
      ACTOR,
    );

  beforeEach(async () => {
    db = await freshDatabase();
    incomes = new ClientIncomesRepository(db);
    invoices = new PurchaseInvoicesRepository(db);
    payments = new PaymentsRepository(db);
    repo = new SavedBalanceSheetsRepository(db, new BalanceSheetService(incomes, new ReportsRepository(db)));

    const [unit] = await db.insert(schema.units).values({ name: "Bag" }).returning({ id: schema.units.id });
    unitId = unit!.id;
    const [item] = await db.insert(schema.items).values({ name: "Cement", unitId, pricePerUnit: "395.00" }).returning({ id: schema.items.id });
    itemId = item!.id;
    const [site] = await db.insert(schema.sites).values({ name: "Akwada Lake Front", isActive: true }).returning({ id: schema.sites.id });
    akwada = site!.id;
    const companies = await db
      .insert(schema.companies)
      .values([{ name: "DH Patel" }, { name: "DH Maharaj" }])
      .returning({ id: schema.companies.id, name: schema.companies.name });
    patel = companies.find((c) => c.name === "DH Patel")!.id;
    maharaj = companies.find((c) => c.name === "DH Maharaj")!.id;
    const [supplier] = await db.insert(schema.suppliers).values({ name: "AL BURHAN PIPES" }).returning({ id: schema.suppliers.id });
    supplierId = supplier!.id;
    clientId = (await new ClientsRepository(db).create(createClientSchema.parse({ name: "Shah Developers" }), ACTOR)).id;
  });

  it("counts income by the income dates and bills and payments by the invoice dates", async () => {
    await income(patel, "1000000.00", "2026-10-05");
    await income(patel, "500000.00", "2026-08-05"); // outside the income range
    await invoice(patel, "A-1", "400000.00", "2026-09-10T00:00:00.000Z");
    await invoice(patel, "A-2", "100000.00", "2026-07-10T00:00:00.000Z"); // outside the invoice range
    await pay(patel, "300000.00", "2026-09-20T00:00:00.000Z");
    await pay(patel, "50000.00", "2026-07-20T00:00:00.000Z"); // outside too

    const worked = await repo.preview(
      sheet({ companyId: patel, incomeFrom: "2026-10-01", incomeTo: "2026-10-31", invoiceFrom: "2026-09-01", invoiceTo: "2026-09-30" }),
    );

    expect(worked.rows).toHaveLength(1);
    expect(worked.rows[0]).toMatchObject({ siteName: "Akwada Lake Front", income: "1000000.00", billed: "400000.00", paid: "300000.00", stillToPay: "100000.00", cashBalance: "700000.00", projectResult: "600000.00" });
    expect(worked.totals).toMatchObject({ income: "1000000.00", billed: "400000.00", paid: "300000.00" });
  });

  it("limits the sheet to the chosen company", async () => {
    await income(patel, "1000.00");
    await income(maharaj, "7000.00");
    const one = await repo.preview(sheet({ companyId: maharaj }));
    expect(one.totals.income).toBe("7000.00");
    const all = await repo.preview(sheet());
    expect(all.totals.income).toBe("8000.00");
  });

  it("keeps the sheet as it was worked out, and works it out again on an edit", async () => {
    await income(patel, "1000000.00");
    await invoice(patel, "A-1", "400000.00");
    const saved = await repo.create(sheet({ title: "Sept", companyId: patel }), ACTOR);
    expect(saved).toMatchObject({ title: "Sept", companyName: "DH Patel", projectCount: 1 });
    expect(saved.figures).toMatchObject({ income: "1000000.00", billed: "400000.00" });

    await invoice(patel, "A-2", "100000.00"); // entered AFTER the sheet was saved
    expect((await repo.findById(saved.id)).figures.billed).toBe("400000.00");

    const again = await repo.update(saved.id, sheet({ title: "Sept", companyId: patel }), ACTOR);
    expect(again.figures.billed).toBe("500000.00");
    expect(again.rows).toHaveLength(1); // rows replaced, not added to
  });

  it("lists newest first, filters by company, and a removed sheet is gone", async () => {
    await income(patel, "1000.00");
    const first = await repo.create(sheet({ title: "one", companyId: patel }), ACTOR);
    await repo.create(sheet({ title: "two", companyId: maharaj }), ACTOR);

    const all = await repo.list(listQuerySchema.parse({}));
    expect(all.rows.map((r) => r.title)).toEqual(["two", "one"]);
    expect((await repo.list(listQuerySchema.parse({}), patel)).rows.map((r) => r.title)).toEqual(["one"]);
    expect(await repo.total(undefined, patel)).toBe(1);

    await repo.remove(first.id, ACTOR);
    expect((await repo.list(listQuerySchema.parse({}))).rows.map((r) => r.title)).toEqual(["two"]);
    await expect(repo.findById(first.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuses a to-date before its from-date", () => {
    expect(createBalanceSheetSchema.safeParse({ incomeFrom: "2026-10-10", incomeTo: "2026-10-01" }).success).toBe(false);
    expect(createBalanceSheetSchema.safeParse({ invoiceFrom: "2026-10-10", invoiceTo: "2026-10-01" }).success).toBe(false);
    expect(createBalanceSheetSchema.safeParse({ incomeFrom: "2026-10-01" }).success).toBe(true);
  });
});
