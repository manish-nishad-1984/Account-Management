import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  createPurchaseInvoiceSchema,
  listQuerySchema,
  updatePurchaseInvoiceSchema,
  type CreatePurchaseInvoice,
} from "@accountmanagement/contracts";
import { PurchaseInvoicesRepository } from "./purchase-invoices.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const patch = (body: Record<string, unknown>) => updatePurchaseInvoiceSchema.parse(body);

const ACTOR = "11111111-1111-1111-1111-111111111111";

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

const eqId = (id: string) => eq(schema.purchaseInvoices.id, id);

describe("PurchaseInvoicesRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: PurchaseInvoicesRepository;
  let siteId: string;
  let supplierId: string;
  let otherSupplierId: string;
  let companyId: string;
  let otherCompanyId: string;
  let itemId: string;
  let unitId: number;

  const input = (overrides: Record<string, unknown> = {}): CreatePurchaseInvoice =>
    createPurchaseInvoiceSchema.parse({
      supplierInvoiceNo: "BB/154",
      supplierId,
      companyId,
      siteId,
      items: [{ itemId, unitId, quantity: "3", unitPrice: "1000.00", gstPercent: "18" }],
      ...overrides,
    });

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new PurchaseInvoicesRepository(db);

    const [unit] = await db
      .insert(schema.units)
      .values({ name: "Bag" })
      .returning({ id: schema.units.id });
    unitId = unit!.id;

    const [item] = await db
      .insert(schema.items)
      .values({ name: "OPC 53 Grade Cement", unitId, pricePerUnit: "395.00" })
      .returning({ id: schema.items.id });
    itemId = item!.id;

    const [site] = await db
      .insert(schema.sites)
      .values({ name: "Akwada Lake Front", isActive: true })
      .returning({ id: schema.sites.id });
    siteId = site!.id;

    // `suppliers.area` is NOT NULL — omitting it fails every test in the file
    // with a constraint violation that names the column but not the fixture.
    const suppliers = await db
      .insert(schema.suppliers)
      .values([
        { name: "AL BURHAN PIPES & SANITATION", area: "Navrangpura" },
        { name: "SHAH ENTERPRISE", area: "Maninagar" },
      ])
      .returning({ id: schema.suppliers.id, name: schema.suppliers.name });
    supplierId = suppliers[0]!.id;
    otherSupplierId = suppliers[1]!.id;

    const companies = await db
      .insert(schema.companies)
      .values([{ name: "DH PATEL", invoicePrefix: "DHP" }, { name: "DEMO", invoicePrefix: "DEMO" }])
      .returning({ id: schema.companies.id, name: schema.companies.name });
    companyId = companies.find((row) => row.name === "DH PATEL")!.id;
    otherCompanyId = companies.find((row) => row.name === "DEMO")!.id;
  });

  /**
   * THE TESTS THIS FILE EXISTS FOR.
   *
   * B-2(a) is that the TDS box on the live screen is read by a calculator that
   * has been overwritten, so the amount typed never reaches the total. These pin
   * the opposite, on the server, where the client cannot influence it.
   */
  describe("the totals the live screen gets wrong", () => {
    it("subtracts the TDS from the total", async () => {
      const without = await repo.create(input(), ACTOR);
      const with500 = await repo.create(input({ tds: "500.00" }), ACTOR);

      // 3 x 1000 = 3000, GST 18% = 540, so 3540 and then 3040.
      expect(without.totalAmount).toBe("3540.00");
      expect(with500.totalAmount).toBe("3040.00");
      expect(with500.tds).toBe("500.00");
    });

    it("adds the adjustment, and accepts a NEGATIVE one", async () => {
      const up = await repo.create(input({ roundOff: "10.00" }), ACTOR);
      const down = await repo.create(input({ roundOff: "-10.00" }), ACTOR);

      expect(up.totalAmount).toBe("3550.00");
      expect(down.totalAmount).toBe("3530.00");
    });

    /**
     * Every issued invoice has a whole-rupee total, with exactly .50 rounding
     * DOWN — `roundToWholeRupeeAsProduced`. All six sample totals in
     * `10-purchase-invoice.md` end in .00, which is what this produces and what
     * nothing else would.
     */
    it("rounds the grand total to a whole rupee, with .50 going down", async () => {
      // 1 x 100.00 + 5% GST = 105.00, then the adjustment lands it on the tie.
      const tie = await repo.create(
        input({
          items: [{ itemId, unitId, quantity: "1", unitPrice: "100.00", gstPercent: "5" }],
          roundOff: "0.50",
        }),
        ACTOR,
      );
      expect(tie.totalAmount).toBe("105.00");

      const above = await repo.create(
        input({
          items: [{ itemId, unitId, quantity: "1", unitPrice: "100.00", gstPercent: "5" }],
          roundOff: "0.51",
        }),
        ACTOR,
      );
      expect(above.totalAmount).toBe("106.00");
    });

    it("subtracts a per-unit discount, and reports it separately", async () => {
      const created = await repo.create(
        input({
          items: [
            { itemId, unitId, quantity: "10", unitPrice: "100.00", discountPerUnit: "10.00", gstPercent: "18" },
          ],
        }),
        ACTOR,
      );

      // (100 − 10) x 10 = 900 net, GST 162, total 1062. Discount is 10 x 10.
      expect(created.subtotal).toBe("900.00");
      expect(created.totalGstAmount).toBe("162.00");
      expect(created.totalDiscount).toBe("100.00");
      expect(created.totalAmount).toBe("1062.00");
    });

    /**
     * B-2(b): the running calculator iterates `.product` and the rows the page
     * was built with are `.productRow`, so it sums half the table. A two-line
     * invoice is the smallest case that shows it.
     */
    it("counts EVERY line, which no legacy calculator does", async () => {
      const created = await repo.create(
        input({
          items: [
            { itemId, unitId, quantity: "1", unitPrice: "1000.00", gstPercent: "18" },
            { itemId, unitId, quantity: "1", unitPrice: "500.00", gstPercent: "18" },
          ],
        }),
        ACTOR,
      );

      // 1500 net + 270 GST = 1770 — the number the assessment says neither
      // calculator produces. One gives 590, the other 1180.
      expect(created.subtotal).toBe("1500.00");
      expect(created.totalAmount).toBe("1770.00");
    });

    it("never takes a total from the client — there is nowhere to put one", () => {
      const parsed = createPurchaseInvoiceSchema.parse({
        supplierInvoiceNo: "X/1",
        supplierId,
        companyId,
        totalAmount: "1.00",
        subtotal: "1.00",
        items: [{ itemId, unitId, quantity: "1", unitPrice: "10.00" }],
      } as Record<string, unknown>);

      expect(parsed).not.toHaveProperty("totalAmount");
      expect(parsed).not.toHaveProperty("subtotal");
    });
  });

  describe("the supplier's invoice number", () => {
    it("lets two suppliers use the same number", async () => {
      const first = await repo.create(input({ supplierInvoiceNo: "016" }), ACTOR);
      const second = await repo.create(
        input({ supplierInvoiceNo: "016", supplierId: otherSupplierId }),
        ACTOR,
      );

      expect(first.supplierInvoiceNo).toBe("016");
      expect(second.supplierInvoiceNo).toBe("016");
      expect(first.id).not.toBe(second.id);
    });

    it("lets ONE supplier reuse a number, because nothing says they cannot", async () => {
      await repo.create(input({ supplierInvoiceNo: "016" }), ACTOR);
      await expect(repo.create(input({ supplierInvoiceNo: "016" }), ACTOR)).resolves.toBeDefined();
    });

    /**
     * REGRESSION for the legacy list's blank row. Its partial tests
     * `SupplierInvoiceNo == ""`, which a NULL fails, so a null supplier number
     * falls to the else branch and renders an EMPTY link — a document nobody can
     * identify or open.
     */
    it("falls back to our own number when the supplier's is missing", async () => {
      const created = await repo.create(input(), ACTOR);
      await db
        .update(schema.purchaseInvoices)
        .set({ supplierInvoiceNo: null, invoiceNo: "INV/26-27/7" })
        .where(eqId(created.id));

      const [row] = (await repo.list(query({}), {})).rows;
      expect(row!.displayNo).toBe("INV/26-27/7");
    });

    it("treats an empty string and a NULL the same way", async () => {
      const created = await repo.create(input(), ACTOR);
      await db
        .update(schema.purchaseInvoices)
        .set({ supplierInvoiceNo: "   ", invoiceNo: null })
        .where(eqId(created.id));

      const [row] = (await repo.list(query({}), {})).rows;
      // Whitespace is not a number either. Never blank.
      expect(row!.displayNo).toBe("(no number)");
    });
  });

  describe("the derived discount percent", () => {
    it("reports the percent the rupee discount works out to", async () => {
      const created = await repo.create(
        input({
          items: [
            { itemId, unitId, quantity: "1", unitPrice: "200.00", discountPerUnit: "50.00" },
          ],
        }),
        ACTOR,
      );

      expect(created.items[0]!.discountPercent).toBe("25.00");
    });

    it("reports zero rather than dividing by a zero price", async () => {
      const created = await repo.create(
        input({ items: [{ itemId, unitId, quantity: "1", unitPrice: "0.00" }] }),
        ACTOR,
      );

      expect(created.items[0]!.discountPercent).toBe("0.00");
    });
  });

  describe("updating", () => {
    /**
     * THE ONE THAT MATTERS. A patch that touches only the TDS must still rewrite
     * the total — which means re-pricing lines the request never sent. Getting
     * this wrong reproduces the exact defect the screen is known for, on the
     * server, where nothing would catch it.
     */
    it("recomputes the total when ONLY the TDS changes", async () => {
      const created = await repo.create(input(), ACTOR);
      expect(created.totalAmount).toBe("3540.00");

      const updated = await repo.update(created.id, { tds: "40.00" }, ACTOR);

      expect(updated.tds).toBe("40.00");
      expect(updated.totalAmount).toBe("3500.00");
      // ...and the lines it never sent are still there.
      expect(updated.items).toHaveLength(1);
      expect(updated.subtotal).toBe("3000.00");
    });

    it("recomputes when only the adjustment changes", async () => {
      const created = await repo.create(input({ tds: "40.00" }), ACTOR);
      const updated = await repo.update(created.id, { roundOff: "-500.00" }, ACTOR);

      expect(updated.totalAmount).toBe("3000.00");
      expect(updated.tds).toBe("40.00");
    });

    it("keeps the charges when only the lines change", async () => {
      const created = await repo.create(input({ tds: "40.00", roundOff: "10.00" }), ACTOR);
      const updated = await repo.update(created.id, patch({ items: [{ itemId, unitId, quantity: "1", unitPrice: "1000.00", gstPercent: "18" }] }), ACTOR);

      expect(updated.tds).toBe("40.00");
      expect(updated.roundOff).toBe("10.00");
      // 1180 − 40 + 10.
      expect(updated.totalAmount).toBe("1150.00");
    });

    it("replaces the lines wholesale rather than merging them", async () => {
      const created = await repo.create(
        input({
          items: [
            { itemId, unitId, quantity: "1", unitPrice: "100.00" },
            { itemId, unitId, quantity: "1", unitPrice: "200.00" },
          ],
        }),
        ACTOR,
      );
      expect(created.items).toHaveLength(2);

      const updated = await repo.update(created.id, patch({ items: [{ itemId, unitId, quantity: "1", unitPrice: "50.00" }] }), ACTOR);

      expect(updated.items).toHaveLength(1);
      expect(updated.totalAmount).toBe("50.00");
    });

    it("refuses an id that is not there", async () => {
      await expect(
        repo.update("99999999-9999-9999-9999-999999999999", { tds: "1.00" }, ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("listing", () => {
    beforeEach(async () => {
      await repo.create(input({ supplierInvoiceNo: "BB/154" }), ACTOR);
      await repo.create(
        input({ supplierInvoiceNo: "GSTT/0821", companyId: otherCompanyId }),
        ACTOR,
      );
      await repo.create(
        input({ supplierInvoiceNo: "016", supplierId: otherSupplierId, invoiceType: "Credit Note" }),
        ACTOR,
      );
    });

    it("filters by company, which is how the legacy screen is used", async () => {
      const page = await repo.list(query({}), { companyId: otherCompanyId });
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]!.displayNo).toBe("GSTT/0821");
    });

    it("filters by invoice type, so returns can be separated from purchases", async () => {
      const page = await repo.list(query({}), { invoiceType: "Credit Note" });
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]!.displayNo).toBe("016");
    });

    it("searches the number and the supplier in one box", async () => {
      const byNumber = await repo.list(query({ search: "GSTT" }), {});
      expect(byNumber.rows).toHaveLength(1);

      const bySupplier = await repo.list(query({ search: "SHAH" }), {});
      expect(bySupplier.rows).toHaveLength(1);
      expect(bySupplier.rows[0]!.supplierName).toBe("SHAH ENTERPRISE");
    });

    it("counts the lines without fetching them", async () => {
      const page = await repo.list(query({}), {});
      expect(page.rows.every((row) => row.lineCount === 1)).toBe(true);
    });

    it("reports the total independently of the page", async () => {
      expect(await repo.total(undefined, {})).toBe(3);
      expect(await repo.total(undefined, { companyId: otherCompanyId })).toBe(1);
    });

    /**
     * An invoice with no site must still list. `SiteId` is nullable on the
     * source, and an INNER JOIN here would hide those rows completely — the same
     * way the source's own inner joins lose free-text lines.
     */
    it("lists an invoice that has no site", async () => {
      const created = await repo.create(input(), ACTOR);
      await db.update(schema.purchaseInvoices).set({ siteId: null }).where(eqId(created.id));

      const page = await repo.list(query({ limit: 50 }), {});
      const row = page.rows.find((r) => r.id === created.id);
      expect(row).toBeDefined();
      expect(row!.siteName).toBeNull();
    });

    it("pages with a cursor rather than an offset", async () => {
      const first = await repo.list(query({ limit: 2 }), {});
      expect(first.rows).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await repo.list(query({ limit: 2, cursor: first.nextCursor! }), {});
      const seen = new Set([...first.rows, ...second.rows].map((r) => r.id));
      expect(seen.size).toBe(3);
    });
  });

  describe("approval and deletion", () => {
    it("states the approval rather than toggling it", async () => {
      const created = await repo.create(input(), ACTOR);
      expect(created.isApproved).toBe(false);

      const approved = await repo.setApproval(created.id, true, ACTOR);
      expect(approved.isApproved).toBe(true);

      const again = await repo.setApproval(created.id, true, ACTOR);
      expect(again.isApproved).toBe(true);
    });

    it("skips rows already in the target state when approving in bulk", async () => {
      const a = await repo.create(input(), ACTOR);
      const b = await repo.create(input(), ACTOR);
      await repo.setApproval(a.id, true, ACTOR);

      const updated = await repo.setApprovalMany([a.id, b.id], true, ACTOR);
      expect(updated).toBe(1);
    });

    /**
     * A REAL delete, unlike purchase orders — `SupplierInvoice` has no
     * soft-delete column, so there is nothing to set. The lines go with it
     * through the cascade.
     */
    it("deletes the invoice and its lines", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id);

      await expect(repo.findById(created.id)).rejects.toBeInstanceOf(NotFoundException);

      const lines = await db
        .select({ id: schema.purchaseInvoiceItems.id })
        .from(schema.purchaseInvoiceItems);
      expect(lines).toHaveLength(0);
    });

    it("refuses to delete an id that is not there", async () => {
      await expect(repo.remove("99999999-9999-9999-9999-999999999999")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
