import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createItemSchema,
  createPurchaseInvoiceSchema,
  createSalesInvoiceSchema,
} from "@accountmanagement/contracts";
import { ItemsRepository } from "./items.repository";
import { ItemPriceHistoryRepository } from "./item-price-history.repository";
import { PurchaseInvoicesRepository } from "../purchase-invoices/purchase-invoices.repository";
import { SalesInvoicesRepository } from "../sales-invoices/sales-invoices.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

/**
 * Three client requests of 14 Sep 2026, against real PostgreSQL:
 *
 *   - the same item name is refused, and similar names are found while typing;
 *   - choosing an item on an invoice fills in its latest price;
 *   - every change to an item's master price is kept.
 */
describe("item names, latest prices and price history (real PostgreSQL)", () => {
  let db: Database;
  let items: ItemsRepository;
  let history: ItemPriceHistoryRepository;
  let purchases: PurchaseInvoicesRepository;
  let sales: SalesInvoicesRepository;

  let unitId: number;
  let otherUnitId: number;
  let supplierId: string;
  let companyId: string;

  const item = (overrides: Record<string, unknown> = {}) =>
    items.create(
      createItemSchema.parse({ name: "OPC 53 Grade Cement", unitId, pricePerUnit: "395.00", ...overrides }),
      ACTOR,
    );

  const purchase = (itemId: string, date: string, line: Record<string, unknown> = {}, header: Record<string, unknown> = {}) =>
    purchases.create(
      createPurchaseInvoiceSchema.parse({
        supplierInvoiceNo: `INV-${date}`,
        supplierId,
        companyId,
        documentDate: `${date}T00:00:00.000Z`,
        items: [{ itemId, unitId, quantity: "1", unitPrice: "400.00", ...line }],
        ...header,
      }),
      ACTOR,
    );

  beforeEach(async () => {
    db = await freshDatabase();
    items = new ItemsRepository(db);
    history = new ItemPriceHistoryRepository(db);
    purchases = new PurchaseInvoicesRepository(db);
    sales = new SalesInvoicesRepository(db);

    const made = await db
      .insert(schema.units)
      .values([{ name: "Bag" }, { name: "Tonne" }])
      .returning({ id: schema.units.id, name: schema.units.name });
    unitId = made.find((u) => u.name === "Bag")!.id;
    otherUnitId = made.find((u) => u.name === "Tonne")!.id;

    const [supplier] = await db
      .insert(schema.suppliers)
      .values({ name: "AL BURHAN PIPES" })
      .returning({ id: schema.suppliers.id });
    supplierId = supplier!.id;

    const [company] = await db
      .insert(schema.companies)
      .values({ name: "DH PATEL", invoicePrefix: "DHP" })
      .returning({ id: schema.companies.id });
    companyId = company!.id;
  });

  describe("the same name is refused", () => {
    it("refuses a name that differs only in case, and names the item already there", async () => {
      await item();
      await expect(item({ name: "opc 53 grade cement" })).rejects.toThrow(
        'An item named "OPC 53 Grade Cement" already exists',
      );
    });

    /** The case the unique index on lower(name) could not see. */
    it("refuses a name that differs only in spacing", async () => {
      await item();
      await expect(item({ name: "  OPC   53 Grade  Cement " })).rejects.toThrow(/already exists/);
    });

    it("stores the name with its spaces tidied", async () => {
      const created = await item({ name: "  OPC   53  Grade Cement " });
      expect(created.name).toBe("OPC 53 Grade Cement");
    });

    it("refuses renaming an item to another item's name", async () => {
      await item();
      const other = await item({ name: "PPC Cement" });
      await expect(items.update(other.id, { name: "OPC 53 GRADE CEMENT" }, ACTOR)).rejects.toThrow(
        /already exists/,
      );
    });

    it("lets an item keep its own name when saved", async () => {
      const created = await item();
      const saved = await items.update(created.id, { name: "OPC 53 Grade Cement", pricePerUnit: "400.00" }, ACTOR);
      expect(saved.pricePerUnit).toBe("400.00");
    });

    it("allows the name of an item that was deleted", async () => {
      const created = await item();
      await items.remove(created.id, ACTOR);
      await expect(item()).resolves.toMatchObject({ name: "OPC 53 Grade Cement" });
    });
  });

  describe("the name check while typing", () => {
    it("reports the exact match separately from similar names", async () => {
      await item();
      await item({ name: "OPC 43 Grade Cement" });
      await item({ name: "River Sand" });

      const check = await items.nameCheck("opc 53  grade cement", null);
      expect(check.exact?.name).toBe("OPC 53 Grade Cement");
      expect(check.similar.map((row) => row.name)).toEqual([]);

      const partial = await items.nameCheck("cement opc", null);
      expect(partial.exact).toBeNull();
      expect(partial.similar.map((row) => row.name)).toEqual(["OPC 43 Grade Cement", "OPC 53 Grade Cement"]);
    });

    it("does not match the item being edited against itself", async () => {
      const created = await item();
      const check = await items.nameCheck("OPC 53 Grade Cement", created.id);
      expect(check.exact).toBeNull();
      expect(check.similar).toEqual([]);
    });

    it("treats % and _ as the characters typed, not as wildcards", async () => {
      await item({ name: "Pipe 50% Off" });
      await item({ name: "Pipe 50 mm" });

      const check = await items.nameCheck("50%", null);
      expect(check.similar.map((row) => row.name)).toEqual(["Pipe 50% Off"]);
    });

    it("leaves deleted items out", async () => {
      const created = await item();
      await items.remove(created.id, ACTOR);
      const check = await items.nameCheck("OPC", null);
      expect(check.exact).toBeNull();
      expect(check.similar).toEqual([]);
    });
  });

  describe("the latest price for an invoice line", () => {
    it("falls back to the item master price when the item was never invoiced", async () => {
      const created = await item({ isWithGst: true, gstPercent: "28", gstAmount: "110.60" });
      const latest = await history.latest(created.id, "out");

      expect(latest).toMatchObject({
        source: "item-master",
        unitPrice: "395.00",
        unitId,
        gstPercent: "28.00",
        discountPerUnit: null,
        displayNo: null,
      });
    });

    it("uses the newest purchase invoice line, with that line's unit and GST", async () => {
      const created = await item();
      await purchase(created.id, "2026-01-01", { unitPrice: "380.00", gstPercent: "18" });
      await purchase(created.id, "2026-03-01", {
        unitPrice: "410.00",
        unitId: otherUnitId,
        gstPercent: "28",
        discountPerUnit: "10.00",
      });
      await purchase(created.id, "2026-02-01", { unitPrice: "390.00" });

      const latest = await history.latest(created.id, "out");
      expect(latest).toMatchObject({
        source: "purchase-invoice",
        unitPrice: "410.00",
        unitId: otherUnitId,
        gstPercent: "28.00",
        discountPerUnit: "10.00",
        displayNo: "INV-2026-03-01",
        partyName: "AL BURHAN PIPES",
      });
    });

    it("skips a purchase return, which is not a price paid", async () => {
      const created = await item();
      await purchase(created.id, "2026-01-01", { unitPrice: "380.00" });
      await purchase(created.id, "2026-02-01", { unitPrice: "999.00" }, { invoiceType: "Purchase Return" });

      expect((await history.latest(created.id, "out")).unitPrice).toBe("380.00");
    });

    it("reads sales invoices for a sale, not purchases", async () => {
      const created = await item();
      await purchase(created.id, "2026-01-01", { unitPrice: "380.00" });

      expect((await history.latest(created.id, "in")).source).toBe("item-master");

      await sales.create(
        createSalesInvoiceSchema.parse({
          customerId: supplierId,
          companyId,
          documentDate: "2026-02-01T00:00:00.000Z",
          items: [{ itemId: created.id, unitId, quantity: "2", unitPrice: "450.00", gstPercent: "18" }],
        }),
        ACTOR,
      );

      expect(await history.latest(created.id, "in")).toMatchObject({
        source: "sales-invoice",
        unitPrice: "450.00",
        gstPercent: "18.00",
      });
      expect((await history.latest(created.id, "out")).unitPrice).toBe("380.00");
    });

    it("refuses an item that does not exist", async () => {
      await expect(history.latest("00000000-0000-0000-0000-000000000000", "out")).rejects.toThrow(
        /not found/i,
      );
    });
  });

  describe("the item master's price history", () => {
    const changes = async (itemId: string) =>
      (await history.changes(itemId, 50)).rows.map((row) => [row.source, row.oldPrice, row.newPrice]);

    it("records the first price when an item is created", async () => {
      const created = await item();
      expect(await changes(created.id)).toEqual([["created", null, "395.00"]]);
    });

    it("records a price change with the price it replaced, newest first", async () => {
      const created = await item();
      await items.update(created.id, { pricePerUnit: "410.00" }, ACTOR);
      await items.update(created.id, { pricePerUnit: "425.50" }, ACTOR);

      expect(await changes(created.id)).toEqual([
        ["edited", "410.00", "425.50"],
        ["edited", "395.00", "410.00"],
        ["created", null, "395.00"],
      ]);
    });

    it("writes nothing when a save leaves the price and GST alone", async () => {
      const created = await item();
      await items.update(created.id, { name: "OPC 53 Grade Cement (Ultratech)", hsnCode: "2523" }, ACTOR);
      await items.update(created.id, { pricePerUnit: "395" }, ACTOR);

      expect(await changes(created.id)).toHaveLength(1);
    });

    it("records a change of GST rate on its own", async () => {
      const created = await item();
      await items.update(created.id, { isWithGst: true, gstPercent: "18", gstAmount: "71.10" }, ACTOR);

      const [latest] = (await history.changes(created.id, 50)).rows;
      expect(latest).toMatchObject({ source: "edited", oldGstPercent: null, newGstPercent: "18.00" });
    });

    it("names the person who made the change", async () => {
      await db.insert(schema.users).values({
        id: ACTOR,
        firstName: "Chintan",
        lastName: "Kalathiya",
        email: "c@example.com",
        phoneNo: "0000000000",
        userName: "ckalathiya",
        password: "x",
      });
      const created = await item();

      const [row] = (await history.changes(created.id, 50)).rows;
      expect(row!.changedByName).toBe("Chintan Kalathiya");
    });

    it("keeps the history once the item is deleted", async () => {
      const created = await item();
      await items.remove(created.id, ACTOR);

      const stored = await db
        .select()
        .from(schema.itemPriceChanges)
        .where(eq(schema.itemPriceChanges.itemId, created.id));
      expect(stored).toHaveLength(1);
    });
  });
});
