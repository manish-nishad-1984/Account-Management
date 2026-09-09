import { beforeEach, describe, expect, it } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  createSalesInvoiceSchema,
  listQuerySchema,
  type CreateSalesInvoice,
} from "@accountmanagement/contracts";
import { financialYear } from "@accountmanagement/domain";
import { SalesInvoicesRepository } from "./sales-invoices.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

const FY = financialYear.format(financialYear.currentAsProduced(new Date()));

describe("SalesInvoicesRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: SalesInvoicesRepository;
  let siteId: string;
  let customerId: string;
  let otherCustomerId: string;
  let companyId: string;
  let otherCompanyId: string;
  let noPrefixCompanyId: string;
  let itemId: string;
  let unitId: number;

  const input = (overrides: Record<string, unknown> = {}): CreateSalesInvoice =>
    createSalesInvoiceSchema.parse({
      customerId,
      companyId,
      siteId,
      items: [{ itemId, unitId, quantity: "3", unitPrice: "1000.00", gstPercent: "18" }],
      ...overrides,
    });

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new SalesInvoicesRepository(db);

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

    // The party table. On this screen its rows are CUSTOMERS — one table holds
    // both sides of the trade. `area` is NOT NULL.
    const parties = await db
      .insert(schema.suppliers)
      .values([
        { name: "RELIANCE INFRASTRUCTURE", area: "Navrangpura" },
        { name: "TORRENT POWER", area: "Maninagar" },
      ])
      .returning({ id: schema.suppliers.id, name: schema.suppliers.name });
    customerId = parties[0]!.id;
    otherCustomerId = parties[1]!.id;

    const companies = await db
      .insert(schema.companies)
      .values([
        { name: "DH PATEL", invoicePrefix: "DHP" },
        { name: "DEMO", invoicePrefix: "DEMO" },
        { name: "NO PREFIX LTD", invoicePrefix: null },
      ])
      .returning({ id: schema.companies.id, name: schema.companies.name });
    companyId = companies.find((row) => row.name === "DH PATEL")!.id;
    otherCompanyId = companies.find((row) => row.name === "DEMO")!.id;
    noPrefixCompanyId = companies.find((row) => row.name === "NO PREFIX LTD")!.id;
  });

  /**
   * THE NUMBER IS OURS HERE, unlike a purchase invoice's. These pin the three
   * defects `SalesRepo.CheckSalesInvoiceNo` carries.
   */
  describe("document numbering", () => {
    /**
     * NO `/PO/` SEGMENT — `DHP/26-27/001`, where a purchase order is
     * `DHP/PO/26-27/001`. That asymmetry is the source's own format, and it is
     * the only thing distinguishing the two numbers for one company.
     */
    it("issues PREFIX/YEAR/NNN, with no document-type segment", async () => {
      const created = await repo.create(input(), ACTOR);
      expect(created.salesInvoiceNo).toBe(`DHP/${FY}/001`);
    });

    it("counts per company, so two companies both reach 001", async () => {
      const first = await repo.create(input(), ACTOR);
      const second = await repo.create(input({ companyId: otherCompanyId }), ACTOR);

      expect(first.salesInvoiceNo).toBe(`DHP/${FY}/001`);
      expect(second.salesInvoiceNo).toBe(`DEMO/${FY}/001`);
    });

    it("increments within a company without disturbing the other", async () => {
      await repo.create(input(), ACTOR);
      await repo.create(input({ companyId: otherCompanyId }), ACTOR);
      const third = await repo.create(input(), ACTOR);

      expect(third.salesInvoiceNo).toBe(`DHP/${FY}/002`);
    });

    /**
     * The source reads the last row and increments with no lock, so two callers
     * get the same number. The counter here takes a row lock for the statement.
     */
    it("hands out consecutive numbers under concurrency", async () => {
      const created = await Promise.all(
        Array.from({ length: 15 }, () => repo.create(input(), ACTOR)),
      );
      const numbers = created.map((row) => row.salesInvoiceNo).sort();

      expect(new Set(numbers).size).toBe(15);
      expect(numbers[0]).toBe(`DHP/${FY}/001`);
      expect(numbers[14]).toBe(`DHP/${FY}/015`);
    });

    /**
     * `CompanyDetails.InvoicePef.Trim()` has no null check on a nullable column,
     * and the catch around it returns the error text AS the number. Refused
     * here, by name, before anything is written.
     */
    it("refuses a company with no invoice prefix, and says which", async () => {
      await expect(repo.create(input({ companyId: noPrefixCompanyId }), ACTOR)).rejects.toThrow(
        /NO PREFIX LTD has no invoice prefix/,
      );
      await expect(
        repo.create(input({ companyId: noPrefixCompanyId }), ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("writes nothing when the number cannot be issued", async () => {
      await expect(repo.create(input({ companyId: noPrefixCompanyId }), ACTOR)).rejects.toThrow();

      const rows = await db.select({ id: schema.salesInvoices.id }).from(schema.salesInvoices);
      expect(rows).toHaveLength(0);
    });

    it("never accepts a number from the client", () => {
      const parsed = createSalesInvoiceSchema.parse({
        customerId,
        companyId,
        salesInvoiceNo: "TYPED/OVER/001",
        items: [{ itemId, unitId, quantity: "1", unitPrice: "10.00" }],
      } as Record<string, unknown>);

      expect(parsed).not.toHaveProperty("salesInvoiceNo");
    });
  });

  /**
   * The same calculator as the purchase side, in the other direction. The sales
   * screen's own calculator is the healthiest of the three — one script, and its
   * row class matches the partial that renders rows — so these pin the two
   * defects it DOES have rather than B-2's.
   */
  describe("totals", () => {
    it("subtracts the TDS, which the source reads without parseFloat", async () => {
      const created = await repo.create(input({ tds: "500.00" }), ACTOR);
      expect(created.totalAmount).toBe("3040.00");
      expect(created.tds).toBe("500.00");
    });

    it("adds a signed adjustment", async () => {
      const down = await repo.create(input({ roundOff: "-10.00" }), ACTOR);
      expect(down.totalAmount).toBe("3530.00");
    });

    /** `updateSalesTotals` carries its own copy of the whole-rupee rule. */
    it("rounds to a whole rupee, with .50 going down", async () => {
      const tie = await repo.create(
        input({
          items: [{ itemId, unitId, quantity: "1", unitPrice: "100.00", gstPercent: "5" }],
          roundOff: "0.50",
        }),
        ACTOR,
      );
      expect(tie.totalAmount).toBe("105.00");
    });

    /**
     * THE PRICE DEFECT THIS SCREEN HAS. The source keeps an editable visible
     * price and a hidden catalogue twin; the line's GST comes from the hidden
     * one and the roll-up sums the visible one, so a typed price is charged GST
     * at the catalogue rate. There is ONE price here, and everything derives
     * from it — subtotal and GST cannot be computed off different numbers.
     */
    it("computes the line and the roll-up from the SAME price", async () => {
      const created = await repo.create(
        input({
          items: [
            { itemId, unitId, quantity: "10", unitPrice: "250.00", discountPerUnit: "50.00", gstPercent: "18" },
          ],
        }),
        ACTOR,
      );

      // (250 − 50) x 10 = 2000 net. GST is 18% OF THAT, 360 — not 18% of 2500.
      expect(created.subtotal).toBe("2000.00");
      expect(created.totalGstAmount).toBe("360.00");
      expect(created.items[0]!.netAmount).toBe("2000.00");
      expect(created.items[0]!.gstAmount).toBe("360.00");
      expect(created.totalAmount).toBe("2360.00");
    });

    it("derives the discount percent rather than storing it", async () => {
      const created = await repo.create(
        input({
          items: [{ itemId, unitId, quantity: "1", unitPrice: "200.00", discountPerUnit: "50.00" }],
        }),
        ACTOR,
      );
      expect(created.items[0]!.discountPercent).toBe("25.00");
    });

    it("recomputes the total when ONLY the TDS changes", async () => {
      const created = await repo.create(input(), ACTOR);
      const updated = await repo.update(created.id, { tds: "40.00" }, ACTOR);

      expect(updated.totalAmount).toBe("3500.00");
      expect(updated.items).toHaveLength(1);
      expect(updated.subtotal).toBe("3000.00");
    });
  });

  describe("listing", () => {
    beforeEach(async () => {
      await repo.create(input(), ACTOR);
      await repo.create(input({ companyId: otherCompanyId }), ACTOR);
      await repo.create(
        input({ customerId: otherCustomerId, invoiceType: "Credit Note" }),
        ACTOR,
      );
    });

    it("names the counterparty CUSTOMER, though it is a supplier row", async () => {
      const page = await repo.list(query({}), { customerId: otherCustomerId });
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]!.customerName).toBe("TORRENT POWER");
    });

    it("filters by company", async () => {
      const page = await repo.list(query({}), { companyId: otherCompanyId });
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]!.salesInvoiceNo).toBe(`DEMO/${FY}/001`);
    });

    it("filters by invoice type", async () => {
      const page = await repo.list(query({}), { invoiceType: "Credit Note" });
      expect(page.rows).toHaveLength(1);
    });

    it("searches the number and the customer in one box", async () => {
      const byNumber = await repo.list(query({ search: "DEMO" }), {});
      expect(byNumber.rows).toHaveLength(1);

      const byCustomer = await repo.list(query({ search: "TORRENT" }), {});
      expect(byCustomer.rows).toHaveLength(1);
    });

    it("lists an invoice that has no site", async () => {
      const created = await repo.create(input({ siteId: "" }), ACTOR);
      const page = await repo.list(query({ limit: 50 }), {});
      const row = page.rows.find((r) => r.id === created.id);

      expect(row).toBeDefined();
      expect(row!.siteName).toBeNull();
    });

    it("counts the lines without fetching them", async () => {
      const page = await repo.list(query({}), {});
      expect(page.rows.every((row) => row.lineCount === 1)).toBe(true);
    });

    it("pages with a cursor rather than an offset", async () => {
      const first = await repo.list(query({ limit: 2 }), {});
      const second = await repo.list(query({ limit: 2, cursor: first.nextCursor! }), {});
      const seen = new Set([...first.rows, ...second.rows].map((r) => r.id));
      expect(seen.size).toBe(3);
    });

    it("reports the total independently of the page", async () => {
      expect(await repo.total(undefined, {})).toBe(3);
      expect(await repo.total(undefined, { companyId: otherCompanyId })).toBe(1);
    });
  });

  describe("approval and deletion", () => {
    it("states the approval rather than toggling it", async () => {
      const created = await repo.create(input(), ACTOR);
      const approved = await repo.setApproval(created.id, true, ACTOR);
      const again = await repo.setApproval(created.id, true, ACTOR);

      expect(approved.isApproved).toBe(true);
      expect(again.isApproved).toBe(true);
    });

    it("skips rows already in the target state when approving in bulk", async () => {
      const a = await repo.create(input(), ACTOR);
      const b = await repo.create(input(), ACTOR);
      await repo.setApproval(a.id, true, ACTOR);

      expect(await repo.setApprovalMany([a.id, b.id], true, ACTOR)).toBe(1);
    });

    /** A real delete — `SalesInvoice` has no soft-delete column to set. */
    it("deletes the invoice and its lines", async () => {
      const created = await repo.create(input(), ACTOR);
      await repo.remove(created.id);

      await expect(repo.findById(created.id)).rejects.toBeInstanceOf(NotFoundException);
      const lines = await db
        .select({ id: schema.salesInvoiceItems.id })
        .from(schema.salesInvoiceItems);
      expect(lines).toHaveLength(0);
    });

    /**
     * The number is NOT reissued after a delete. The counter is the sequence's
     * owner and it does not go backwards — where the source, which reads the
     * last surviving row, WOULD hand the deleted invoice's number out again.
     */
    it("does not reissue a deleted invoice's number", async () => {
      const first = await repo.create(input(), ACTOR);
      expect(first.salesInvoiceNo).toBe(`DHP/${FY}/001`);

      await repo.remove(first.id);
      const next = await repo.create(input(), ACTOR);

      expect(next.salesInvoiceNo).toBe(`DHP/${FY}/002`);
    });

    it("refuses to delete an id that is not there", async () => {
      await expect(repo.remove("99999999-9999-9999-9999-999999999999")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
