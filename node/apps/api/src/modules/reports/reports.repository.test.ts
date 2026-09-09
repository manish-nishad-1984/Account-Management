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
 * The two report grids, and finding D7.
 *
 * D7 is "purchase returns are added to supplier balances instead of
 * subtracted". Reading both legacy implementations places it precisely: the
 * LEDGER panel gets it right (in a browser cell renderer) and the SUMMARY panel
 * gets it wrong (in C#), so the two panels of one screen disagree by twice the
 * value of any return. These tests pin the corrected arithmetic and, where it
 * matters, state what the legacy expression would have produced instead.
 */
describe("ReportsRepository (real PostgreSQL)", () => {
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

  /** An invoice whose TOTAL is exactly `amount`: no GST, no TDS, no rounding. */
  const invoiceFor = (amount: string, overrides: Record<string, unknown> = {}) =>
    createPurchaseInvoiceSchema.parse({
      supplierInvoiceNo: "INV-1",
      supplierId,
      companyId,
      siteId,
      items: [{ itemId, unitId, quantity: "1", unitPrice: amount }],
      ...overrides,
    });

  beforeEach(async () => {
    db = await freshDatabase();
    reports = new ReportsRepository(db);
    payments = new PaymentsRepository(db);
    invoices = new PurchaseInvoicesRepository(db);

    const [unit] = await db
      .insert(schema.units)
      .values({ name: "Bag" })
      .returning({ id: schema.units.id });
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
      .values([
        { name: "AL BURHAN PIPES", area: "Navrangpura" },
        { name: "SHAH ENTERPRISE", area: "Maninagar" },
      ])
      .returning({ id: schema.suppliers.id, name: schema.suppliers.name });
    supplierId = madeSuppliers.find((s) => s.name.startsWith("AL"))!.id;
    otherSupplierId = madeSuppliers.find((s) => s.name.startsWith("SHAH"))!.id;

    const [company] = await db
      .insert(schema.companies)
      .values({ name: "DH PATEL", invoicePrefix: "DHP" })
      .returning({ id: schema.companies.id });
    companyId = company!.id;
  });

  /**
   * FINDING D7, pinned.
   *
   * The legacy summary computes
   *   NetAmount = Sum(InvoiceNo != "PayOut" ? +Total : -Total)
   * which negates payouts and NOTHING else, while its own Debit column at the
   * line above counts returns and credit notes as debits. So a return is shown
   * as a debit AND added to the balance.
   */
  describe("D7 — a purchase return in the balance", () => {
    it("subtracts a purchase return, where the legacy summary adds it", async () => {
      await invoices.create(invoiceFor("100000.00"), ACTOR);
      await invoices.create(
        invoiceFor("10000.00", { supplierInvoiceNo: "RET-1", invoiceType: "Purchase Return" }),
        ACTOR,
      );

      const result = await reports.balances({ ...filter(), show: "all" }, PAGE);
      const row = result.rows[0]!;

      expect(row.credit).toBe("100000.00");
      expect(row.debit).toBe("10000.00");
      expect(row.netAmount).toBe("90000.00");

      // The legacy expression negates only payouts, so the return is ADDED:
      // 100000 + 10000 = 110000. Twenty thousand apart from the truth, on the
      // number a supplier is paid against.
      expect(row.netAmount).not.toBe("110000.00");
    });

    it("subtracts a credit note the same way", async () => {
      await invoices.create(invoiceFor("5000.00"), ACTOR);
      await invoices.create(
        invoiceFor("2000.00", { supplierInvoiceNo: "CN-1", invoiceType: "Credit Note" }),
        ACTOR,
      );

      const row = (await reports.balances({ ...filter(), show: "all" }, PAGE)).rows[0]!;

      expect(row.debit).toBe("2000.00");
      expect(row.netAmount).toBe("3000.00");
    });

    it("keeps net equal to credit minus debit for every row", async () => {
      await invoices.create(invoiceFor("7000.00"), ACTOR);
      await invoices.create(
        invoiceFor("1500.00", { supplierInvoiceNo: "R", invoiceType: "Purchase Return" }),
        ACTOR,
      );
      await payments.createMany(
        [
          {
            direction: "out",
            kind: "payment",
            partyId: supplierId,
            companyId,
            siteId,
            siteGroupId: null,
            paymentDate: null,
            amount: "2000.00",
            description: null,
            method: null,
            referenceNo: null,
          },
        ],
        ACTOR,
      );

      const result = await reports.balances({ ...filter(), show: "all" }, PAGE);

      // The invariant the legacy summary breaks. Asserted per row rather than
      // only on the totals, because the totals could agree by cancellation.
      for (const row of result.rows) {
        const expected = (
          Number.parseFloat(row.credit) - Number.parseFloat(row.debit)
        ).toFixed(2);
        expect(row.netAmount).toBe(expected);
      }
      expect(result.closingBalance).toBe("3500.00");
    });
  });

  describe("the summary, and the settled parties the legacy version hides", () => {
    it("shows a fully settled party rather than dropping it", async () => {
      await invoices.create(invoiceFor("5000.00"), ACTOR);
      await payments.createMany(
        [
          {
            direction: "out",
            kind: "payment",
            partyId: supplierId,
            companyId,
            siteId,
            siteGroupId: null,
            paymentDate: null,
            amount: "5000.00",
            description: null,
            method: null,
            referenceNo: null,
          },
        ],
        ACTOR,
      );

      const all = await reports.balances({ ...filter(), show: "all" }, PAGE);

      expect(all.rows).toHaveLength(1);
      expect(all.rows[0]!.netAmount).toBe("0.00");
    });

    it("hides it only when asked, and the footer then matches what is shown", async () => {
      await invoices.create(invoiceFor("5000.00"), ACTOR);
      await payments.createMany(
        [
          {
            direction: "out",
            kind: "payment",
            partyId: supplierId,
            companyId,
            siteId,
            siteGroupId: null,
            paymentDate: null,
            amount: "5000.00",
            description: null,
            method: null,
            referenceNo: null,
          },
        ],
        ACTOR,
      );

      const outstanding = await reports.balances({ ...filter(), show: "outstanding" }, PAGE);

      expect(outstanding.rows).toHaveLength(0);
      // THE LEGACY DEFECT: its footer is computed BEFORE the `NetAmount != 0`
      // filter, so a grid with no rows still reports 5000 credit and 5000 debit
      // and does not add up to its own Total row.
      expect(outstanding.totalCredit).toBe("0.00");
      expect(outstanding.totalDebit).toBe("0.00");
    });

    it("groups by site and party, as the source does", async () => {
      await invoices.create(invoiceFor("1000.00"), ACTOR);
      await invoices.create(invoiceFor("2000.00", { siteId: otherSiteId }), ACTOR);
      await invoices.create(invoiceFor("400.00", { supplierId: otherSupplierId }), ACTOR);

      const result = await reports.balances({ ...filter(), show: "all" }, PAGE);

      expect(result.total).toBe(3);
      expect(result.closingBalance).toBe("3400.00");
    });
  });

  describe("the ledger, and its running balance", () => {
    const payment = (amount: string, overrides: Record<string, unknown> = {}) => ({
      direction: "out" as const,
      kind: "payment" as const,
      partyId: supplierId,
      companyId,
      siteId,
      siteGroupId: null,
      paymentDate: null,
      amount,
      description: null,
      method: null,
      referenceNo: null,
      ...overrides,
    });

    it("runs the balance forward in date order", async () => {
      await invoices.create(
        invoiceFor("1000.00", { supplierInvoiceNo: "A", documentDate: "2026-01-01T00:00:00.000Z" }),
        ACTOR,
      );
      await invoices.create(
        invoiceFor("500.00", { supplierInvoiceNo: "B", documentDate: "2026-02-01T00:00:00.000Z" }),
        ACTOR,
      );
      await payments.createMany(
        [payment("300.00", { paymentDate: "2026-03-01T00:00:00.000Z" })],
        ACTOR,
      );

      const result = await reports.ledger(filter(), PAGE);

      expect(result.rows.map((row) => [row.displayNo, row.balance])).toEqual([
        ["A", "1000.00"],
        ["B", "1500.00"],
        ["—", "1200.00"],
      ]);
      expect(result.totalCredit).toBe("1500.00");
      expect(result.totalDebit).toBe("300.00");
      expect(result.closingBalance).toBe("1200.00");
    });

    /**
     * THE DEFECT THE LEGACY ACCUMULATOR HAS, and the reason it exists.
     *
     * `Report.js:619` keys a `processedInvoices` Set by
     * `invoiceNo + "_" + totalAmount` for payments. That guard is there because
     * a DataTables cell renderer is called more than once per row; its side
     * effect is that a SECOND payment of the same amount is never added. The
     * second ₹300 below is invisible in the legacy balance.
     */
    it("counts a second payment of the same amount, which the legacy guard skips", async () => {
      await invoices.create(
        invoiceFor("1000.00", { supplierInvoiceNo: "A", documentDate: "2026-01-01T00:00:00.000Z" }),
        ACTOR,
      );
      await payments.createMany(
        [
          payment("300.00", { paymentDate: "2026-02-01T00:00:00.000Z" }),
          payment("300.00", { paymentDate: "2026-03-01T00:00:00.000Z" }),
        ],
        ACTOR,
      );

      const result = await reports.ledger(filter(), PAGE);

      expect(result.rows).toHaveLength(3);
      // 1000, then 700, then 400. The legacy version stops at 700.
      expect(result.rows.map((row) => row.balance)).toEqual(["1000.00", "700.00", "400.00"]);
      expect(result.closingBalance).toBe("400.00");
    });

    /**
     * The same guard keys ordinary invoices by their NUMBER alone, and
     * `purchase_invoices` deliberately has no uniqueness on it — the schema note
     * says two suppliers numbering an invoice `016` is ordinary, and so is one
     * supplier reusing a number.
     */
    it("counts two invoices that share a number, which the legacy guard skips", async () => {
      await invoices.create(
        invoiceFor("100.00", { supplierInvoiceNo: "016", documentDate: "2026-01-01T00:00:00.000Z" }),
        ACTOR,
      );
      await invoices.create(
        invoiceFor("250.00", { supplierInvoiceNo: "016", documentDate: "2026-02-01T00:00:00.000Z" }),
        ACTOR,
      );

      const result = await reports.ledger(filter(), PAGE);

      expect(result.rows).toHaveLength(2);
      expect(result.closingBalance).toBe("350.00");
    });

    /** The legacy accumulator is keyed by supplier NAME, so namesakes merge. */
    it("keeps a separate balance per party", async () => {
      await invoices.create(
        invoiceFor("1000.00", { supplierInvoiceNo: "A", documentDate: "2026-01-01T00:00:00.000Z" }),
        ACTOR,
      );
      await invoices.create(
        invoiceFor("400.00", {
          supplierInvoiceNo: "B",
          supplierId: otherSupplierId,
          documentDate: "2026-01-02T00:00:00.000Z",
        }),
        ACTOR,
      );

      const result = await reports.ledger(filter(), PAGE);
      const byParty = new Map(result.rows.map((row) => [row.partyName, row.balance]));

      expect(byParty.get("AL BURHAN PIPES")).toBe("1000.00");
      expect(byParty.get("SHAH ENTERPRISE")).toBe("400.00");
    });

    /**
     * `14-reports-and-payments.md` point 1. This is the test that would fail if
     * the balance were computed per page, which is what a naive port does after
     * enabling the paging the legacy grid never had.
     */
    it("continues the balance across a page boundary", async () => {
      for (let n = 0; n < 5; n += 1) {
        await invoices.create(
          invoiceFor("100.00", {
            supplierInvoiceNo: `I${n}`,
            documentDate: `2026-01-0${n + 1}T00:00:00.000Z`,
          }),
          ACTOR,
        );
      }

      const first = await reports.ledger(filter(), { limit: 2, offset: 0 });
      const second = await reports.ledger(filter(), { limit: 2, offset: 2 });
      const third = await reports.ledger(filter(), { limit: 2, offset: 4 });

      expect(first.rows.map((r) => r.balance)).toEqual(["100.00", "200.00"]);
      expect(second.rows.map((r) => r.balance)).toEqual(["300.00", "400.00"]);
      expect(third.rows.map((r) => r.balance)).toEqual(["500.00"]);

      // The totals are over the whole set on every page, not the page.
      expect(first.total).toBe(5);
      expect(second.totalCredit).toBe("500.00");
      expect(first.nextCursor).toBe("2");
      expect(third.nextCursor).toBeNull();
    });

    it("treats an opening balance as a credit and a payment as a debit", async () => {
      await payments.createMany(
        [
          payment("2000.00", {
            kind: "opening_balance",
            siteId: null,
            paymentDate: "2026-01-01T00:00:00.000Z",
          }),
          payment("500.00", { paymentDate: "2026-02-01T00:00:00.000Z" }),
        ],
        ACTOR,
      );

      const result = await reports.ledger(filter(), PAGE);

      expect(result.rows.map((row) => [row.label, row.effect, row.balance])).toEqual([
        ["Opening balance", "credit", "2000.00"],
        ["Payment", "debit", "1500.00"],
      ]);
    });

    it("labels each row by what produced it", async () => {
      await invoices.create(
        invoiceFor("100.00", { supplierInvoiceNo: "A", documentDate: "2026-01-01T00:00:00.000Z" }),
        ACTOR,
      );
      await invoices.create(
        invoiceFor("10.00", {
          supplierInvoiceNo: "R",
          invoiceType: "Purchase Return",
          documentDate: "2026-01-02T00:00:00.000Z",
        }),
        ACTOR,
      );
      await payments.createMany(
        [payment("5.00", { paymentDate: "2026-01-03T00:00:00.000Z" })],
        ACTOR,
      );

      const result = await reports.ledger(filter(), PAGE);

      expect(result.rows.map((row) => row.source)).toEqual(["invoice", "return", "payment"]);
    });

    it("excludes a soft-deleted payment from the balance", async () => {
      await invoices.create(
        invoiceFor("1000.00", { supplierInvoiceNo: "A", documentDate: "2026-01-01T00:00:00.000Z" }),
        ACTOR,
      );
      await payments.createMany(
        [payment("400.00", { paymentDate: "2026-02-01T00:00:00.000Z" })],
        ACTOR,
      );

      const before = await reports.ledger(filter(), PAGE);
      expect(before.closingBalance).toBe("600.00");

      const [row] = await db.select({ id: schema.payments.id }).from(schema.payments);
      await payments.remove(row!.id, ACTOR);

      const after = await reports.ledger(filter(), PAGE);
      expect(after.rows).toHaveLength(1);
      expect(after.closingBalance).toBe("1000.00");
    });
  });

  describe("filters", () => {
    it("filters by party, site and company", async () => {
      await invoices.create(invoiceFor("1000.00"), ACTOR);
      await invoices.create(invoiceFor("2000.00", { siteId: otherSiteId }), ACTOR);
      await invoices.create(invoiceFor("400.00", { supplierId: otherSupplierId }), ACTOR);

      expect((await reports.ledger(filter({ siteId }), PAGE)).total).toBe(2);
      expect((await reports.ledger(filter({ partyId: otherSupplierId }), PAGE)).total).toBe(1);
      expect((await reports.ledger(filter({ companyId }), PAGE)).total).toBe(3);
    });

    it("filters by date range", async () => {
      await invoices.create(
        invoiceFor("100.00", { supplierInvoiceNo: "OLD", documentDate: "2025-01-01T00:00:00.000Z" }),
        ACTOR,
      );
      await invoices.create(
        invoiceFor("200.00", { supplierInvoiceNo: "NEW", documentDate: "2026-06-01T00:00:00.000Z" }),
        ACTOR,
      );

      const result = await reports.ledger(
        filter({ fromDate: "2026-01-01T00:00:00.000Z" }),
        PAGE,
      );

      expect(result.rows.map((row) => row.displayNo)).toEqual(["NEW"]);
    });

    /**
     * A document with no date is kept by a date filter rather than dropped.
     *
     * `document_date` is nullable and the source's own filter is a bare
     * `Date >= start`, which is NULL for an undated row and therefore excludes
     * it — silently removing it from a balance it genuinely belongs to.
     */
    it("keeps an undated document inside a date range", async () => {
      await invoices.create(
        invoiceFor("100.00", { supplierInvoiceNo: "DATED", documentDate: "2026-06-01T00:00:00.000Z" }),
        ACTOR,
      );
      await invoices.create(
        invoiceFor("50.00", { supplierInvoiceNo: "UNDATED", documentDate: null }),
        ACTOR,
      );

      const result = await reports.ledger(
        filter({ fromDate: "2026-01-01T00:00:00.000Z" }),
        PAGE,
      );

      expect(result.total).toBe(2);
      expect(result.closingBalance).toBe("150.00");
    });

    it("returns nothing for the other direction when only purchases exist", async () => {
      await invoices.create(invoiceFor("1000.00"), ACTOR);

      const incoming = await reports.ledger(filter({ direction: "in" }), PAGE);

      expect(incoming.rows).toEqual([]);
      expect(incoming.closingBalance).toBe("0.00");
    });
  });

  it("reports zero rather than failing on an empty database", async () => {
    const ledger = await reports.ledger(filter(), PAGE);
    const balances = await reports.balances({ ...filter(), show: "all" }, PAGE);

    expect(ledger.total).toBe(0);
    expect(ledger.totalCredit).toBe("0.00");
    expect(ledger.closingBalance).toBe("0.00");
    expect(balances.total).toBe(0);
    expect(balances.closingBalance).toBe("0.00");
  });
});
