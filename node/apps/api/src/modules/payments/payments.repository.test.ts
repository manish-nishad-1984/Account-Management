import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import {
  createPaymentSchema,
  createPurchaseInvoiceSchema,
  listQuerySchema,
  updatePaymentSchema,
  type CreatePayment,
} from "@accountmanagement/contracts";
import { PaymentsRepository } from "./payments.repository";
import { PurchaseInvoicesRepository } from "../purchase-invoices/purchase-invoices.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

describe("PaymentsRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: PaymentsRepository;

  let siteId: string;
  let supplierId: string;
  let otherSupplierId: string;
  let companyId: string;

  const input = (overrides: Record<string, unknown> = {}): CreatePayment =>
    createPaymentSchema.parse({
      direction: "out",
      kind: "payment",
      partyId: supplierId,
      companyId,
      siteId,
      amount: "5000.00",
      ...overrides,
    });

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new PaymentsRepository(db);

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
    supplierId = madeSuppliers[0]!.id;
    otherSupplierId = madeSuppliers[1]!.id;

    const [company] = await db
      .insert(schema.companies)
      .values({ name: "DH PATEL", invoicePrefix: "DHP" })
      .returning({ id: schema.companies.id });
    companyId = company!.id;
  });

  describe("recording payments", () => {
    it("writes the whole repeater in one call", async () => {
      const created = await repo.createMany(
        [input({ amount: "1000.00" }), input({ amount: "2500.50" })],
        ACTOR,
      );

      expect(created).toBe(2);
      expect(await repo.total()).toBe(2);
    });

    it("keeps the amount as an exact decimal string", async () => {
      await repo.createMany([input({ amount: "12345.67" })], ACTOR);

      const rows = (await repo.list(query())).rows;
      expect(rows[0]!.amount).toBe("12345.67");
    });

    it("names the party, company and site on the row", async () => {
      await repo.createMany([input()], ACTOR);

      const row = (await repo.list(query())).rows[0]!;
      expect(row.partyName).toBe("AL BURHAN PIPES");
      expect(row.companyName).toBe("DH PATEL");
      expect(row.siteName).toBe("Akwada Lake Front");
    });
  });

  /**
   * The source's own rule, read off the two branches of `PayOutScript.js:698`:
   * the OpeningBalance branch validates date and amount, the payment branch
   * validates date, amount AND site.
   */
  describe("an opening balance is not a payment", () => {
    it("is accepted without a site", async () => {
      const created = await repo.createMany(
        [input({ kind: "opening_balance", siteId: null })],
        ACTOR,
      );

      expect(created).toBe(1);
      const row = (await repo.list(query())).rows[0]!;
      expect(row.kind).toBe("opening_balance");
      expect(row.siteId).toBeNull();
      expect(row.siteName).toBeNull();
    });

    it("refuses a PAYMENT with no site", () => {
      expect(() =>
        createPaymentSchema.parse({
          direction: "out",
          kind: "payment",
          partyId: supplierId,
          companyId,
          siteId: "",
          amount: "100.00",
        }),
      ).toThrow(/Choose the site this payment is for/);
    });
  });

  /**
   * `PayOutScript.js:714` checks only that the amount box is not empty, so a
   * negative amount posts and lands in `TotalAmount`, where every read then
   * subtracts it — turning a payment into a charge with nothing on screen to
   * say so.
   */
  describe("the amount", () => {
    it("refuses zero and negative amounts", () => {
      const attempt = (amount: string) =>
        createPaymentSchema.parse({
          direction: "out",
          kind: "payment",
          partyId: supplierId,
          companyId,
          siteId,
          amount,
        });

      expect(() => attempt("0")).toThrow(/more than zero/);
      expect(() => attempt("-500.00")).toThrow();
    });
  });

  describe("reading them back", () => {
    it("filters by direction, party and site", async () => {
      await repo.createMany(
        [
          input(),
          input({ partyId: otherSupplierId }),
          input({ direction: "in" }),
        ],
        ACTOR,
      );

      expect(await repo.total(undefined, { direction: "out" })).toBe(2);
      expect(await repo.total(undefined, { direction: "in" })).toBe(1);
      expect(await repo.total(undefined, { partyId: otherSupplierId })).toBe(1);
      expect(await repo.total(undefined, { siteId })).toBe(3);
    });

    it("searches the party name, the description and the reference", async () => {
      await repo.createMany(
        [
          input({ description: "August running account" }),
          input({ partyId: otherSupplierId, referenceNo: "CHQ-4471" }),
        ],
        ACTOR,
      );

      expect(await repo.total("SHAH")).toBe(1);
      expect(await repo.total("running account")).toBe(1);
      expect(await repo.total("CHQ-4471")).toBe(1);
      expect(await repo.total("nothing here")).toBe(0);
    });

    /**
     * The export centre's date range (client, 20 Oct 2026): by the payment's own
     * date, or by the day it was entered — in India, so 1 a.m. IST on the 1st is
     * the 1st, though it is still the 31st in UTC.
     */
    it("counts a date range by the payment's date or by the day it was entered", async () => {
      await repo.createMany(
        [
          input({ paymentDate: "2026-03-31", description: "march" }),
          input({ paymentDate: "2026-04-01", description: "april first" }),
          input({ paymentDate: "2026-04-30", description: "april last" }),
        ],
        ACTOR,
      );
      await db.update(schema.payments).set({ createdAt: new Date("2026-04-30T19:30:00Z") }); // 1 May, 01:00 IST

      const april = { fromDate: "2026-04-01", toDate: "2026-04-30" };
      expect(await repo.total(undefined, april)).toBe(2);
      expect(await repo.total(undefined, { ...april, dateBasis: "document" })).toBe(2);
      expect(await repo.total(undefined, { fromDate: "2026-04-01" })).toBe(2);
      expect(await repo.total(undefined, { toDate: "2026-03-31" })).toBe(1);

      expect(await repo.total(undefined, { ...april, dateBasis: "entry" })).toBe(0);
      expect(await repo.total(undefined, { fromDate: "2026-05-01", toDate: "2026-05-01", dateBasis: "entry" })).toBe(3);
      expect((await repo.list(query(), { ...april })).rows.map((row) => row.description).sort()).toEqual(["april first", "april last"]);
    });

    it("pages by the keyset, and the second page continues the first", async () => {
      await repo.createMany(
        Array.from({ length: 5 }, (_unused, n) => input({ amount: `${100 + n}.00` })),
        ACTOR,
      );

      const first = await repo.list(query({ limit: 2 }));
      expect(first.rows).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await repo.list(query({ limit: 2, cursor: first.nextCursor! }));
      const seen = new Set([...first.rows, ...second.rows].map((row) => row.id));
      expect(seen.size).toBe(4);
    });

    it("404s on a payment that does not exist", async () => {
      await expect(
        repo.findById("00000000-0000-0000-0000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("editing and deleting", () => {
    it("updates the amount, date and description", async () => {
      await repo.createMany([input()], ACTOR);
      const { id } = (await repo.list(query())).rows[0]!;

      const updated = await repo.update(
        id,
        updatePaymentSchema.parse({
          amount: "750.25",
          description: "Part settlement",
          paymentDate: "2026-03-15",
        }),
        ACTOR,
      );

      expect(updated.amount).toBe("750.25");
      expect(updated.description).toBe("Part settlement");
      expect(updated.paymentDate).toContain("2026-03-15");
    });

    // Client, 19 Oct 2026 (CHINTAN-DEMO): an edit from 1,416 to 1,000 still settled the 1,416 bill.
    it("cuts what an edited payment settles to its new amount, the oldest bill first", async () => {
      const [unit] = await db.insert(schema.units).values({ name: "Nos" }).returning({ id: schema.units.id });
      const bills = new PurchaseInvoicesRepository(db);
      const bill = (no: string, date: string, price: string) =>
        bills.create(
          createPurchaseInvoiceSchema.parse({
            supplierInvoiceNo: no,
            supplierId,
            companyId,
            siteId,
            documentDate: date,
            items: [{ itemName: "Demo", unitId: unit!.id, quantity: "1", unitPrice: price }],
          }),
          ACTOR,
        );
      const newer = await bill("2", "2026-10-19", "600.00");
      const older = await bill("1", "2026-10-01", "1000.00");
      await repo.createMany(
        [
          input({
            amount: "1600.00",
            allocations: [
              { source: "invoice", documentId: newer.id, amount: "600.00" },
              { source: "invoice", documentId: older.id, amount: "1000.00" },
            ],
          }),
        ],
        ACTOR,
      );
      const { id } = (await repo.list(query())).rows[0]!;
      const named = async () =>
        Object.fromEntries(
          (await db.select().from(schema.paymentAllocations)).map((a) => [a.documentId, a.amount]),
        );

      await repo.update(id, updatePaymentSchema.parse({ amount: "1200" }), ACTOR);
      expect(await named()).toEqual({ [older.id]: "1000.00", [newer.id]: "200.00" });

      await repo.update(id, updatePaymentSchema.parse({ amount: "700" }), ACTOR);
      expect(await named()).toEqual({ [older.id]: "700.00" });

      // Raising it names nothing new; an edit that leaves the amount alone changes nothing.
      await repo.update(id, updatePaymentSchema.parse({ amount: "5000" }), ACTOR);
      await repo.update(id, updatePaymentSchema.parse({ description: "note" }), ACTOR);
      expect(await named()).toEqual({ [older.id]: "700.00" });
    });

    /**
     * SOFT delete, where `DeletePayoutDetails` calls `Remove()` and the row
     * leaves the table — taking a supplier balance with it and leaving nothing
     * that says why the balance moved.
     */
    it("hides a deleted payment but keeps the row", async () => {
      await repo.createMany([input()], ACTOR);
      const { id } = (await repo.list(query())).rows[0]!;

      await repo.remove(id, ACTOR);

      expect(await repo.total()).toBe(0);
      await expect(repo.findById(id)).rejects.toBeInstanceOf(NotFoundException);

      const [row] = await db.select().from(schema.payments);
      expect(row!.isDeleted).toBe(true);
    });

    it("404s rather than reporting success when deleting twice", async () => {
      await repo.createMany([input()], ACTOR);
      const { id } = (await repo.list(query())).rows[0]!;

      await repo.remove(id, ACTOR);
      await expect(repo.remove(id, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
