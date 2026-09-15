import "reflect-metadata";
import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import {
  createPurchaseInvoiceSchema,
  createSalesInvoiceSchema,
  permission,
  printDocumentSchema,
} from "@accountmanagement/contracts";
import { eq } from "drizzle-orm";
import { PrintDocumentsRepository } from "./print-documents.repository";
import { DocumentPrintController, DocumentTemplatesController } from "./document-templates.controller";
import { SalesInvoicesRepository } from "../sales-invoices/sales-invoices.repository";
import { PurchaseInvoicesRepository } from "../purchase-invoices/purchase-invoices.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

/**
 * WHAT AN INVOICE PRINTS WITH. The invoice is read through the invoice modules'
 * own `findById`; these tests are about what is added to it — addresses, state
 * codes, HSN codes, the GST table and the amounts in words — and that it all
 * lands in one shape for both invoice types.
 */

const ACTOR = "11111111-1111-1111-1111-111111111111";

describe("PrintDocumentsRepository (real PostgreSQL)", () => {
  let db: Database;
  let sales: SalesInvoicesRepository;
  let purchases: PurchaseInvoicesRepository;
  let repo: PrintDocumentsRepository;
  let companyId: string;
  let partyId: string;
  let siteId: string;
  let cementId: string;
  let unitId: number;

  beforeEach(async () => {
    db = await freshDatabase();
    sales = new SalesInvoicesRepository(db);
    purchases = new PurchaseInvoicesRepository(db);
    repo = new PrintDocumentsRepository(db, sales, purchases);

    await db.insert(schema.countries).values({ id: 1, name: "India" });
    await db.insert(schema.states).values({ id: 24, name: "Gujarat", stateCode: 24, countryId: 1 });
    await db.insert(schema.cities).values({ id: 7, name: "Surat", stateId: 24 });

    const [unit] = await db.insert(schema.units).values({ name: "Bag" }).returning({ id: schema.units.id });
    unitId = unit!.id;
    const [item] = await db
      .insert(schema.items)
      .values({ name: "OPC 53 Grade Cement", unitId, pricePerUnit: "395.00", hsnCode: "2523" })
      .returning({ id: schema.items.id });
    cementId = item!.id;

    const [company] = await db
      .insert(schema.companies)
      .values({
        name: "DH PATEL",
        invoicePrefix: "DHP",
        address: "Ground Floor, Ring Road",
        cityId: 7,
        stateId: 24,
        pincode: "395002",
        gstNo: "24AAACD1234F1Z5",
        bankName: "HDFC Bank",
        accountNo: "50200012345678",
        ifscCode: "HDFC0001234",
      })
      .returning({ id: schema.companies.id });
    companyId = company!.id;

    const [party] = await db
      .insert(schema.suppliers)
      .values({
        name: "VARDAN ENTERPRISE",
        buildingName: "12 Textile Market",
        area: "Varachha",
        cityId: 7,
        stateId: 24,
        gstNo: "24AAAFV1234K1Z2",
        accountNo: "99999999",
      })
      .returning({ id: schema.suppliers.id });
    partyId = party!.id;

    const [site] = await db
      .insert(schema.sites)
      .values({ name: "Akwada Lake Front", isActive: true })
      .returning({ id: schema.sites.id });
    siteId = site!.id;
  });

  const lines = () => [
    { itemId: cementId, unitId, quantity: "10", unitPrice: "400.00", discountPerUnit: "10.00", gstPercent: "28" },
    { itemId: null, itemName: "Loose sand", unitId, quantity: "2.5", unitPrice: "1000.00", gstPercent: "5" },
  ];

  it("prints a sales invoice with the company, the customer and the lines", async () => {
    const invoice = await sales.create(
      createSalesInvoiceSchema.parse({ customerId: partyId, companyId, siteId, challanNo: "CH-9", items: lines() }),
      ACTOR,
    );

    const printed = await repo.salesInvoice(invoice.id);

    expect(printDocumentSchema.parse(printed)).toEqual(printed);
    expect(printed).toMatchObject({
      documentType: "sales-invoice",
      companyId,
      title: "TAX INVOICE",
      number: invoice.salesInvoiceNo,
      fields: { challanNo: "CH-9", siteName: "Akwada Lake Front" },
      company: {
        name: "DH PATEL",
        address: "Ground Floor, Ring Road, Surat, 395002",
        stateName: "Gujarat",
        stateCode: "24",
        accountNo: "50200012345678",
      },
      party: { name: "VARDAN ENTERPRISE", address: "12 Textile Market, Varachha, Surat", stateCode: "24" },
    });
    expect(printed.lines.map((line) => [line.name, line.hsnCode])).toEqual([
      ["OPC 53 Grade Cement", "2523"],
      ["Loose sand", null],
    ]);
  });

  /** The party's bank details are its own business; they are not on its invoice. */
  it("does not carry the party's bank account", async () => {
    const invoice = await sales.create(
      createSalesInvoiceSchema.parse({ customerId: partyId, companyId, items: lines() }),
      ACTOR,
    );
    const printed = await repo.salesInvoice(invoice.id);

    expect(JSON.stringify(printed.party)).not.toContain("99999999");
  });

  it("agrees with the invoice's own totals, and writes them out in words", async () => {
    const invoice = await sales.create(
      createSalesInvoiceSchema.parse({ customerId: partyId, companyId, items: lines() }),
      ACTOR,
    );
    const printed = await repo.salesInvoice(invoice.id);

    expect(printed.totals).toMatchObject({
      totalQuantity: "12.5",
      subtotal: invoice.subtotal,
      totalGstAmount: invoice.totalGstAmount,
      totalAmount: invoice.totalAmount,
    });
    // 3900 at 28% and 2500 at 5%: 1092 + 125 of GST.
    expect(printed.taxSummary.rows).toEqual([
      expect.objectContaining({ gstPercent: "5.00", taxableValue: "2500.00", centralTax: "62.50", stateTax: "62.50", hsnCodes: [] }),
      expect.objectContaining({ gstPercent: "28.00", taxableValue: "3900.00", gstAmount: "1092.00", hsnCodes: ["2523"] }),
    ]);
    expect(printed.taxSummary.gstAmount).toBe(invoice.totalGstAmount);
    expect(printed.amountInWords).toMatch(/^INR .* Only$/);
    expect(printed.taxInWords).toBe("INR One Thousand Two Hundred Seventeen Only");
  });

  it("titles a credit note as one", async () => {
    const invoice = await sales.create(
      createSalesInvoiceSchema.parse({ customerId: partyId, companyId, invoiceType: "Credit Note", items: lines() }),
      ACTOR,
    );
    expect((await repo.salesInvoice(invoice.id)).title).toBe("CREDIT NOTE");
  });

  it("prints a purchase invoice in the same shape, with the supplier's number", async () => {
    const invoice = await purchases.create(
      createPurchaseInvoiceSchema.parse({
        supplierId: partyId,
        companyId,
        siteId,
        supplierInvoiceNo: "GT-1022",
        items: lines(),
      }),
      ACTOR,
    );

    const printed = await repo.purchaseInvoice(invoice.id);

    expect(printDocumentSchema.parse(printed)).toEqual(printed);
    expect(printed).toMatchObject({
      documentType: "purchase-invoice",
      title: "PURCHASE INVOICE",
      fields: { partyInvoiceNo: "GT-1022", siteName: "Akwada Lake Front" },
      party: { name: "VARDAN ENTERPRISE" },
    });
    expect(printed.totals.totalAmount).toBe(invoice.totalAmount);
  });

  it("is a 404 for an invoice that does not exist", async () => {
    await expect(repo.salesInvoice("00000000-0000-0000-0000-000000000999")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("changes nothing it reads", async () => {
    const invoice = await sales.create(
      createSalesInvoiceSchema.parse({ customerId: partyId, companyId, items: lines() }),
      ACTOR,
    );
    const [before] = await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, invoice.id));
    await repo.salesInvoice(invoice.id);
    const [after] = await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, invoice.id));

    expect(after).toEqual(before);
  });
});

