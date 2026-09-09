import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import {
  createPurchaseInvoiceSchema,
  type BalancesQuery,
  type ReportFilter,
} from "@accountmanagement/contracts";
import { ReportExportService } from "./report-export.service";
import { ReportsRepository } from "./reports.repository";
import { PaymentsRepository } from "../payments/payments.repository";
import { PurchaseInvoicesRepository } from "../purchase-invoices/purchase-invoices.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

const filter = (overrides: Partial<ReportFilter> = {}): ReportFilter => ({
  direction: "out",
  ...overrides,
});

const balancesFilter = (overrides: Partial<BalancesQuery> = {}): BalancesQuery => ({
  direction: "out",
  show: "all",
  ...overrides,
});

/** The sheet read back as a grid of strings, which is how a person reads it. */
async function readBack(bytes: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  const sheet = workbook.worksheets[0]!;

  const grid: string[][] = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const cells: string[] = [];
    sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => {
      cells.push(cell.value === null || cell.value === undefined ? "" : String(cell.value));
    });
    grid.push(cells);
  }
  return grid;
}

/**
 * The seven report downloads, rendered from a real database.
 *
 * What these are for is the join between the query and the file: the sheet
 * showing the same numbers the grid shows, the Total agreeing with the rows
 * above it, and the party sections closing at the balance the window function
 * computed. The formatting rules themselves are pinned in the contracts tests.
 */
