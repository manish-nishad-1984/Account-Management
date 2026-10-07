import { BadRequestException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createPayoutListSchema, createPurchaseInvoiceSchema, listQuerySchema } from "@accountmanagement/contracts";
import { PayoutsRepository } from "./payouts.repository";
import { ReportsRepository } from "../reports/reports.repository";
import { PaymentsRepository } from "../payments/payments.repository";
import { PurchaseInvoicesRepository } from "../purchase-invoices/purchase-invoices.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";
const OTHER_ACTOR = "22222222-2222-2222-2222-222222222222";
const NOBODY = "99999999-9999-4999-8999-999999999999";

describe("PayoutsRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: PayoutsRepository;
  let reports: ReportsRepository;
  let payments: PaymentsRepository;
  let invoices: PurchaseInvoicesRepository;

  let siteId: string;
  let otherSiteId: string;
  let companyId: string;
  let itemId: string;
  let unitId: number;
  let alId: string;
  let shahId: string;
  let settledId: string;

  const invoice = (supplierId: string, no: string, amount: string, site = siteId) =>
    invoices.create(
      createPurchaseInvoiceSchema.parse({
        supplierInvoiceNo: no,
        supplierId,
        companyId,
        siteId: site,
        documentDate: "2026-01-01T00:00:00.000Z",
        items: [{ itemId, unitId, quantity: "1", unitPrice: amount }],
      }),
      ACTOR,
    );

  const pay = (partyId: string, amount: string, site = siteId) =>
    payments.createMany(
      [
        {
          direction: "out" as const,
          kind: "payment" as const,
          partyId,
          companyId,
          siteId: site,
          siteLocationId: null,
          paymentDate: "2026-02-01T00:00:00.000Z",
          amount,
          description: null,
          method: null,
          referenceNo: null,
        },
      ],
      ACTOR,
    );

  const input = (lines: { partyId: string; amount: string }[], overrides: Record<string, unknown> = {}) =>
    createPayoutListSchema.parse({ listDate: "2026-10-05", lines, ...overrides });

  beforeEach(async () => {
    db = await freshDatabase();
    reports = new ReportsRepository(db);
    repo = new PayoutsRepository(db, reports);
    payments = new PaymentsRepository(db);
    invoices = new PurchaseInvoicesRepository(db);

    const [unit] = await db.insert(schema.units).values({ name: "Bag" }).returning({ id: schema.units.id });
    unitId = unit!.id;
    const [item] = await db
      .insert(schema.items)
      .values({ name: "Cement", unitId, pricePerUnit: "395.00" })
      .returning({ id: schema.items.id });
    itemId = item!.id;
    const sites = await db
      .insert(schema.sites)
      .values([
        { name: "Akwada", isActive: true },
        { name: "Surat", isActive: true },
      ])
      .returning({ id: schema.sites.id, name: schema.sites.name });
    siteId = sites.find((s) => s.name === "Akwada")!.id;
    otherSiteId = sites.find((s) => s.name === "Surat")!.id;
    const made = await db
      .insert(schema.suppliers)
      .values([{ name: "AL BURHAN PIPES" }, { name: "SHAH ENTERPRISE" }, { name: "SETTLED TRADERS" }])
      .returning({ id: schema.suppliers.id, name: schema.suppliers.name });
    alId = made.find((s) => s.name.startsWith("AL"))!.id;
    shahId = made.find((s) => s.name.startsWith("SHAH"))!.id;
    settledId = made.find((s) => s.name.startsWith("SETTLED"))!.id;
    const [company] = await db
      .insert(schema.companies)
      .values({ name: "DH PATEL", invoicePrefix: "DHP" })
      .returning({ id: schema.companies.id });
    companyId = company!.id;

    // AL owes 1,500 at one site and 500 at another; Shah 700; Settled nothing.
    await invoice(alId, "A1", "1500.00");
    await invoice(alId, "A2", "500.00", otherSiteId);
    await invoice(shahId, "S1", "1000.00");
    await pay(shahId, "300.00");
    await invoice(settledId, "T1", "400.00");
    await pay(settledId, "400.00");
  });

  describe("outstanding", () => {
    it("sums each supplier over its sites, drops anyone owed nothing, and sorts by name", async () => {
      const result = await repo.outstanding();
      expect(result.rows).toEqual([
        { partyId: alId, partyName: "AL BURHAN PIPES", outstanding: "2000.00", invoices: expect.any(Array) },
        { partyId: shahId, partyName: "SHAH ENTERPRISE", outstanding: "700.00", invoices: expect.any(Array) },
      ]);
      expect(result.total).toBe("2700.00");
    });

    it("equals the sum of that party's Pending Outstanding rows", async () => {
      const report = await reports.balances({ direction: "out", show: "outstanding" }, { limit: 200, offset: 0 });
      const sumFor = (partyId: string) =>
        report.rows
          .filter((row) => row.partyId === partyId && Number(row.netAmount) > 0)
          .reduce((sum, row) => sum + Math.round(Number(row.netAmount) * 100), 0);
      expect(report.rows.filter((row) => row.partyId === alId)).toHaveLength(2);
      const result = await repo.outstanding();
      for (const row of result.rows) {
        expect(Math.round(Number(row.outstanding) * 100)).toBe(sumFor(row.partyId));
      }
    });

    it("with a site, lists only what is owed AT that site, with only that site's bills", async () => {
      const here = await repo.outstanding(siteId);
      expect(here.rows.map((row) => [row.partyName, row.outstanding])).toEqual([
        ["AL BURHAN PIPES", "1500.00"],
        ["SHAH ENTERPRISE", "700.00"],
      ]);
      expect(here.total).toBe("2200.00");
      expect(here.rows.flatMap((row) => row.invoices).map((bill) => bill.displayNo).sort()).toEqual(["A1", "S1"]);

      const there = await repo.outstanding(otherSiteId);
      expect(there.rows.map((row) => [row.partyName, row.outstanding])).toEqual([["AL BURHAN PIPES", "500.00"]]);
      expect(there.total).toBe("500.00");
    });

    it("nets an overpaid site against an owed one, and omits a party that nets to nothing owed", async () => {
      await pay(shahId, "1000.00", otherSiteId); // +700 at Akwada, -1000 at Surat = -300
      const result = await repo.outstanding();
      expect(result.rows.map((row) => row.partyName)).toEqual(["AL BURHAN PIPES"]);
    });
  });

  describe("create and read back", () => {
    it("keeps lines in order with the total, party count and live outstanding", async () => {
      const created = await repo.create(
        input(
          [
            { partyId: shahId, amount: "700.00" },
            { partyId: alId, amount: "1000.50" },
          ],
          { title: "Week 40", budget: "4000000.00", note: "Owner approved" },
        ),
        ACTOR,
      );

      expect(created).toMatchObject({
        listDate: "2026-10-05",
        title: "Week 40",
        budget: "4000000.00",
        note: "Owner approved",
        total: "1700.50",
        partyCount: 2,
        updatedAt: null,
      });
      expect(
        created.lines.map((line) => [line.partyName, line.amount, line.outstandingAtSave, line.outstandingNow]),
      ).toEqual([
        ["SHAH ENTERPRISE", "700.00", "700.00", "700.00"],
        ["AL BURHAN PIPES", "1000.50", "2000.00", "2000.00"],
      ]);
    });

    it("accepts a part payment and refuses a zero amount at the contract", async () => {
      const created = await repo.create(input([{ partyId: alId, amount: "0.01" }]), ACTOR);
      expect(created.lines[0]?.amount).toBe("0.01");
      expect(() => input([{ partyId: alId, amount: "0" }])).toThrow(/more than zero/);
    });

    it("refuses the same party twice at the contract", () => {
      expect(() =>
        input([
          { partyId: alId, amount: "1.00" },
          { partyId: alId, amount: "2.00" },
        ]),
      ).toThrow(/already in the list/);
    });

    it("records outstanding 0.00 for a party that is owed nothing", async () => {
      const created = await repo.create(input([{ partyId: settledId, amount: "10.00" }]), ACTOR);
      expect(created.lines[0]).toMatchObject({ outstandingAtSave: "0.00", outstandingNow: "0.00" });
    });

    it("refuses an unknown party with a 400 that names the line, and saves nothing", async () => {
      const error = await repo
        .create(
          input([
            { partyId: alId, amount: "1.00" },
            { partyId: NOBODY, amount: "1.00" },
          ]),
          ACTOR,
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify((error as BadRequestException).getResponse())).toContain("lines.1.partyId");
      expect(await repo.total()).toBe(0);
    });

    it("refuses a soft-deleted party", async () => {
      await db.update(schema.suppliers).set({ isDeleted: true }).where(eq(schema.suppliers.id, shahId));
      await expect(repo.create(input([{ partyId: shahId, amount: "1.00" }]), ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("never writes to the ledger", async () => {
      const before = await db.select().from(schema.payments);
      await repo.create(input([{ partyId: alId, amount: "2000.00" }]), ACTOR);
      expect(await db.select().from(schema.payments)).toHaveLength(before.length);
      expect((await repo.outstanding()).total).toBe("2700.00");
    });
  });

  describe("outstandingNow", () => {
    it("reflects a payment made after the list was saved, while outstandingAtSave stays", async () => {
      const created = await repo.create(input([{ partyId: shahId, amount: "700.00" }]), ACTOR);
      await pay(shahId, "700.00");
      const again = await repo.findById(created.id);
      expect(again.lines[0]).toMatchObject({ outstandingAtSave: "700.00", outstandingNow: "0.00" });
    });

    it("shows a part-paid party's remaining balance", async () => {
      const created = await repo.create(input([{ partyId: shahId, amount: "700.00" }]), ACTOR);
      await pay(shahId, "200.00");
      expect((await repo.findById(created.id)).lines[0]?.outstandingNow).toBe("500.00");
    });
  });

  describe("update", () => {
    it("replaces the lines, sets updated_by and updated_at, and keeps created_by", async () => {
      const created = await repo.create(input([{ partyId: alId, amount: "100.00" }]), ACTOR);
      const updated = await repo.update(
        created.id,
        input([{ partyId: shahId, amount: "250.00" }], { title: "Edited" }),
        OTHER_ACTOR,
      );
      expect(updated.title).toBe("Edited");
      expect(updated.lines.map((line) => line.partyName)).toEqual(["SHAH ENTERPRISE"]);
      expect(updated.total).toBe("250.00");
      expect(updated.partyCount).toBe(1);
      expect(updated.updatedAt).not.toBeNull();

      const [row] = await db.select().from(schema.payoutLists).where(eq(schema.payoutLists.id, created.id));
      expect(row).toMatchObject({ createdBy: ACTOR, updatedBy: OTHER_ACTOR });
      expect(await db.select().from(schema.payoutListLines)).toHaveLength(1);
    });

    it("leaves the old lines alone when the new ones are refused", async () => {
      const created = await repo.create(input([{ partyId: alId, amount: "100.00" }]), ACTOR);
      await expect(repo.update(created.id, input([{ partyId: NOBODY, amount: "1.00" }]), ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect((await repo.findById(created.id)).lines.map((line) => line.partyName)).toEqual(["AL BURHAN PIPES"]);
    });

    it("404s on a list that does not exist", async () => {
      await expect(repo.update(NOBODY, input([{ partyId: alId, amount: "1.00" }]), ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("remove", () => {
    it("soft-deletes: gone from the list and detail, still in the table", async () => {
      const created = await repo.create(input([{ partyId: alId, amount: "100.00" }]), ACTOR);
      await repo.remove(created.id, ACTOR);
      await expect(repo.findById(created.id)).rejects.toBeInstanceOf(NotFoundException);
      expect(await repo.total()).toBe(0);
      await expect(repo.remove(created.id, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(await db.select().from(schema.payoutLists)).toHaveLength(1);
    });
  });

  describe("list", () => {
    const make = (listDate: string, title: string, partyId = alId) =>
      repo.create(input([{ partyId, amount: "10.00" }], { listDate, title }), ACTOR);

    it("is newest list date first, then newest typed, and pages without gaps or repeats", async () => {
      await make("2026-10-01", "old");
      await make("2026-10-05", "same day, first");
      await make("2026-10-05", "same day, second");
      await make("2026-10-03", "middle");

      const first = await repo.list(listQuerySchema.parse({ limit: 3 }));
      expect(first.rows.map((row) => row.title)).toEqual(["same day, second", "same day, first", "middle"]);
      expect(first.nextCursor).not.toBeNull();
      const second = await repo.list(listQuerySchema.parse({ limit: 3, cursor: first.nextCursor! }));
      expect(second.rows.map((row) => row.title)).toEqual(["old"]);
      expect(second.nextCursor).toBeNull();
      expect(await repo.total()).toBe(4);
    });

    it("searches the title and the party names", async () => {
      await make("2026-10-01", "Cement run", alId);
      await make("2026-10-02", "Pipes", shahId);
      const byTitle = await repo.list(listQuerySchema.parse({ search: "cement" }));
      expect(byTitle.rows.map((row) => row.title)).toEqual(["Cement run"]);
      const byParty = await repo.list(listQuerySchema.parse({ search: "shah" }));
      expect(byParty.rows.map((row) => row.title)).toEqual(["Pipes"]);
      expect(await repo.total("shah")).toBe(1);
    });

    it("carries total, party count and the creator name", async () => {
      await db.insert(schema.users).values({
        id: ACTOR,
        firstName: "Ravi",
        lastName: "Desai",
        email: "r@example.com",
        phoneNo: "9",
        userName: "ravi",
        password: "x",
      });
      await repo.create(
        input([
          { partyId: alId, amount: "10.10" },
          { partyId: shahId, amount: "20.20" },
        ]),
        ACTOR,
      );
      const [row] = (await repo.list(listQuerySchema.parse({}))).rows;
      expect(row).toMatchObject({ total: "30.30", partyCount: 2, createdByName: "Ravi Desai" });
    });
  });

  /**
   * THE BILLS UNDER A PARTY (client request, 6 Oct 2026): the owner ticks the
   * invoices he is paying, and the party's amount is their sum.
   */
  describe("bills", () => {
    it("offers each party's pending bills, oldest paid first, with what is still unpaid of each", async () => {
      const result = await repo.outstanding();
      const shah = result.rows.find((row) => row.partyId === shahId)!;
      // 1,000 invoiced and 300 paid: the one bill, 700 still to pay.
      expect(shah.invoices.map((bill) => [bill.displayNo, bill.amount, bill.pending])).toEqual([
        [expect.any(String), "1000.00", "700.00"],
      ]);
      const al = result.rows.find((row) => row.partyId === alId)!;
      expect(al.invoices.map((bill) => bill.pending).sort()).toEqual(["1500.00", "500.00"]);
      expect(al.invoices.map((bill) => bill.siteName).sort()).toEqual(["Akwada", "Surat"]);
    });

    const withBills = async () => {
      const offered = (await repo.outstanding()).rows.find((row) => row.partyId === alId)!;
      const [first, second] = offered.invoices;
      return { first: first!, second: second! };
    };

    it("keeps the bills with a line, and the line is the sum of them, whatever the form added up", async () => {
      const { first, second } = await withBills();
      const created = await repo.create(
        input([
          {
            partyId: alId,
            amount: "1.00",
            invoices: [
              { source: first.source, documentId: first.documentId, displayNo: first.displayNo, documentDate: first.documentDate, siteName: first.siteName, amount: "400.00", pending: first.pending },
              { source: second.source, documentId: second.documentId, displayNo: second.displayNo, documentDate: second.documentDate, siteName: second.siteName, amount: second.pending, pending: second.pending },
            ],
          },
        ] as never),
        ACTOR,
      );
      const [line] = created.lines;
      expect(line!.invoices).toHaveLength(2);
      expect(line!.invoices.map((bill) => bill.displayNo).sort()).toEqual([first.displayNo, second.displayNo].sort());
      const expected = (400 + Number(second.pending)).toFixed(2);
      expect(line!.amount).toBe(expected);
      expect(created.total).toBe(expected);
    });

    it("replaces the bills when the list is edited, and keeps a list with none as it was", async () => {
      const { first } = await withBills();
      const created = await repo.create(
        input([
          {
            partyId: alId,
            amount: "10.00",
            invoices: [{ source: first.source, documentId: first.documentId, displayNo: first.displayNo, amount: "10.00" }],
          },
          { partyId: shahId, amount: "50.00" },
        ] as never),
        ACTOR,
      );
      expect(created.lines.find((line) => line.partyId === shahId)!.invoices).toEqual([]);

      const edited = await repo.update(
        created.id,
        input([{ partyId: alId, amount: "75.00" }] as never),
        OTHER_ACTOR,
      );
      expect(edited.lines).toHaveLength(1);
      expect(edited.lines[0]!.invoices).toEqual([]);
      expect(edited.lines[0]!.amount).toBe("75.00");
    });
  });
});
