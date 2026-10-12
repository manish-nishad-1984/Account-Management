import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createPurchaseInvoiceSchema } from "@accountmanagement/contracts";
import { PurchaseInvoicesRepository } from "./purchase-invoices.repository";
import {
  PurchaseInvoiceLocationSheetService,
  PurchaseInvoiceSheetRejected,
} from "./purchase-invoice-location-sheet.service";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

async function sheet(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Invoices");
  rows.forEach((row) => ws.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const HEAD = ["Invoice no", "Supplier", "Site location", "Shipping address"];

describe("PurchaseInvoiceLocationSheetService (real PostgreSQL)", () => {
  let db: Database;
  let service: PurchaseInvoiceLocationSheetService;
  let blockA: string;
  let first: string;
  let second: string;

  const stored = async (id: string) =>
    (await db.select().from(schema.purchaseInvoices).where(eq(schema.purchaseInvoices.id, id)))[0]!;

  beforeEach(async () => {
    db = await freshDatabase();
    service = new PurchaseInvoiceLocationSheetService(db);
    const repo = new PurchaseInvoicesRepository(db);

    const [unit] = await db.insert(schema.units).values({ name: "Bag" }).returning();
    const [item] = await db.insert(schema.items).values({ name: "Cement", unitId: unit!.id, pricePerUnit: "395.00" }).returning();
    const [site] = await db.insert(schema.sites).values({ name: "Akwada", isActive: true }).returning();
    const [otherSite] = await db.insert(schema.sites).values({ name: "Other", isActive: true }).returning();
    const [a] = await db.insert(schema.siteLocations).values({ siteId: site!.id, name: "Block A" }).returning();
    await db.insert(schema.siteLocations).values({ siteId: otherSite!.id, name: "Block Z" });
    blockA = a!.id;
    const suppliers = await db
      .insert(schema.suppliers)
      .values([{ name: "SHAH ENTERPRISE", area: "x" }, { name: "AL BURHAN", area: "y" }])
      .returning();
    const [company] = await db.insert(schema.companies).values({ name: "DH PATEL", invoicePrefix: "DHP" }).returning();

    const make = (supplierId: string, no: string) =>
      repo.create(
        createPurchaseInvoiceSchema.parse({
          supplierInvoiceNo: no,
          supplierId,
          companyId: company!.id,
          siteId: site!.id,
          items: [{ itemId: item!.id, unitId: unit!.id, quantity: "1", unitPrice: "100.00", gstPercent: "18" }],
        }),
        ACTOR,
      );
    first = (await make(suppliers[0]!.id, "16")).id;
    second = (await make(suppliers[1]!.id, "16")).id;
  });

  it("sets the location and shipping address of the invoice that number AND supplier name", async () => {
    const result = await service.import(
      await sheet([HEAD, ["16", "shah  enterprise", "block a", "Plot 5, Akwada"]]),
      ACTOR,
    );

    expect(result).toMatchObject({ rowCount: 1, updated: 1, errors: [] });
    expect(await stored(first)).toMatchObject({ siteLocationId: blockA, shippingAddress: "Plot 5, Akwada" });
    // Same number, other supplier: untouched.
    expect(await stored(second)).toMatchObject({ siteLocationId: null, shippingAddress: null });
  });

  it("leaves a field alone when its cell is blank", async () => {
    await service.import(await sheet([HEAD, ["16", "SHAH ENTERPRISE", "Block A", "Plot 5"]]), ACTOR);
    await service.import(await sheet([HEAD, ["16", "SHAH ENTERPRISE", "", "Plot 9"]]), ACTOR);

    expect(await stored(first)).toMatchObject({ siteLocationId: blockA, shippingAddress: "Plot 9" });
  });

  it("saves nothing and lists every problem when any row is bad", async () => {
    const rejected = await service
      .import(
        await sheet([
          HEAD,
          ["16", "SHAH ENTERPRISE", "Block A", "Plot 5"],
          ["99", "SHAH ENTERPRISE", "Block A", ""],
          ["16", "AL BURHAN", "Block Z", ""],
        ]),
        ACTOR,
      )
      .catch((error) => error);

    expect(rejected).toBeInstanceOf(PurchaseInvoiceSheetRejected);
    const rows = (rejected as PurchaseInvoiceSheetRejected).result.errors.map((e) => e.row);
    expect(rows).toEqual([3, 4]); // a location of another site is refused too
    expect(await stored(first)).toMatchObject({ siteLocationId: null, shippingAddress: null });
  });

  it("refuses a file without the Invoice no and Supplier columns", async () => {
    const rejected = await service.import(await sheet([["Invoice no", "Site location"], ["16", "Block A"]]), ACTOR).catch((e) => e);
    expect(rejected).toBeInstanceOf(PurchaseInvoiceSheetRejected);
    expect((rejected as PurchaseInvoiceSheetRejected).result.errors[0]!.column).toBe("Supplier");
  });
});
