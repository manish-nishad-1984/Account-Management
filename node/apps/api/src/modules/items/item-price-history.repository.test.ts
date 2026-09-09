import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createPurchaseInvoiceSchema } from "@accountmanagement/contracts";
import { ItemPriceHistoryRepository } from "./item-price-history.repository";
import { PurchaseInvoicesRepository } from "../purchase-invoices/purchase-invoices.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";
const LIMIT = 50;

/**
 * The legacy panel and the four defects in its seven columns.
 *
 * These tests are written against the DEFECTS as much as against the feature:
 * three of them produce a plausible-looking wrong number rather than an error,
 * and a test that only checks "a row came back" would pass over every one.
 */
describe("ItemPriceHistoryRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: ItemPriceHistoryRepository;
  let invoices: PurchaseInvoicesRepository;

  let cementId: string;
  let steelId: string;
  let unitId: number;
  let siteId: string;
  let supplierId: string;
  let otherSupplierId: string;
  let companyId: string;

  const invoice = (overrides: Record<string, unknown> = {}) =>
    createPurchaseInvoiceSchema.parse({
      supplierInvoiceNo: "BB/154",
      supplierId,
      companyId,
      siteId,
      items: [{ itemId: cementId, unitId, quantity: "10", unitPrice: "395.00", gstPercent: "18" }],
      ...overrides,
    });

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new ItemPriceHistoryRepository(db);
    invoices = new PurchaseInvoicesRepository(db);

    const [unit] = await db
      .insert(schema.units)
      .values({ name: "Bag" })
      .returning({ id: schema.units.id });
    unitId = unit!.id;

    const created = await db
      .insert(schema.items)
      .values([
        { name: "OPC 53 Grade Cement", unitId, pricePerUnit: "395.00" },
        { name: "TMT Steel Bar 12mm", unitId, pricePerUnit: "62000.00" },
      ])
      .returning({ id: schema.items.id, name: schema.items.name });
    cementId = created.find((row) => row.name.startsWith("OPC"))!.id;
    steelId = created.find((row) => row.name.startsWith("TMT"))!.id;

    const [site] = await db
      .insert(schema.sites)
      .values({ name: "Akwada Lake Front", isActive: true })
      .returning({ id: schema.sites.id });
    siteId = site!.id;

    // `suppliers.area` is NOT NULL — omitting it fails the whole file with a
    // constraint violation that names the column but not the fixture.
    const madeSuppliers = await db
      .insert(schema.suppliers)
      .values([
        { name: "AL BURHAN PIPES & SANITATION", area: "Navrangpura" },
        { name: "SHAH ENTERPRISE", area: "Maninagar" },
      ])
      .returning({ id: schema.suppliers.id, name: schema.suppliers.name });
    supplierId = madeSuppliers[0]!.id;
    otherSupplierId = madeSuppliers[1]!.id;

    const [company] = await db
      .insert(schema.companies)
      .values({ name: "DH PATEL", invoicePrefix: "DHP" })
      .returning({ id: schema.companies.id });
    companyId = company!.id;
  });

  describe("what it returns at all", () => {
    it("lists one row per invoice line for the item, and nothing for other items", async () => {
      await invoices.create(invoice(), ACTOR);
      await invoices.create(
        invoice({
          items: [{ itemId: steelId, unitId, quantity: "2", unitPrice: "62000.00" }],
        }),
        ACTOR,
      );

      const history = await repo.forItem(cementId, LIMIT);

      expect(history.total).toBe(1);
      expect(history.rows).toHaveLength(1);
      expect(history.rows[0]!.unitPrice).toBe("395.00");
      expect(history.rows[0]!.supplierName).toBe("AL BURHAN PIPES & SANITATION");
      expect(history.rows[0]!.siteName).toBe("Akwada Lake Front");
      expect(history.rows[0]!.companyName).toBe("DH PATEL");
    });

    it("is empty, not an error, for an item nobody has bought", async () => {
      const history = await repo.forItem(steelId, LIMIT);

      expect(history.rows).toEqual([]);
      expect(history.total).toBe(0);
    });

    it("404s on an item that does not exist", async () => {
      await expect(
        repo.forItem("00000000-0000-0000-0000-000000000000", LIMIT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("404s on a soft-deleted item rather than showing its history", async () => {
      await invoices.create(invoice(), ACTOR);
      await db.update(schema.items).set({ isDeleted: true }).where(eq(schema.items.id, cementId));

      await expect(repo.forItem(cementId, LIMIT)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  /**
   * DEFECT 3, the expensive one.
   *
   * `_ItemHistoryPartial.cshtml` computes its PriceWithGST column as
   * `TotalAmount / Quantity`, where TotalAmount is the INVOICE HEADER's grand
   * total and Quantity is ONE LINE's quantity. This is the test that would fail
   * if anyone reproduced it, and it needs a MULTI-LINE invoice to fail at all —
   * on a single-line invoice the wrong expression lands near the right answer.
   */
  describe("the per-unit price with GST, which the legacy panel computes from the wrong total", () => {
    it("divides the LINE, not the whole invoice", async () => {
      await invoices.create(
        invoice({
          items: [
            { itemId: cementId, unitId, quantity: "10", unitPrice: "395.00", gstPercent: "18" },
            { itemId: steelId, unitId, quantity: "5", unitPrice: "62000.00", gstPercent: "18" },
          ],
        }),
        ACTOR,
      );

      const history = await repo.forItem(cementId, LIMIT);
      const row = history.rows[0]!;

      // The cement line: 10 x 395 = 3950 net, 18% = 711, so 4661 and 466.10 each.
      expect(row.netAmount).toBe("3950.00");
      expect(row.gstAmount).toBe("711.00");
      expect(row.lineTotal).toBe("4661.00");
      expect(row.effectiveUnitPrice).toBe("395.00");
      expect(row.effectiveUnitPriceWithGst).toBe("466.10");

      // What the legacy expression would have produced from the same invoice:
      // the whole document (4661 + 365800 = 370461) over the cement quantity.
      const invoiceTotal = Number.parseFloat(
        (await invoices.findById(row.invoiceId)).totalAmount,
      );
      expect(invoiceTotal / 10).toBeGreaterThan(3000);
      expect(row.effectiveUnitPriceWithGst).not.toBe((invoiceTotal / 10).toFixed(2));
    });

    it("takes the discount off the effective price, and leaves the list price alone", async () => {
      await invoices.create(
        invoice({
          items: [
            {
              itemId: cementId,
              unitId,
              quantity: "10",
              unitPrice: "400.00",
              discountPerUnit: "20.00",
              gstPercent: "18",
            },
          ],
        }),
        ACTOR,
      );

      const row = (await repo.forItem(cementId, LIMIT)).rows[0]!;

      expect(row.unitPrice).toBe("400.00");
      expect(row.discountPerUnit).toBe("20.00");
      // 380 x 10 = 3800 net, 18% = 684, 4484 total, so 448.40 a unit.
      expect(row.effectiveUnitPrice).toBe("380.00");
      expect(row.effectiveUnitPriceWithGst).toBe("448.40");
    });

    it("reports zero rather than dividing by a zero quantity", async () => {
      const created = await invoices.create(invoice(), ACTOR);
      // Reachable through an ETL of historical rows even though the contract
      // refuses it here, which is why the guard is in SQL and not assumed away.
      await db
        .update(schema.purchaseInvoiceItems)
        .set({ quantity: "0" })
        .where(eq(schema.purchaseInvoiceItems.purchaseInvoiceId, created.id));

      const row = (await repo.forItem(cementId, LIMIT)).rows[0]!;

      expect(row.effectiveUnitPrice).toBe("0.00");
      expect(row.effectiveUnitPriceWithGst).toBe("0.00");
    });
  });

  /**
   * DEFECT 2. The legacy GST column reads `f.Gstper` off the ITEM MASTER, so
   * editing an item rewrites the rate shown against every historical invoice.
   */
  describe("the GST percentage, which the legacy panel reads off the item master", () => {
    it("keeps the rate that was charged when the item's rate later changes", async () => {
      await invoices.create(
        invoice({
          items: [{ itemId: cementId, unitId, quantity: "1", unitPrice: "395.00", gstPercent: "12" }],
        }),
        ACTOR,
      );

      await db
        .update(schema.items)
        .set({ isWithGst: true, gstPercent: "28.00" })
        .where(eq(schema.items.id, cementId));

      const row = (await repo.forItem(cementId, LIMIT)).rows[0]!;

      expect(row.gstPercent).toBe("12.00");
    });
  });

  /**
   * DEFECT 4. The legacy query groups by invoice id and takes `group.First()`,
   * so an item on two lines of one invoice loses every line but the first —
   * including, on a rate change mid-document, the only line at the other price.
   */
  describe("two lines of one invoice for the same item", () => {
    it("keeps both, where the legacy GroupBy keeps the first", async () => {
      await invoices.create(
        invoice({
          items: [
            { itemId: cementId, unitId, quantity: "10", unitPrice: "395.00", gstPercent: "18" },
            { itemId: cementId, unitId, quantity: "4", unitPrice: "410.00", gstPercent: "18" },
          ],
        }),
        ACTOR,
      );

      const history = await repo.forItem(cementId, LIMIT);

      expect(history.total).toBe(2);
      expect(history.rows.map((row) => row.unitPrice).sort()).toEqual(["395.00", "410.00"]);
      // Two lines of one invoice, so distinct row ids under one invoice id.
      expect(new Set(history.rows.map((row) => row.id)).size).toBe(2);
      expect(new Set(history.rows.map((row) => row.invoiceId)).size).toBe(1);
    });
  });

  describe("which invoices count", () => {
    it("excludes the payment rows the source hides behind the number PayOut", async () => {
      await invoices.create(invoice(), ACTOR);
      const payout = await invoices.create(invoice({ supplierInvoiceNo: "PO-1" }), ACTOR);
      // A payment row as the ETL will load one: our own number is the literal
      // "PayOut" and there is no supplier number. This module never creates one
      // — the payments screens are Phase 5 and blocked on D7.
      await db
        .update(schema.purchaseInvoices)
        .set({ invoiceNo: "PayOut", supplierInvoiceNo: null })
        .where(eq(schema.purchaseInvoices.id, payout.id));

      const history = await repo.forItem(cementId, LIMIT);

      expect(history.total).toBe(1);
      expect(history.rows.map((row) => row.invoiceId)).not.toContain(payout.id);
    });

    it("keeps an invoice with NO number at all, which a bare != would drop", async () => {
      // `ne()` on a NULL column is NULL, not true, so `invoice_no != 'PayOut'`
      // alone excludes every row whose number is absent — and both numbers are
      // nullable, so an invoice with neither is ordinary.
      const created = await invoices.create(invoice(), ACTOR);
      // `supplierInvoiceNo` is REQUIRED on create, so this shape only ever
      // arrives through the ETL — which is exactly why it has to be tested.
      await db
        .update(schema.purchaseInvoices)
        .set({ supplierInvoiceNo: null, invoiceNo: null })
        .where(eq(schema.purchaseInvoices.id, created.id));

      const history = await repo.forItem(cementId, LIMIT);

      expect(history.total).toBe(1);
      expect(history.rows[0]!.invoiceId).toBe(created.id);
      expect(history.rows[0]!.displayNo).toBe("(no number)");
    });

    it("keeps an invoice with no site, which the source's INNER JOIN drops", async () => {
      await invoices.create(invoice({ siteId: null }), ACTOR);

      const history = await repo.forItem(cementId, LIMIT);

      expect(history.total).toBe(1);
      expect(history.rows[0]!.siteId).toBeNull();
      expect(history.rows[0]!.siteName).toBeNull();
    });

    it("carries the invoice type, so a purchase return is not read as a price paid", async () => {
      await invoices.create(invoice({ invoiceType: "Purchase Return" }), ACTOR);

      expect((await repo.forItem(cementId, LIMIT)).rows[0]!.invoiceType).toBe("Purchase Return");
    });

    it("carries the approval flag, so an unconfirmed price can be marked", async () => {
      await invoices.create(invoice(), ACTOR);

      expect((await repo.forItem(cementId, LIMIT)).rows[0]!.isApproved).toBe(false);
    });

    it("is not scoped to a site — the panel is what the business paid", async () => {
      const [other] = await db
        .insert(schema.sites)
        .values({ name: "Surat Diamond Park", isActive: true })
        .returning({ id: schema.sites.id });

      await invoices.create(invoice(), ACTOR);
      await invoices.create(invoice({ siteId: other!.id }), ACTOR);

      expect((await repo.forItem(cementId, LIMIT)).total).toBe(2);
    });
  });

  describe("ordering and the cap", () => {
    it("puts the newest document first, where the source lists the oldest", async () => {
      await invoices.create(
        invoice({ supplierInvoiceNo: "OLD", documentDate: "2024-04-01T00:00:00.000Z" }),
        ACTOR,
      );
      await invoices.create(
        invoice({ supplierInvoiceNo: "NEW", documentDate: "2026-01-15T00:00:00.000Z" }),
        ACTOR,
      );
      await invoices.create(
        invoice({ supplierInvoiceNo: "MID", documentDate: "2025-08-09T00:00:00.000Z" }),
        ACTOR,
      );

      const history = await repo.forItem(cementId, LIMIT);

      expect(history.rows.map((row) => row.displayNo)).toEqual(["NEW", "MID", "OLD"]);
    });

    it("sorts an undated document last rather than letting it claim to be newest", async () => {
      await invoices.create(
        invoice({ supplierInvoiceNo: "DATED", documentDate: "2020-01-01T00:00:00.000Z" }),
        ACTOR,
      );
      await invoices.create(invoice({ supplierInvoiceNo: "UNDATED", documentDate: null }), ACTOR);

      const history = await repo.forItem(cementId, LIMIT);

      expect(history.rows.map((row) => row.displayNo)).toEqual(["DATED", "UNDATED"]);
    });

    it("caps the rows and still reports the true total", async () => {
      for (let n = 0; n < 5; n += 1) {
        await invoices.create(invoice({ supplierInvoiceNo: `INV-${n}` }), ACTOR);
      }

      const history = await repo.forItem(cementId, 2);

      expect(history.rows).toHaveLength(2);
      expect(history.total).toBe(5);
    });
  });

  it("names a different supplier per row, which is the comparison the panel is for", async () => {
    await invoices.create(
      invoice({ supplierInvoiceNo: "A", documentDate: "2026-01-01T00:00:00.000Z" }),
      ACTOR,
    );
    await invoices.create(
      invoice({
        supplierInvoiceNo: "B",
        supplierId: otherSupplierId,
        documentDate: "2026-02-01T00:00:00.000Z",
        items: [{ itemId: cementId, unitId, quantity: "10", unitPrice: "372.50", gstPercent: "18" }],
      }),
      ACTOR,
    );

    const history = await repo.forItem(cementId, LIMIT);

    expect(history.rows.map((row) => [row.supplierName, row.effectiveUnitPrice])).toEqual([
      ["SHAH ENTERPRISE", "372.50"],
      ["AL BURHAN PIPES & SANITATION", "395.00"],
    ]);
  });
});
