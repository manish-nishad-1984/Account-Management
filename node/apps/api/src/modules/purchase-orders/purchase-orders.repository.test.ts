import { beforeEach, describe, expect, it } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  createPurchaseOrderSchema,
  listQuerySchema,
  type CreatePurchaseOrder,
} from "@accountmanagement/contracts";
import { financialYear } from "@accountmanagement/domain";
import { PurchaseOrdersRepository } from "./purchase-orders.repository";
import { PurchaseRequestsRepository } from "../purchase-requests/purchase-requests.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

const FY = financialYear.format(financialYear.currentAsProduced(new Date()));

describe("PurchaseOrdersRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: PurchaseOrdersRepository;
  let siteId: string;
  let supplierId: string;
  let companyId: string;
  let otherCompanyId: string;
  let noPrefixCompanyId: string;
  let itemId: string;
  let unitId: number;

  const input = (overrides: Record<string, unknown> = {}): CreatePurchaseOrder =>
    createPurchaseOrderSchema.parse({
      siteId,
      supplierId,
      companyId,
      items: [{ itemId, unitId, quantity: "3", unitPrice: "1000.00", gstPercent: "18" }],
      ...overrides,
    });

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new PurchaseOrdersRepository(db);

    const [unit] = await db
      .insert(schema.units)
      .values({ name: "Bag" })
      .returning({ id: schema.units.id });
    unitId = unit!.id;

    const [item] = await db
      .insert(schema.items)
      .values({ name: "OPC 53 Grade Cement", unitId, pricePerUnit: "395.00", hsnCode: "25232910" })
      .returning({ id: schema.items.id });
    itemId = item!.id;

    const [site] = await db
      .insert(schema.sites)
      .values({ name: "Akwada Lake Front", isActive: true })
      .returning({ id: schema.sites.id });
    siteId = site!.id;

    const [supplier] = await db
      .insert(schema.suppliers)
      .values({ name: "ASIAN GRANITO INDIA LIMITED", area: "Navrangpura" })
      .returning({ id: schema.suppliers.id });
    supplierId = supplier!.id;

    const inserted = await db
      .insert(schema.companies)
      .values([
        { name: "DH PATEL", invoicePrefix: "DHP" },
        { name: "DEMO", invoicePrefix: "DEMO" },
        { name: "NO PREFIX LTD", invoicePrefix: null },
      ])
      .returning({ id: schema.companies.id, name: schema.companies.name });

    companyId = inserted.find((row) => row.name === "DH PATEL")!.id;
    otherCompanyId = inserted.find((row) => row.name === "DEMO")!.id;
    noPrefixCompanyId = inserted.find((row) => row.name === "NO PREFIX LTD")!.id;
  });

  describe("document numbering", () => {
    it("leads the number with the company's invoice prefix", async () => {
      const created = await repo.create(input(), ACTOR);
      expect(created.poNo).toBe(`DHP/PO/${FY}/001`);
    });

    it("counts per company, so two companies both reach 001", async () => {
      const first = await repo.create(input(), ACTOR);
      const second = await repo.create(input({ companyId: otherCompanyId }), ACTOR);

      expect(first.poNo).toBe(`DHP/PO/${FY}/001`);
      expect(second.poNo).toBe(`DEMO/PO/${FY}/001`);
    });

    it("increments within a company without disturbing the other", async () => {
      await repo.create(input(), ACTOR);
      await repo.create(input({ companyId: otherCompanyId }), ACTOR);
      const third = await repo.create(input(), ACTOR);

      expect(third.poNo).toBe(`DHP/PO/${FY}/002`);
    });

    /**
     * The source parses the previous number out of the string with a regex and
     * has no counter at all, so this is the shape of failure it cannot avoid:
     * two callers reading the same "last" row. Fifteen crosses the point where a
     * substring-based parser would wrap.
     */
    it("issues fifteen distinct, ordered numbers", async () => {
      const numbers: string[] = [];
      for (let i = 0; i < 15; i += 1) {
        numbers.push((await repo.create(input(), ACTOR)).poNo);
      }

      expect(new Set(numbers).size).toBe(15);
      expect(numbers.at(-1)).toBe(`DHP/PO/${FY}/015`);
      expect([...numbers].sort()).toEqual(numbers);
    });

    /**
     * A company with no invoice prefix cannot be numbered.
     *
     * `CheckPONo` reads `CompanyDetails.InvoicePef.Trim()` with no null check —
     * a NullReferenceException for exactly this row — and the catch around it
     * returns the string "Error generating Purchase Order number." AS THE NUMBER.
     */
    it("refuses an order for a company with no invoice prefix, by name", async () => {
      await expect(repo.create(input({ companyId: noPrefixCompanyId }), ACTOR)).rejects.toThrow(
        BadRequestException,
      );
      await expect(repo.create(input({ companyId: noPrefixCompanyId }), ACTOR)).rejects.toThrow(
        /NO PREFIX LTD has no invoice prefix/,
      );
    });

    it("burns no number when the insert fails", async () => {
      // A line naming a unit that does not exist violates the FK, so the whole
      // transaction rolls back — including the counter increment.
      await expect(
        repo.create(input({ items: [{ itemId, unitId: 99999, quantity: "1", unitPrice: "1" }] }), ACTOR),
      ).rejects.toThrow();

      const after = await repo.create(input(), ACTOR);
      expect(after.poNo).toBe(`DHP/PO/${FY}/001`);
    });

    /**
     * The purchase request sequence must be untouched by the company dimension.
     * Both counters live in one table now, and PR rows carry a NULL company —
     * which is why the uniqueness is two partial indexes rather than one.
     */
    it("does not disturb the global purchase request sequence", async () => {
      const requests = new PurchaseRequestsRepository(db);

      await repo.create(input(), ACTOR);
      const request = await requests.create(
        { siteId, itemId, itemName: null, itemDescription: null, unitId, quantity: "5.00", documentDate: null, siteAddressId: null, siteAddress: null },
        ACTOR,
      );
      const second = await requests.create(
        { siteId, itemId, itemName: null, itemDescription: null, unitId, quantity: "5.00", documentDate: null, siteAddressId: null, siteAddress: null },
        ACTOR,
      );

      expect(request.prNo).toBe(`PR/${FY}/001`);
      expect(second.prNo).toBe(`PR/${FY}/002`);
    });
  });

  describe("totals are computed on the server", () => {
    it("prices the lines and rolls them up", async () => {
      const created = await repo.create(
        input({
          items: [
            { itemId, unitId, quantity: "3", unitPrice: "1000.00", gstPercent: "18" },
            { itemId, unitId, quantity: "1", unitPrice: "27.00", gstPercent: "18" },
          ],
        }),
        ACTOR,
      );

      expect(created.subtotal).toBe("3027.00");
      expect(created.totalGstAmount).toBe("544.86");
      expect(created.totalAmount).toBe("3571.86");
    });

    it("derives each line's GST and total", async () => {
      const created = await repo.create(input(), ACTOR);

      expect(created.items).toHaveLength(1);
      expect(created.items[0]).toMatchObject({
        quantity: "3.00",
        unitPrice: "1000.00",
        gstAmount: "540.00",
        lineTotal: "3540.00",
        lineNumber: 1,
      });
    });

    /**
     * The client cannot set a total. The source stores whatever the browser
     * posted, so a crafted request books an order at any value it likes.
     */
    it("ignores totals sent in the body", async () => {
      const created = await repo.create(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { ...(input() as any), totalAmount: "1.00", subtotal: "1.00", totalGstAmount: "1.00" },
        ACTOR,
      );

      expect(created.totalAmount).toBe("3540.00");
    });

    it("keeps the discount column out of the arithmetic", async () => {
      // The create screen has no discount field at all; the column exists only so
      // the ETL is lossless. Applying it would change what historical orders are
      // worth.
      const created = await repo.create(
        input({
          items: [
            { itemId, unitId, quantity: "3", unitPrice: "1000.00", gstPercent: "18", discount: "500.00" },
          ],
        }),
        ACTOR,
      );

      expect(created.totalAmount).toBe("3540.00");
    });

    it("recomputes the totals when the lines are replaced", async () => {
      const created = await repo.create(input(), ACTOR);

      const updated = await repo.update(
        created.id,
        { items: [{ itemId, unitId, quantity: "1", unitPrice: "100.00", gstPercent: "5" }] },
        ACTOR,
      );

      expect(updated.items).toHaveLength(1);
      expect(updated.subtotal).toBe("100.00");
      expect(updated.totalAmount).toBe("105.00");
    });

    it("leaves the lines and totals alone when the update does not mention them", async () => {
      const created = await repo.create(input(), ACTOR);
      const updated = await repo.update(created.id, { buyersPurchaseNo: "PO-9912" }, ACTOR);

      expect(updated.buyersPurchaseNo).toBe("PO-9912");
      expect(updated.items).toHaveLength(1);
      expect(updated.totalAmount).toBe("3540.00");
    });
  });

  describe("lines", () => {
    it("labels a free-text line by its own text, with no catalogue row", async () => {
      const created = await repo.create(
        input({
          items: [{ itemName: "Scaffolding hire", unitId, quantity: "2", unitPrice: "50.00" }],
        }),
        ACTOR,
      );

      expect(created.items[0]).toMatchObject({
        itemId: null,
        itemLabel: "Scaffolding hire",
        hsnCode: null,
      });
    });

    it("carries the catalogue item's HSN code onto the line", async () => {
      const created = await repo.create(input(), ACTOR);
      expect(created.items[0]!.hsnCode).toBe("25232910");
    });

    it("numbers the lines in the order they were sent", async () => {
      const created = await repo.create(
        input({
          items: [
            { itemName: "First", unitId, quantity: "1", unitPrice: "1.00" },
            { itemName: "Second", unitId, quantity: "1", unitPrice: "2.00" },
            { itemName: "Third", unitId, quantity: "1", unitPrice: "3.00" },
          ],
        }),
        ACTOR,
      );

      expect(created.items.map((line) => [line.lineNumber, line.itemLabel])).toEqual([
        [1, "First"],
        [2, "Second"],
        [3, "Third"],
      ]);
    });

    it("refuses an order with no lines", () => {
      expect(() => input({ items: [] })).toThrow(/Add at least one product/);
    });
  });

  describe("list", () => {
    it("joins the site, supplier and company names", async () => {
      await repo.create(input(), ACTOR);
      const { rows } = await repo.list(query());

      expect(rows[0]).toMatchObject({
        siteName: "Akwada Lake Front",
        supplierName: "ASIAN GRANITO INDIA LIMITED",
        companyName: "DH PATEL",
        lineCount: 1,
      });
    });

    it("counts the lines without fetching them", async () => {
      await repo.create(
        input({
          items: [
            { itemName: "a", unitId, quantity: "1", unitPrice: "1.00" },
            { itemName: "b", unitId, quantity: "1", unitPrice: "1.00" },
          ],
        }),
        ACTOR,
      );

      const { rows } = await repo.list(query());
      expect(rows[0]!.lineCount).toBe(2);
    });

    it("filters by active, which the legacy list defaults to", async () => {
      const active = await repo.create(input(), ACTOR);
      const inactive = await repo.create(input(), ACTOR);
      await db
        .update(schema.purchaseOrders)
        .set({ isActive: false })
        .where(eq(schema.purchaseOrders.id, inactive.id));

      const { rows } = await repo.list(query(), { isActive: true });
      expect(rows.map((row) => row.id)).toEqual([active.id]);
    });

    it("returns everything when isActive is not given", async () => {
      await repo.create(input(), ACTOR);
      const second = await repo.create(input(), ACTOR);
      await db
        .update(schema.purchaseOrders)
        .set({ isActive: false })
        .where(eq(schema.purchaseOrders.id, second.id));

      expect((await repo.list(query())).rows).toHaveLength(2);
    });

    it("searches the number, the buyer's number and the supplier", async () => {
      await repo.create(input({ buyersPurchaseNo: "ACME-77" }), ACTOR);
      await repo.create(input(), ACTOR);

      expect((await repo.list(query({ search: "ACME-77" }))).rows).toHaveLength(1);
      expect((await repo.list(query({ search: "ASIAN" }))).rows).toHaveLength(2);
      expect((await repo.list(query({ search: `DHP/PO/${FY}/002` }))).rows).toHaveLength(1);
    });

    it("hides soft-deleted orders", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      expect((await repo.list(query())).rows).toHaveLength(0);
      expect(await repo.total()).toBe(0);
    });

    /** §5i: paging by a timestamp cursor threw before `keysetWhere` cast it. */
    it("pages past the first page when sorted by createdAt", async () => {
      for (let i = 0; i < 5; i += 1) {
        await repo.create(input(), ACTOR);
      }

      const first = await repo.list(query({ sortBy: "createdAt", limit: 2 }));
      expect(first.nextCursor).not.toBeNull();

      const second = await repo.list(
        query({ sortBy: "createdAt", limit: 2, cursor: first.nextCursor! }),
      );
      expect(second.rows).toHaveLength(2);
      expect(second.rows.map((row) => row.id)).not.toEqual(first.rows.map((row) => row.id));
    });
  });

  describe("approval", () => {
    it("states the approval rather than toggling it", async () => {
      const created = await repo.create(input(), ACTOR);
      expect(created.isApproved).toBe(false);

      const approved = await repo.setApproval(created.id, true, ACTOR);
      expect(approved.isApproved).toBe(true);

      const again = await repo.setApproval(created.id, true, ACTOR);
      expect(again.isApproved).toBe(true);
    });

    it("counts only the rows a bulk approval actually changed", async () => {
      const first = await repo.create(input(), ACTOR);
      const second = await repo.create(input(), ACTOR);
      await repo.setApproval(first.id, true, ACTOR);

      expect(await repo.setApprovalMany([first.id, second.id], true, ACTOR)).toBe(1);
      expect(await repo.setApprovalMany([first.id, second.id], true, ACTOR)).toBe(0);
    });

    it("is a no-op for an empty selection", async () => {
      expect(await repo.setApprovalMany([], true, ACTOR)).toBe(0);
    });
  });

  describe("delete", () => {
    it("soft-deletes, keeping the lines for reconstruction", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      const lines = await db
        .select()
        .from(schema.purchaseOrderItems)
        .where(eq(schema.purchaseOrderItems.purchaseOrderId, created.id));

      expect(lines).toHaveLength(1);
    });

    it("404s on a second delete", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      await expect(repo.remove(created.id, ACTOR)).rejects.toThrow(NotFoundException);
    });

    it("404s reading a deleted order", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id, ACTOR);

      await expect(repo.findById(created.id)).rejects.toThrow(NotFoundException);
    });
  });

  describe("delivery schedule", () => {
    /**
     * One legacy string column held either a date or the word "Immediate". Split
     * into a nullable date plus a boolean, so "nobody said" stays distinguishable
     * from "immediate" — the source cannot express that difference at all.
     */
    it("records immediate delivery with no date", async () => {
      const created = await repo.create(input({ deliveryImmediate: true }), ACTOR);

      expect(created.deliveryImmediate).toBe(true);
      expect(created.deliveryDate).toBeNull();
    });

    it("records a scheduled date with the flag off", async () => {
      const created = await repo.create(
        input({ deliveryDate: "2026-10-01T00:00:00.000Z" }),
        ACTOR,
      );

      expect(created.deliveryImmediate).toBe(false);
      expect(created.deliveryDate).not.toBeNull();
    });

    it("leaves both empty when nobody said", async () => {
      const created = await repo.create(input(), ACTOR);

      expect(created.deliveryImmediate).toBe(false);
      expect(created.deliveryDate).toBeNull();
    });
  });
});
