import { beforeEach, describe, expect, it } from "vitest";
import { createClientIncomeSchema, createClientSchema, createPurchaseInvoiceSchema } from "@accountmanagement/contracts";
import { BalanceSheetService } from "./balance-sheet.service";
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
 * The site-wise Balance Sheet: income from the Income entries, billed and paid
 * from the ledger's own union.
 */
describe("BalanceSheetService (real PostgreSQL)", () => {
  let db: Database;
  let service: BalanceSheetService;
  let incomes: ClientIncomesRepository;
  let invoices: PurchaseInvoicesRepository;
  let payments: PaymentsRepository;

  let akwada: string;
  let surat: string;
  let patel: string;
  let maharaj: string;
  let supplierId: string;
  let clientId: string;
  let itemId: string;
  let unitId: number;

  const income = (siteId: string, companyId: string, amount: string, extra: Record<string, unknown> = {}) =>
    incomes.create(
      createClientIncomeSchema.parse({ incomeDate: "2026-10-05", siteId, companyId, clientId, amount, ...extra }),
      ACTOR,
    );

  const invoice = (siteId: string, companyId: string, no: string, amount: string, extra: Record<string, unknown> = {}) =>
    invoices.create(
      createPurchaseInvoiceSchema.parse({
        supplierInvoiceNo: no,
        supplierId,
        companyId,
        siteId,
        documentDate: "2026-09-10T00:00:00.000Z",
        items: [{ itemId, unitId, quantity: "1", unitPrice: amount }],
        ...extra,
      }),
      ACTOR,
    );

  const pay = (siteId: string, companyId: string, amount: string, extra: Record<string, unknown> = {}) =>
    payments.createMany(
      [
        {
          direction: "out" as const,
          kind: "payment" as const,
          partyId: supplierId,
          companyId,
          siteId,
          siteLocationId: null,
          paymentDate: "2026-09-20T00:00:00.000Z",
          amount,
          description: null,
          method: null,
          referenceNo: null,
          ...extra,
        },
      ],
      ACTOR,
    );

  beforeEach(async () => {
    db = await freshDatabase();
    incomes = new ClientIncomesRepository(db);
    invoices = new PurchaseInvoicesRepository(db);
    payments = new PaymentsRepository(db);
    service = new BalanceSheetService(incomes, new ReportsRepository(db));

    const [unit] = await db.insert(schema.units).values({ name: "Bag" }).returning({ id: schema.units.id });
    unitId = unit!.id;
    const [item] = await db
      .insert(schema.items)
      .values({ name: "Cement", unitId, pricePerUnit: "395.00" })
      .returning({ id: schema.items.id });
    itemId = item!.id;

    const sites = await db
      .insert(schema.sites)
      .values([
        { name: "Akwada Lake Front", isActive: true },
        { name: "Surat Diamond Park", isActive: true },
      ])
      .returning({ id: schema.sites.id, name: schema.sites.name });
    akwada = sites.find((s) => s.name.startsWith("Akwada"))!.id;
    surat = sites.find((s) => s.name.startsWith("Surat"))!.id;

    const companies = await db
      .insert(schema.companies)
      .values([{ name: "DH Patel" }, { name: "DH Maharaj" }])
      .returning({ id: schema.companies.id, name: schema.companies.name });
    patel = companies.find((c) => c.name === "DH Patel")!.id;
    maharaj = companies.find((c) => c.name === "DH Maharaj")!.id;

    const [supplier] = await db
      .insert(schema.suppliers)
      .values({ name: "AL BURHAN PIPES" })
      .returning({ id: schema.suppliers.id });
    supplierId = supplier!.id;

    clientId = (await new ClientsRepository(db).create(createClientSchema.parse({ name: "Shah Developers" }), ACTOR)).id;
  });

  it("gives each project its income, billed, paid and the two balances", async () => {
    await income(akwada, patel, "1000000.00", { deductions: [{ amount: "100000.00", remark: "TDS" }] });
    await invoice(akwada, patel, "A-1", "400000.00");
    await invoice(akwada, patel, "A-2", "100000.00");
    await pay(akwada, patel, "300000.00");

    const sheet = await service.sheet({});
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]).toMatchObject({
      siteName: "Akwada Lake Front",
      income: "900000.00",
      billed: "500000.00",
      paid: "300000.00",
      stillToPay: "200000.00",
      cashBalance: "600000.00",
      projectResult: "400000.00",
    });
  });

  it("keeps projects apart and totals them", async () => {
    await income(akwada, patel, "1000.00");
    await income(surat, maharaj, "2000.00");
    await invoice(surat, maharaj, "S-1", "500.00");

    const sheet = await service.sheet({});
    expect(sheet.rows.map((row) => [row.siteName, row.income, row.billed])).toEqual([
      ["Akwada Lake Front", "1000.00", "0.00"],
      ["Surat Diamond Park", "2000.00", "500.00"],
    ]);
    expect(sheet.totals).toMatchObject({ income: "3000.00", billed: "500.00", projectResult: "2500.00" });
  });

  it("takes a purchase return off what was billed, and leaves opening balances out", async () => {
    await invoice(akwada, patel, "A-1", "1000.00");
    await invoice(akwada, patel, "R-1", "200.00", { invoiceType: "Purchase Return" });
    await pay(akwada, patel, "5000.00", { kind: "opening_balance", siteId: null });

    const row = (await service.sheet({})).rows.find((one) => one.siteId === akwada)!;
    expect(row.billed).toBe("800.00");
    expect(row.paid).toBe("0.00");
    expect((await service.sheet({})).rows.some((one) => one.siteId === null)).toBe(false);
  });

  it("filters by company, so one company's books can be read alone", async () => {
    await income(akwada, patel, "1000.00");
    await income(akwada, maharaj, "300.00");

    expect((await service.sheet({ companyId: maharaj })).rows[0]).toMatchObject({ income: "300.00" });
  });

  it("filters income by the date it was received", async () => {
    await income(akwada, patel, "1000.00", { incomeDate: "2026-04-10" });
    await income(akwada, patel, "250.00", { incomeDate: "2026-10-01" });

    const sheet = await service.sheet({ fromDate: "2026-10-01", toDate: "2026-10-31" });
    expect(sheet.rows[0]!.income).toBe("250.00");
  });

  it("ignores deleted income", async () => {
    const kept = await income(akwada, patel, "1000.00");
    const gone = await income(akwada, patel, "9999.00");
    await incomes.remove(gone.id, ACTOR);

    const sheet = await service.sheet({});
    expect(sheet.rows[0]!.income).toBe("1000.00");
    expect(kept.id).toBeDefined();
  });

  it("shows what is behind a project: its income entries and its suppliers", async () => {
    await income(akwada, patel, "1000.00");
    await invoice(akwada, patel, "A-1", "400.00");
    await pay(akwada, patel, "150.00");

    const detail = await service.detail(akwada, {});
    expect(detail.incomes.map((one) => [one.clientName, one.companyName, one.total])).toEqual([
      ["Shah Developers", "DH Patel", "1000.00"],
    ]);
    expect(detail.suppliers).toEqual([
      { partyId: supplierId, partyName: "AL BURHAN PIPES", billed: "400.00", paid: "150.00", stillToPay: "250.00" },
    ]);
  });
});