describe("the form that grants template rights", () => {
  it("exists after migrating, active, and slugs to the subject the routes ask for", async () => {
    const db = await freshDatabase();
    const [form] = await db.select().from(schema.forms).where(eq(schema.forms.id, 100));

    expect(form).toMatchObject({ formName: "Document Template", isActive: true });
    expect(permission(form!.formName, "view")).toBe("document-template.view");
  });
});

const permissionsOf = (controller: object, method: string): string[] => {
  const handler = (controller as Record<string, unknown>)[method];
  return (Reflect.getMetadata("permissions", handler as object) as string[] | undefined) ?? [];
};

describe("template and print permissions", () => {
  it.each([
    ["list", "document-template.view"],
    ["findOne", "document-template.view"],
    ["create", "document-template.add"],
    ["duplicate", "document-template.add"],
    ["update", "document-template.edit"],
    ["makeDefault", "document-template.edit"],
    ["remove", "document-template.delete"],
  ])("%s asks for %s", (method, required) => {
    expect(permissionsOf(DocumentTemplatesController.prototype, method)).toEqual([required]);
  });

  /** Printing an invoice needs the invoice, not the right to manage layouts. */
  it.each([
    ["salesInvoice", "sales-invoice.view"],
    ["purchaseInvoice", "purchase-invoice.view"],
  ])("printing with %s asks only for %s", (method, required) => {
    expect(permissionsOf(DocumentPrintController.prototype, method)).toEqual([required]);
  });
});
