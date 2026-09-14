import { beforeEach, describe, expect, it } from "vitest";
import { createPurchaseInvoiceSchema, type ReportFilter } from "@accountmanagement/contracts";
import { ReportsRepository } from "./reports.repository";
import { PaymentsRepository } from "../payments/payments.repository";
import { PurchaseInvoicesRepository } from "../purchase-invoices/purchase-invoices.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";
const PAGE = { limit: 50, offset: 0 };

const filter = (overrides: Partial<ReportFilter> = {}): ReportFilter => ({
  direction: "out",
  ...overrides,
});

/**
 * THE PENDING LEDGER: only the invoices still to be paid.
 *
 * The rule under test is that payments settle the oldest invoices first. What
 * is still owed for a site and party is matched against its newest invoices.
 * The one where it runs out is partly paid, and anything older is not listed.
 */
describe("ReportsRepository.pendingLedger (real PostgreSQL)", () => {
  let db: Database;
  let reports: ReportsRepository;
  let payments: PaymentsRepository;
  let invoices: PurchaseInvoicesRepository;

  let siteId: string;
  let otherSiteId: string;
  let supplierId: string;
  let otherSupplierId: string;
  let companyId: string;
  let itemId: string;
  let unitId: number;

  const invoice = async (no: string, amount: string, date: string, overrides: Record<string, unknown> = {}) =>
    invoices.create(
      createPurchaseInvoiceSchema.parse({
        supplierInvoiceNo: no,
        supplierId,
        companyId,
        siteId,
        documentDate: `${date}T00:00:00.000Z`,
        items: [{ itemId, unitId, quantity: "1", unitPrice: amount }],
        ...overrides,
      }),
      ACTOR,
    );

  const pay = async (amount: string, date: string, overrides: Record<string, unknown> = {}) =>
    payments.createMany(
      [
        {
          direction: "out" as const,
          kind: "payment" as const,
          partyId: supplierId,
          companyId,
          siteId,
          siteGroupId: null,
          paymentDate: `${date}T00:00:00.000Z`,
          amount,
          description: null,
          method: null,
          referenceNo: null,
          ...overrides,
        },
      ],
      ACTOR,
    );

  const listed = async (overrides: Partial<ReportFilter> = {}) =>
    (await reports.pendingLedger(filter(overrides), PAGE)).rows.map((row) => [
      row.displayNo,
      row.amount,
      row.pending,
      row.balance,
    ]);

  beforeEach(async () => {
    db = await freshDatabase();
    reports = new ReportsRepository(db);
    payments = new PaymentsRepository(db);
    invoices = new PurchaseInvoicesRepository(db);

    const [unit] = await db.insert(schema.units).values({ name: "Bag" }).returning({ id: schema.units.id });
    unitId = unit!.id;

    const [item] = await db
      .insert(schema.items)
      .values({ name: "Cement", unitId, pricePerUnit: "395.00" })
      .returning({ id: schema.items.id });
    itemId = item!.id;

    const madeSites = await db
      .insert(schema.sites)
      .values([
        { name: "Akwada Lake Front", isActive: true },
        { name: "Surat Diamond Park", isActive: true },
      ])
      .returning({ id: schema.sites.id, name: schema.sites.name });
    siteId = madeSites.find((s) => s.name.startsWith("Akwada"))!.id;
    otherSiteId = madeSites.find((s) => s.name.startsWith("Surat"))!.id;

    const madeSuppliers = await db
      .insert(schema.suppliers)
      .values([{ name: "AL BURHAN PIPES" }, { name: "SHAH ENTERPRISE" }])
      .returning({ id: schema.suppliers.id, name: schema.suppliers.name });
    supplierId = madeSuppliers.find((s) => s.name.startsWith("AL"))!.id;
    otherSupplierId = madeSuppliers.find((s) => s.name.startsWith("SHAH"))!.id;

    const [company] = await db
      .insert(schema.companies)
      .values({ name: "DH PATEL", invoicePrefix: "DHP" })
      .returning({ id: schema.companies.id });
    companyId = company!.id;
  });

  it("lists every invoice while nothing has been paid", async () => {
    await invoice("A", "1000.00", "2026-01-01");
    await invoice("B", "500.00", "2026-02-01");

    expect(await listed()).toEqual([
      ["A", "1000.00", "1000.00", "1000.00"],
      ["B", "500.00", "500.00", "1500.00"],
    ]);
  });

  /**
   * THE ONE THAT MATTERS. 2,200 invoiced and 1,200 paid leaves 1,000 owed. The
   * newest invoice, C, is unpaid in full. B is where the 1,000 runs out, so 300
   * of its 500 is still pending. A was the first to be paid off, so it is gone.
   */
  it("settles the oldest invoices first and shows a part-paid one with what is left", async () => {
    await invoice("A", "1000.00", "2026-01-01");
    await invoice("B", "500.00", "2026-02-01");
    await invoice("C", "700.00", "2026-03-01");
    await pay("1200.00", "2026-03-10");

    expect(await listed()).toEqual([
      ["B", "500.00", "300.00", "300.00"],
      ["C", "700.00", "700.00", "1000.00"],
    ]);
  });

  it("hides every entry once the balance is zero", async () => {
    await invoice("A", "1000.00", "2026-01-01");
    await invoice("B", "500.00", "2026-02-01");
    await pay("1500.00", "2026-03-01");

    const result = await reports.pendingLedger(filter(), PAGE);
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPending).toBe("0.00");
  });

  it("lists nothing for a supplier that has been overpaid", async () => {
    await invoice("A", "1000.00", "2026-01-01");
    await pay("1400.00", "2026-02-01");

    expect(await listed()).toEqual([]);
  });

  it("drops an invoice paid off exactly, and keeps the next one whole", async () => {
    await invoice("A", "1000.00", "2026-01-01");
    await invoice("B", "500.00", "2026-02-01");
    await pay("1000.00", "2026-02-10");

    expect(await listed()).toEqual([["B", "500.00", "500.00", "500.00"]]);
  });

  it("treats a purchase return like a payment, and never lists the return itself", async () => {
    await invoice("A", "1000.00", "2026-01-01");
    await invoice("B", "500.00", "2026-02-01");
    await invoice("RET", "800.00", "2026-02-05", { invoiceType: "Purchase Return" });

    expect(await listed()).toEqual([
      ["A", "1000.00", "200.00", "200.00"],
      ["B", "500.00", "500.00", "700.00"],
    ]);
  });

  it("does not let a payment at one site settle an invoice at another", async () => {
    await invoice("AKW", "1000.00", "2026-01-01");
    await invoice("SUR", "1000.00", "2026-01-01", { siteId: otherSiteId });
    await pay("1000.00", "2026-02-01");

    expect(await listed()).toEqual([["SUR", "1000.00", "1000.00", "1000.00"]]);
  });

  it("lists an unpaid opening balance, labelled as one", async () => {
    await pay("300.00", "2025-04-01", { kind: "opening_balance", description: "Brought forward" });

    const [row] = (await reports.pendingLedger(filter(), PAGE)).rows;
    expect([row!.source, row!.label, row!.pending]).toEqual(["opening_balance", "Opening balance", "300.00"]);
  });

  it("counts an opening balance as money owed, and pays it off first", async () => {
    await pay("300.00", "2025-04-01", { kind: "opening_balance", description: "Brought forward" });
    await invoice("A", "1000.00", "2026-01-01");
    await pay("500.00", "2026-02-01");

    const result = await reports.pendingLedger(filter(), PAGE);
    expect(result.rows.map((row) => [row.source, row.pending])).toEqual([["invoice", "800.00"]]);

    await pay("200.00", "2025-04-02", { kind: "opening_balance", description: "More brought forward" });
    await invoice("B", "100.00", "2026-03-01");
    // Owed: 300 + 200 + 1000 + 100 − 500 = 1100. B 100, A 1000 — the opening
    // balances are older and were paid first.
    expect(await listed()).toEqual([
      ["A", "1000.00", "1000.00", "1000.00"],
      ["B", "100.00", "100.00", "1100.00"],
    ]);
  });

  /**
   * THE INVARIANT THE SCREEN RELIES ON: for the same filters, the pending
   * invoices under each site and supplier add up to that row's Net in the
   * summary. Checked on a deliberately untidy mix.
   */
  it("adds up, per site and supplier, to the Net in the balance summary", async () => {
    await invoice("A", "1000.00", "2026-01-01");
    await invoice("B", "2500.50", "2026-02-01");
    await invoice("R", "300.25", "2026-02-02", { invoiceType: "Credit Note" });
    await pay("1700.00", "2026-02-10");
    await invoice("S1", "900.00", "2026-01-05", { siteId: otherSiteId });
    await invoice("X1", "400.00", "2026-01-05", { supplierId: otherSupplierId });
    await invoice("X2", "600.00", "2026-01-06", { supplierId: otherSupplierId });
    await pay("400.00", "2026-01-20", { partyId: otherSupplierId });
    await invoice("Z", "100.00", "2026-01-01", { supplierId: otherSupplierId, siteId: otherSiteId });
    await pay("100.00", "2026-01-02", { partyId: otherSupplierId, siteId: otherSiteId });

    const pending = await reports.pendingLedger(filter(), PAGE);
    const summary = await reports.balances({ ...filter(), show: "all" }, PAGE);

    const sums = new Map<string, number>();
    for (const row of pending.rows) {
      const key = `${row.siteId ?? "none"}:${row.partyId}`;
      sums.set(key, (sums.get(key) ?? 0) + Math.round(Number.parseFloat(row.pending) * 100));
    }

    let owed = 0;
    for (const row of summary.rows) {
      const net = Math.round(Number.parseFloat(row.netAmount) * 100);
      expect(sums.get(row.id) ?? 0).toBe(Math.max(net, 0));
      owed += Math.max(net, 0);
    }
    // Invoice totals are rounded to the rupee, so the figure is read off the
    // summary rather than worked out by hand. Three rows owe, one is settled.
    expect(summary.rows.filter((row) => Number.parseFloat(row.netAmount) > 0)).toHaveLength(3);
    expect(Math.round(Number.parseFloat(pending.totalPending) * 100)).toBe(owed);
  });

  it("applies the supplier filter", async () => {
    await invoice("MINE", "1000.00", "2026-01-01");
    await invoice("THEIRS", "400.00", "2026-01-01", { supplierId: otherSupplierId });

    expect((await listed({ partyId: otherSupplierId })).map((row) => row[0])).toEqual(["THEIRS"]);
  });

  it("totals the whole filtered set, not the page", async () => {
    await invoice("A", "1000.00", "2026-01-01");
    await invoice("B", "500.00", "2026-02-01");
    await invoice("C", "700.00", "2026-03-01");
    await pay("1200.00", "2026-03-10");

    const first = await reports.pendingLedger(filter(), { limit: 1, offset: 0 });
    expect(first.rows.map((row) => row.displayNo)).toEqual(["B"]);
    expect(first.total).toBe(2);
    expect(first.nextCursor).toBe("1");
    expect(first.totalAmount).toBe("1200.00");
    expect(first.totalPending).toBe("1000.00");

    // The running balance carries across the page boundary.
    const second = await reports.pendingLedger(filter(), { limit: 1, offset: 1 });
    expect(second.rows.map((row) => [row.displayNo, row.balance])).toEqual([["C", "1000.00"]]);
    expect(second.nextCursor).toBeNull();
  });
});
