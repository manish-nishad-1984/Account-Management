import { beforeEach, describe, expect, it } from "vitest";
import { createPurchaseInvoiceSchema } from "@accountmanagement/contracts";
import { GstReportService, splitGst } from "./gst-report.service";
import { PurchaseInvoicesRepository } from "../purchase-invoices/purchase-invoices.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

/** Input GST for the month's return, to match GSTR-2B (client, 22 Oct 2026). */
describe("GstReportService (real PostgreSQL)", () => {
  let db: Database;
  let service: GstReportService;
  let invoices: PurchaseInvoicesRepository;
  let patel: string;
  let infra: string;
  let local: string;
  let mumbai: string;
  let noGstin: string;
  let siteId: string;
  let itemId: string;
  let unitId: number;
  let serial = 0;

  const bill = (
    supplierId: string,
    lines: { price: string; gst: string; qty?: string }[],
    extra: Record<string, unknown> = {},
  ) =>
    invoices.create(
      createPurchaseInvoiceSchema.parse({
        supplierInvoiceNo: `B-${++serial}`,
        supplierId,
        companyId: patel,
        siteId,
        documentDate: "2026-09-10T00:00:00.000Z",
        items: lines.map((line) => ({ itemId, unitId, quantity: line.qty ?? "1", unitPrice: line.price, gstPercent: line.gst })),
        ...extra,
      }),
      ACTOR,
    );

  beforeEach(async () => {
    db = await freshDatabase();
    invoices = new PurchaseInvoicesRepository(db);
    service = new GstReportService(db);
    serial = 0;

    const [unit] = await db.insert(schema.units).values({ name: "Bag" }).returning({ id: schema.units.id });
    unitId = unit!.id;
    const [item] = await db.insert(schema.items).values({ name: "Cement", unitId, pricePerUnit: "100.00" }).returning({ id: schema.items.id });
    itemId = item!.id;
    const [site] = await db.insert(schema.sites).values({ name: "Akwada", isActive: true }).returning({ id: schema.sites.id });
    siteId = site!.id;

    const companies = await db
      .insert(schema.companies)
      .values([
        { name: "DH PATEL", gstNo: "24AABFD8160H1ZN" },
        { name: "DH PATEL INFRA", gstNo: null },
      ])
      .returning({ id: schema.companies.id, name: schema.companies.name });
    patel = companies.find((c) => c.name === "DH PATEL")!.id;
    infra = companies.find((c) => c.name === "DH PATEL INFRA")!.id;

    const suppliers = await db
      .insert(schema.suppliers)
      .values([
        { name: "SHAH ENTERPRISE", gstNo: "24AAAPS1234A1Z5" },
        { name: "MUMBAI STEELS", gstNo: "27aaacm9999b1z2" },
        { name: "LOCAL HARDWARE", gstNo: null },
      ])
      .returning({ id: schema.suppliers.id, name: schema.suppliers.name });
    local = suppliers.find((s) => s.name === "SHAH ENTERPRISE")!.id;
    mumbai = suppliers.find((s) => s.name === "MUMBAI STEELS")!.id;
    noGstin = suppliers.find((s) => s.name === "LOCAL HARDWARE")!.id;
  });

  it("splits a Gujarat supplier's GST into CGST and SGST, and another state's into IGST", async () => {
    await bill(local, [{ price: "1000.00", gst: "18" }]);
    await bill(mumbai, [{ price: "2000.00", gst: "18" }]);

    const report = await service.report({});
    const [shah, steels] = [report.suppliers.find((s) => s.supplierId === local)!, report.suppliers.find((s) => s.supplierId === mumbai)!];
    expect(shah).toMatchObject({ taxable: "1000.00", cgst: "90.00", sgst: "90.00", igst: "0.00", totalGst: "180.00", billCount: 1 });
    expect(steels).toMatchObject({ supplierGstin: "27AAACM9999B1Z2", taxable: "2000.00", cgst: "0.00", sgst: "0.00", igst: "360.00" });
    expect(report.totals).toEqual({ billCount: 2, taxable: "3000.00", cgst: "90.00", sgst: "90.00", igst: "360.00", totalGst: "540.00" });
  });

  it("lists a bill once per GST rate, and totals each rate", async () => {
    await bill(local, [
      { price: "1000.00", gst: "18" },
      { price: "500.00", gst: "5" },
      { price: "300.00", gst: "18" },
    ]);

    const report = await service.report({});
    expect(report.bills.map((row) => [row.gstPercent, row.taxable, row.totalGst])).toEqual([
      ["5.00", "500.00", "25.00"],
      ["18.00", "1300.00", "234.00"],
    ]);
    expect(report.rates.map((row) => [row.gstPercent, row.taxable])).toEqual([
      ["5.00", "500.00"],
      ["18.00", "1300.00"],
    ]);
    expect(report.totals.billCount).toBe(1);
  });

  it("takes a credit note off, and counts only the bills dated in the range and of the company asked for", async () => {
    await bill(local, [{ price: "1000.00", gst: "18" }]);
    await bill(local, [{ price: "200.00", gst: "18" }], { invoiceType: "Credit Note" });
    await bill(local, [{ price: "999.00", gst: "18" }], { documentDate: "2026-10-01T00:00:00.000Z" });
    await bill(local, [{ price: "777.00", gst: "18" }], { companyId: infra });

    const september = await service.report({ companyId: patel, fromDate: "2026-09-01", toDate: "2026-09-30" });
    expect(september.totals).toMatchObject({ billCount: 2, taxable: "800.00", cgst: "72.00", sgst: "72.00", totalGst: "144.00" });
    expect(september.bills.find((row) => row.invoiceType === "Credit Note")).toMatchObject({ taxable: "-200.00", cgst: "-18.00" });
  });

  it("names the suppliers and companies whose GSTIN cannot place a bill", async () => {
    await bill(noGstin, [{ price: "100.00", gst: "18" }]);
    await db.update(schema.suppliers).set({ gstNo: "24ABC" });
    await bill(local, [{ price: "100.00", gst: "18" }], { companyId: infra });

    const report = await service.report({});
    expect(report.warnings.map((w) => [w.problem, w.name, w.billCount]).sort()).toEqual([
      ["company-gstin-missing", "DH PATEL INFRA", 1],
      ["supplier-gstin-invalid", "LOCAL HARDWARE", 1],
      ["supplier-gstin-invalid", "SHAH ENTERPRISE", 1],
    ]);
    // Not placed, so counted within the state.
    expect(report.totals.igst).toBe("0.00");
  });

  it("splits an odd paisa so the two halves still add up to the bill's GST", () => {
    expect(splitGst(3763n, false)).toEqual({ cgst: 1882n, sgst: 1881n, igst: 0n });
    expect(splitGst(-3763n, false)).toEqual({ cgst: -1882n, sgst: -1881n, igst: 0n });
    expect(splitGst(3763n, true)).toEqual({ cgst: 0n, sgst: 0n, igst: 3763n });
  });
});
