import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { PURCHASE_INVOICE_IMPORT_COLUMNS } from "@accountmanagement/contracts";
import { PurchaseInvoicesRepository } from "./purchase-invoices.repository";
import { PurchaseInvoiceImportRejected, PurchaseInvoiceImportService } from "./purchase-invoice-import.service";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";
const HEADERS = PURCHASE_INVOICE_IMPORT_COLUMNS.map((c) => c.header);

/** A row by heading name; anything not given is blank. */
const row = (cells: Record<string, string>) => HEADERS.map((h) => cells[h] ?? "");

async function sheet(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Invoices");
  ws.addRow(HEADERS);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const BASE = {
  Date: "05-10-2026",
  Supplier: "SHAH ENTERPRISE",
  Company: "DH PATEL",
  Site: "Akwada",
  Item: "Cement",
};

describe("PurchaseInvoiceImportService (real PostgreSQL)", () => {
  let db: Database;
  let service: PurchaseInvoiceImportService;

  const count = async () => (await db.select().from(schema.purchaseInvoices)).length;

  beforeEach(async () => {
    db = await freshDatabase();
    service = new PurchaseInvoiceImportService(db, new PurchaseInvoicesRepository(db));
    const [unit] = await db.insert(schema.units).values({ name: "Bag" }).returning();
    await db.insert(schema.items).values({ name: "Cement", unitId: unit!.id, pricePerUnit: "395.00" });
    const [site] = await db.insert(schema.sites).values({ name: "Akwada", isActive: true }).returning();
    await db.insert(schema.siteLocations).values([
      { siteId: site!.id, name: "Block A" },
      { siteId: site!.id, name: "Store yard", address: "Survey 12, Akwada Road, Bhavnagar" },
    ]);
    await db.insert(schema.suppliers).values([{ name: "SHAH ENTERPRISE", area: "x" }, { name: "AL BURHAN", area: "y" }]);
    await db.insert(schema.companies).values({ name: "DH PATEL", invoicePrefix: "DHP" });
  });

  it("prices each invoice with the form's rules: per-line rounding, then whole rupees with .50 going DOWN", async () => {
    const preview = await service.preview(
      await sheet([
        // 3 x 1000 + 18% = 3540.00 exactly.
        row({ ...BASE, "Invoice no": "A1", Quantity: "3", Rate: "1000", "GST %": "18" }),
        // 100.50 + 0% = exactly .50: rounds down to 100.
        row({ ...BASE, "Invoice no": "A2", Quantity: "1", Rate: "100.50" }),
        // 100.51: above .50 rounds up to 101.
        row({ ...BASE, "Invoice no": "A3", Quantity: "1", Rate: "100.51" }),
        // 100.25 + 18% = 18.045 -> 18.05 per line, 118.30 -> 118.
        row({ ...BASE, "Invoice no": "A4", Quantity: "1", Rate: "100.25", "GST %": "18" }),
      ]),
    );

    expect(preview.errors).toEqual([]);
    const by = Object.fromEntries(preview.invoices.map((i) => [i.invoiceNo, i]));
    expect(by.A1).toMatchObject({ total: "3540.00", roundOff: "0.00" });
    expect(by.A2).toMatchObject({ total: "100.00", roundOff: "-0.50" });
    expect(by.A3).toMatchObject({ total: "101.00", roundOff: "0.49" });
    expect(by.A4).toMatchObject({ subtotal: "100.25", totalGst: "18.05", total: "118.00" });
    expect(preview.totals.total).toBe("3859.00");
    expect(preview.invoiceCount).toBe(4);
    expect(await count()).toBe(0); // a preview saves nothing
  });

  it("takes a Discount % as a percent of the Rate, in rupees per unit rounded to paise", async () => {
    const preview = await service.preview(
      await sheet([
        // 2% of 5200 = 104.00 per unit; 2 x 5096 = 10192 + 5% GST 509.60 = 10701.60 -> 10702
        row({ ...BASE, "Invoice no": "P1", Quantity: "2", Rate: "5200", "Discount %": "2", "GST %": "5" }),
        // 2.5% of 395 = 9.875 per unit -> 9.88 (half up): net 385.12, as typing 9.88 on the form gives
        row({ ...BASE, "Invoice no": "P2", Quantity: "1", Rate: "395", "Discount %": "2.5" }),
        // 100% leaves nothing; "5 %" is read as 5
        row({ ...BASE, "Invoice no": "P3", Quantity: "1", Rate: "250", "Discount %": "100" }),
        row({ ...BASE, "Invoice no": "P4", Quantity: "1", Rate: "200", "Discount %": "5 %" }),
      ]),
    );

    expect(preview.errors).toEqual([]);
    const by = Object.fromEntries(preview.invoices.map((i) => [i.invoiceNo, i]));
    expect(by.P1).toMatchObject({ subtotal: "10192.00", totalGst: "509.60", total: "10702.00" });
    expect(by.P2).toMatchObject({ subtotal: "385.12", total: "385.00" });
    expect(by.P3).toMatchObject({ subtotal: "0.00", total: "0.00" });
    expect(by.P4).toMatchObject({ subtotal: "190.00", total: "190.00" });
  });

  it("refuses Discount % together with Discount per unit, and a percentage that is not one", async () => {
    const preview = await service.preview(
      await sheet([
        row({ ...BASE, "Invoice no": "Q1", Quantity: "1", Rate: "100", "Discount per unit": "5", "Discount %": "5" }),
        row({ ...BASE, "Invoice no": "Q2", Quantity: "1", Rate: "100", "Discount %": "101" }),
        row({ ...BASE, "Invoice no": "Q3", Quantity: "1", Rate: "100", "Discount %": "abc" }),
        row({ ...BASE, "Invoice no": "Q4", Quantity: "1", Rate: "100", "Discount %": "1.234" }),
      ]),
    );
    expect(preview.errors.map((e) => `${e.row}:${e.column}`)).toEqual(["2:Discount %", "3:Discount %", "4:Discount %", "5:Discount %"]);
    expect(preview.errors[0]!.message).toContain("not both");
  });

  it("accepts the heading written as Discount in Percentage", async () => {
    const heads = HEADERS.map((h) => (h === "Discount %" ? "Discount in Percentage" : h));
    const given: Record<string, string> = { ...BASE, "Invoice no": "R1", Quantity: "1", Rate: "1000", "Discount in Percentage": "10" };
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Invoices");
    ws.addRow(heads);
    ws.addRow(heads.map((h) => given[h] ?? ""));
    const preview = await service.preview(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(preview.errors).toEqual([]);
    expect(preview.invoices[0]).toMatchObject({ subtotal: "900.00", total: "900.00" });
  });

  it("groups rows of one invoice, applies TDS and Adjustment once, and imports exactly what was previewed", async () => {
    const file = await sheet([
      row({ ...BASE, "Invoice no": "B1", Quantity: "2", Rate: "500", "GST %": "18", TDS: "100", Adjustment: "-5", "Site location": "block a", "Location Address": "Plot 5", Type: "Purchase" }),
      row({ ...BASE, "Invoice no": "B1", Quantity: "1", Rate: "250", "Discount per unit": "50", "GST %": "18", TDS: "100" }),
    ]);
    const preview = await service.preview(file);

    // lines: 1000 + 180 = 1180 ; (250-50) = 200 + 36 = 236 ; sub 1200, gst 216, tds 100, adj -5 -> 1311
    expect(preview.errors).toEqual([]);
    expect(preview.invoices[0]).toMatchObject({ lineCount: 2, subtotal: "1200.00", totalGst: "216.00", tds: "100.00", adjustment: "-5.00", total: "1311.00" });

    const done = await service.import(file, ACTOR, true, { count: preview.invoiceCount, total: preview.totals.total });
    expect(done).toEqual({ created: 1, total: "1311.00" });

    const [saved] = await db.select().from(schema.purchaseInvoices);
    expect(saved).toMatchObject({ supplierInvoiceNo: "B1", totalAmount: "1311.00", tds: "100.00", roundOff: "-5.00", shippingAddress: "Plot 5", isApproved: true });
    expect(saved!.siteLocationId).not.toBeNull();
    expect((await db.select().from(schema.purchaseInvoiceItems)).length).toBe(2);
  });

  /** Client, 22 Oct 2026: a blank Location Address takes the location's own address. */
  it("fills a blank Location Address from the location, and keeps one that was typed", async () => {
    const file = await sheet([
      row({ ...BASE, "Invoice no": "L1", Quantity: "1", Rate: "100", "Site location": "store yard" }),
      row({ ...BASE, "Invoice no": "L2", Quantity: "1", Rate: "100", "Site location": "Store yard", "Location Address": "Gate 2" }),
      row({ ...BASE, "Invoice no": "L3", Quantity: "1", Rate: "100", "Site location": "Block A" }),
    ]);
    const preview = await service.preview(file);
    expect(preview.errors).toEqual([]);
    await service.import(file, ACTOR, true, { count: preview.invoiceCount, total: preview.totals.total });

    const saved = await db.select().from(schema.purchaseInvoices);
    const address = (no: string) => saved.find((one) => one.supplierInvoiceNo === no)!.shippingAddress;
    expect(address("L1")).toBe("Survey 12, Akwada Road, Bhavnagar");
    expect(address("L2")).toBe("Gate 2");
    // A location with no address of its own leaves it blank.
    expect(address("L3") ?? "").toBe("");
  });

  it("refuses an invoice total that disagrees with the lines, and saves nothing", async () => {
    const file = await sheet([row({ ...BASE, "Invoice no": "C1", Quantity: "1", Rate: "1000", "GST %": "18", "Invoice total": "1181" })]);
    const preview = await service.preview(file);
    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0]).toMatchObject({ row: 2, column: "Invoice total" });
    expect(preview.errors[0]!.message).toContain("1180.00");

    await expect(service.import(file, ACTOR, true, { count: 1, total: "1180.00" })).rejects.toBeInstanceOf(PurchaseInvoiceImportRejected);
    expect(await count()).toBe(0);

    const ok = await service.preview(await sheet([row({ ...BASE, "Invoice no": "C1", Quantity: "1", Rate: "1000", "GST %": "18", "Invoice total": "1,180.00" })]));
    expect(ok.errors).toEqual([]);
  });

  it("will not import a file whose totals are not the ones that were verified", async () => {
    const file = await sheet([row({ ...BASE, "Invoice no": "D1", Quantity: "1", Rate: "1000" })]);
    await expect(service.import(file, ACTOR, true, { count: 1, total: "999.00" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.import(file, ACTOR, true, { count: 2, total: "1000.00" })).rejects.toBeInstanceOf(BadRequestException);
    expect(await count()).toBe(0);
  });

  it("refuses an invoice that is already saved, so importing a file twice cannot double it", async () => {
    const file = await sheet([row({ ...BASE, "Invoice no": "E1", Quantity: "1", Rate: "1000" })]);
    await service.import(file, ACTOR, true, { count: 1, total: "1000.00" });

    const again = await service.preview(file);
    expect(again.errors[0]).toMatchObject({ row: 2, column: "Invoice no" });
    expect(again.errors[0]!.message).toContain("is already entered in");
    expect(await count()).toBe(1);
  });

  // 19 Oct 2026: the same rule as the form - per supplier and financial year, whatever the company.
  it("refuses a bill already entered for another company in the same year, and takes it in another year", async () => {
    await db.insert(schema.companies).values({ name: "DEMO", invoicePrefix: "DEMO" });
    await service.import(await sheet([row({ ...BASE, "Invoice no": "E7", Quantity: "1", Rate: "1000" })]), ACTOR, true, { count: 1, total: "1000.00" });

    const sameYear = await service.preview(await sheet([row({ ...BASE, "Invoice no": "e7", Company: "DEMO", Quantity: "1", Rate: "1000" })]));
    expect(sameYear.errors.some((e) => e.message.includes('Bill "e7"') && e.message.includes("already entered"))).toBe(true);

    const nextYear = await service.preview(await sheet([row({ ...BASE, "Invoice no": "E7", Date: "05-05-2099", Quantity: "1", Rate: "1000" })]));
    expect(nextYear.errors.filter((e) => e.message.includes("already entered"))).toEqual([]);
  });

  it("reports every problem with its row: unknown names, bad dates, contradictions, too many decimals", async () => {
    const preview = await service.preview(
      await sheet([
        row({ ...BASE, "Invoice no": "F1", Quantity: "1", Rate: "10", Supplier: "NOBODY LTD" }),
        row({ ...BASE, "Invoice no": "F2", Quantity: "1", Rate: "10", Date: "31-02-2026" }),
        row({ ...BASE, "Invoice no": "F3", Quantity: "1", Rate: "10", Item: "Gold bars" }),
        row({ ...BASE, "Invoice no": "F4", Quantity: "1", Rate: "10.1234" }),
        row({ ...BASE, "Invoice no": "F5", Quantity: "1", Rate: "10", Site: "Akwada" }),
        row({ ...BASE, "Invoice no": "F5", Quantity: "1", Rate: "10", Site: "Other site" }),
        row({ ...BASE, "Invoice no": "F6", Quantity: "1", Rate: "10", "Site location": "Block Z" }),
      ]),
    );

    const where = preview.errors.map((e) => `${e.row}:${e.column}`);
    expect(where).toEqual(expect.arrayContaining(["2:Supplier", "3:Date", "4:Item", "5:Rate", "7:Site", "8:Site location"]));
    expect(preview.invoices).toEqual([]);
  });

  it("refuses a file without the required columns", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("x").addRow(["Invoice no", "Supplier"]);
    const preview = await service.preview(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(preview.errors.map((e) => e.column)).toEqual(expect.arrayContaining(["Date", "Company", "Site", "Item", "Quantity", "Rate"]));
  });
});