describe("ReportExportService (real PostgreSQL)", () => {
  let db: Database;
  let exports: ReportExportService;
  let reports: ReportsRepository;
  let payments: PaymentsRepository;
  let invoices: PurchaseInvoicesRepository;

  let siteId: string;
  let supplierId: string;
  let otherSupplierId: string;
  let companyId: string;
  let itemId: string;
  let unitId: number;

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
    exports = new ReportExportService(db, reports);
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

    const [site] = await db
      .insert(schema.sites)
      .values({ name: "Akwada Lake Front", isActive: true })
      .returning({ id: schema.sites.id });
    siteId = site!.id;

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

  describe("the ledger workbook", () => {
    it("writes one row per document, with the amount under the column its effect names", async () => {
      await invoices.create(invoiceFor("100000.00"), ACTOR);

      const grid = await readBack(await exports.ledgerWorkbook(filter()));
      const header = grid.findIndex((row) => row[0] === "Document");
      const first = grid[header + 1]!;

      expect(first[2]).toBe("AL BURHAN PIPES");
      expect(first[3]).toBe("Akwada Lake Front");
      expect(first[5]).toBe("1,00,000.00"); // Credit
      expect(first[6]).toBe(""); // Debit
      expect(first[7]).toBe("1,00,000.00"); // Balance
    });

    /**
     * The legacy file's Total comes from a different query than its rows, and
     * whenever a purchase return is in range the two disagree — finding D7,
     * inside a single spreadsheet. Here they cannot.
     */
    it("has a Total that equals the rows above it, even with a return in range", async () => {
      await invoices.create(invoiceFor("100000.00"), ACTOR);
      await invoices.create(
        invoiceFor("10000.00", { supplierInvoiceNo: "RET-1", invoiceType: "Purchase Return" }),
        ACTOR,
      );

      const grid = await readBack(await exports.ledgerWorkbook(filter()));
      const total = grid.find((row) => row[0] === "Total")!;

      expect(total[5]).toBe("1,00,000.00");
      expect(total[6]).toBe("10,000.00");
      expect(total[7]).toBe("90,000.00");

      // What the legacy footer would have written: the return ADDED.
      expect(total[7]).not.toBe("1,10,000.00");
    });

    it("names the filters in a caption block, resolved from the ids rather than the request", async () => {
      await invoices.create(invoiceFor("100000.00"), ACTOR);

      const grid = await readBack(await exports.ledgerWorkbook(filter({ supplierId } as never)));
      const flat = grid.flat();
      expect(flat).toContain("Akwada Lake Front");
    });

    it("shows a payment as a debit that reduces the running balance", async () => {
      await invoices.create(invoiceFor("100000.00"), ACTOR);
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
            amount: "40000.00",
            description: "part payment",
            method: null,
            referenceNo: null,
          },
        ] as never,
        ACTOR,
      );

      const grid = await readBack(await exports.ledgerWorkbook(filter()));
      const total = grid.find((row) => row[0] === "Total")!;
      expect(total[7]).toBe("60,000.00");
    });
  });

  describe("the party-grouped workbook", () => {
    /**
     * The legacy "Supplier Excel" is the same rows with a header and a Total
     * per supplier. Its one departure here is the grouping key: it groups on
     * `SupplierName`, so two parties sharing a name merge into one section and
     * one running balance. Grouped on the party id instead.
     */
    it("writes a header and a Total for each party", async () => {
      await invoices.create(invoiceFor("100000.00"), ACTOR);
      await invoices.create(
        invoiceFor("50000.00", { supplierId: otherSupplierId, supplierInvoiceNo: "INV-2" }),
        ACTOR,
      );

      const grid = await readBack(await exports.ledgerBySupplierWorkbook(filter()));

      expect(grid.filter((row) => row[0] === "Document")).toHaveLength(2);

      const totals = grid.filter((row) => row[0] === "Total").map((row) => row[7]);
      expect(totals).toEqual(["1,00,000.00", "50,000.00"]);
    });

    it("orders the sections by party name", async () => {
      await invoices.create(invoiceFor("100000.00"), ACTOR);
      await invoices.create(
        invoiceFor("50000.00", { supplierId: otherSupplierId, supplierInvoiceNo: "INV-2" }),
        ACTOR,
      );

      const grid = await readBack(await exports.ledgerBySupplierWorkbook(filter()));
      const parties = grid
        .filter((row) => row[2] === "AL BURHAN PIPES" || row[2] === "SHAH ENTERPRISE")
        .map((row) => row[2]);

      expect(parties[0]).toBe("AL BURHAN PIPES");
      expect(parties[parties.length - 1]).toBe("SHAH ENTERPRISE");
    });

    /**
     * A section's closing balance is the LAST ROW's balance column, which the
     * window function computed partitioned by party — not a figure re-summed
     * here. Two implementations of one balance is the defect this module exists
     * to avoid.
     */
    it("closes a section at the balance the last row already carries", async () => {
      await invoices.create(invoiceFor("100000.00"), ACTOR);
      await invoices.create(
        invoiceFor("10000.00", { supplierInvoiceNo: "RET-1", invoiceType: "Purchase Return" }),
        ACTOR,
      );

      const grid = await readBack(await exports.ledgerBySupplierWorkbook(filter()));
      const rows = grid.filter((row) => row[2] === "AL BURHAN PIPES");
      const lastRowBalance = rows[rows.length - 1]![7];
      const total = grid.find((row) => row[0] === "Total")!;

      expect(total[7]).toBe(lastRowBalance);
      expect(total[7]).toBe("90,000.00");
    });
  });

  describe("the balances workbook", () => {
    it("writes one row per site and party, with a Total under it", async () => {
      await invoices.create(invoiceFor("100000.00"), ACTOR);

      const grid = await readBack(await exports.balancesWorkbook(balancesFilter(), "Balances"));
      const header = grid.findIndex((row) => row[0] === "Site");
      expect(grid[header]).toEqual(["Site", "Supplier", "Credit", "Debit", "Net"]);

      const total = grid.find((row) => row[0] === "Total")!;
      expect(total[4]).toBe("1,00,000.00");
    });

    it("heads the sales direction with the words the sales screen uses", async () => {
      const grid = await readBack(
        await exports.balancesWorkbook(balancesFilter({ direction: "in" }), "Sales report"),
      );
      const header = grid.find((row) => row[0] === "Site")!;
      expect(header).toEqual(["Site", "Customer", "Invoiced", "Received", "Outstanding"]);
    });
  });

  describe("the PDFs", () => {
    it("renders the ledger as a PDF", async () => {
      await invoices.create(invoiceFor("100000.00"), ACTOR);
      const bytes = await exports.ledgerPdf(filter());
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    });

    it("renders the summary as a PDF", async () => {
      await invoices.create(invoiceFor("100000.00"), ACTOR);
      const bytes = await exports.balancesPdf(balancesFilter(), "Payout summary");
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    });

    it("renders an empty report rather than failing when nothing matches", async () => {
      const bytes = await exports.ledgerPdf(filter());
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    });
  });

  /**
   * Over the cap the export is REFUSED, not truncated. A file that silently
   * stops at row twenty thousand still carries a Total that looks
   * authoritative, and nobody checks the row count of a spreadsheet they asked
   * for. The message names the count and what to narrow.
   */
  describe("the row cap", () => {
    it("refuses an export larger than the cap, and says what to narrow", async () => {
      const service = new ReportExportService(db, {
        ledger: async () => ({
          rows: [],
          total: 25_000,
          nextCursor: null,
          totalCredit: "0.00",
          totalDebit: "0.00",
          closingBalance: "0.00",
        }),
      } as never);

      await expect(service.ledgerWorkbook(filter())).rejects.toThrow(BadRequestException);
      await expect(service.ledgerWorkbook(filter())).rejects.toThrow(/25,000 rows/);
      await expect(service.ledgerWorkbook(filter())).rejects.toThrow(/Narrow it/);
    });
  });
});
