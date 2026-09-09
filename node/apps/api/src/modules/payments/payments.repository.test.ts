import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import {
  createPaymentSchema,
  listQuerySchema,
  updatePaymentSchema,
  type CreatePayment,
} from "@accountmanagement/contracts";
import { PaymentsRepository } from "./payments.repository";
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
