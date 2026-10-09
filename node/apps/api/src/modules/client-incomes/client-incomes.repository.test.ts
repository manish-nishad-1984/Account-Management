import { beforeEach, describe, expect, it } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import {
  createClientIncomeSchema,
  createClientSchema,
  listQuerySchema,
  type CreateClientIncome,
} from "@accountmanagement/contracts";
import { ClientIncomesRepository } from "./client-incomes.repository";
import { ClientsRepository } from "../clients/clients.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";
const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

/**
 * Income (9 Oct 2026): what a project's client has paid, for a site, received in
 * a company. FINAL TOTAL = amount + additions - deductions, worked out by the
 * server in whole paise.
 */
describe("ClientIncomesRepository (real PostgreSQL)", () => {
  let db: Database;
  let incomes: ClientIncomesRepository;
  let clients: ClientsRepository;
  let siteId: string;
  let otherSiteId: string;
  let companyId: string;
  let otherCompanyId: string;
  let clientId: string;

  const income = (overrides: Record<string, unknown> = {}): CreateClientIncome =>
    createClientIncomeSchema.parse({
      incomeDate: "2026-10-05",
      siteId,
      companyId,
      clientId,
      amount: "1000000.00",
      ...overrides,
    });

  beforeEach(async () => {
    db = await freshDatabase();
    incomes = new ClientIncomesRepository(db);
    clients = new ClientsRepository(db);

    const madeSites = await db
      .insert(schema.sites)
      .values([
        { name: "Akwada Lake Front", isActive: true },
        { name: "Surat Diamond Park", isActive: true },
      ])
      .returning({ id: schema.sites.id, name: schema.sites.name });
    siteId = madeSites.find((s) => s.name.startsWith("Akwada"))!.id;
    otherSiteId = madeSites.find((s) => s.name.startsWith("Surat"))!.id;

    const madeCompanies = await db
      .insert(schema.companies)
      .values([{ name: "DH Patel" }, { name: "DH Maharaj" }])
      .returning({ id: schema.companies.id, name: schema.companies.name });
    companyId = madeCompanies.find((c) => c.name === "DH Patel")!.id;
    otherCompanyId = madeCompanies.find((c) => c.name === "DH Maharaj")!.id;

    clientId = (await clients.create(createClientSchema.parse({ name: "Shah Developers", siteIds: [siteId] }), ACTOR)).id;
  });

  it("works the final total out as amount plus additions minus deductions", async () => {
    const saved = await incomes.create(
      income({
        additions: [{ amount: "50000.00", remark: "Extra work" }],
        deductions: [
          { amount: "20000.00", remark: "TDS" },
          { amount: "5000.50", remark: "Discount" },
        ],
      }),
      ACTOR,
    );

    expect(saved.amount).toBe("1000000.00");
    expect(saved.total).toBe("1024999.50");
    expect(saved.additions).toEqual([{ amount: "50000.00", remark: "Extra work" }]);
    expect(saved.deductions.map((line) => line.remark)).toEqual(["TDS", "Discount"]);
  });

  it("takes the total from the lines, never from the request", async () => {
    const saved = await incomes.create({ ...income(), total: "1.00" } as CreateClientIncome, ACTOR);
    expect(saved.total).toBe("1000000.00");
  });

  it("keeps site and company independent, so the same site can be paid into either company", async () => {
    await incomes.create(income({ companyId }), ACTOR);
    await incomes.create(income({ companyId: otherCompanyId, amount: "250000.00" }), ACTOR);

    const rows = (await incomes.list(query(), { siteId })).rows;
    expect(rows.map((row) => row.companyName).sort()).toEqual(["DH Maharaj", "DH Patel"]);
    expect((await incomes.list(query(), { companyId: otherCompanyId })).rows).toHaveLength(1);
  });

  it("filters by site and adds up the final totals of what the filter matches", async () => {
    await incomes.create(income({ amount: "100.00", deductions: [{ amount: "10.00" }] }), ACTOR);
    await incomes.create(income({ amount: "200.00" }), ACTOR);
    await incomes.create(income({ siteId: otherSiteId, amount: "999.00" }), ACTOR);

    expect(await incomes.sumOf(undefined, { siteId })).toBe("290.00");
    expect(await incomes.total(undefined, { siteId })).toBe(2);
    expect(await incomes.sumOf(undefined, {})).toBe("1289.00");
  });

  it("replaces the lines as a whole when the entry is edited", async () => {
    const saved = await incomes.create(income({ additions: [{ amount: "5.00", remark: "old" }] }), ACTOR);

    const edited = await incomes.update(
      saved.id,
      income({ amount: "10.00", deductions: [{ amount: "3.00", remark: "TDS" }] }),
      ACTOR,
    );

    expect(edited.additions).toEqual([]);
    expect(edited.deductions).toEqual([{ amount: "3.00", remark: "TDS" }]);
    expect(edited.total).toBe("7.00");
  });

  it("lists newest first by the date received", async () => {
    await incomes.create(income({ incomeDate: "2026-09-01" }), ACTOR);
    await incomes.create(income({ incomeDate: "2026-10-09" }), ACTOR);
    const dates = (await incomes.list(query({ sortDir: "desc" }))).rows.map((row) => row.incomeDate);
    expect(dates).toEqual(["2026-10-09", "2026-09-01"]);
  });

  it("soft deletes an entry, and a client with income cannot be deleted", async () => {
    const saved = await incomes.create(income(), ACTOR);
    await expect(clients.remove(clientId, ACTOR)).rejects.toBeInstanceOf(ConflictException);

    await incomes.remove(saved.id, ACTOR);
    await expect(incomes.findById(saved.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await incomes.total()).toBe(0);
    await expect(clients.remove(clientId, ACTOR)).resolves.toBeUndefined();
  });

  it("refuses an amount of zero, or a line of zero", () => {
    expect(createClientIncomeSchema.safeParse({ ...income(), amount: "0.00" }).success).toBe(false);
    expect(
      createClientIncomeSchema.safeParse({ ...income(), deductions: [{ amount: "0", remark: "x" }] }).success,
    ).toBe(false);
  });
});

describe("ClientsRepository (real PostgreSQL)", () => {
  let db: Database;
  let clients: ClientsRepository;
  let siteId: string;
  let otherSiteId: string;

  beforeEach(async () => {
    db = await freshDatabase();
    clients = new ClientsRepository(db);
    const made = await db
      .insert(schema.sites)
      .values([
        { name: "Akwada Lake Front", isActive: true },
        { name: "Surat Diamond Park", isActive: true },
      ])
      .returning({ id: schema.sites.id, name: schema.sites.name });
    siteId = made.find((s) => s.name.startsWith("Akwada"))!.id;
    otherSiteId = made.find((s) => s.name.startsWith("Surat"))!.id;
  });

  it("links a client to its projects and offers it only for those", async () => {
    await clients.create(createClientSchema.parse({ name: "Shah Developers", siteIds: [siteId] }), ACTOR);
    await clients.create(createClientSchema.parse({ name: "Patel Group", siteIds: [otherSiteId] }), ACTOR);
    await clients.create(createClientSchema.parse({ name: "Both", siteIds: [siteId, otherSiteId] }), ACTOR);

    const forSite = await clients.list(query(), { siteId });
    expect(forSite.rows.map((row) => row.name)).toEqual(["Both", "Shah Developers"]);
    expect(forSite.rows[0]!.siteNames).toEqual(["Akwada Lake Front", "Surat Diamond Park"]);
    expect(await clients.total(undefined, { siteId })).toBe(2);
  });

  it("replaces the links on an edit, and leaves them alone when none are sent", async () => {
    const made = await clients.create(createClientSchema.parse({ name: "Shah", siteIds: [siteId] }), ACTOR);

    const renamed = await clients.update(made.id, { name: "Shah Developers" }, ACTOR);
    expect(renamed.siteIds).toEqual([siteId]);

    const moved = await clients.update(made.id, { siteIds: [otherSiteId] }, ACTOR);
    expect(moved.siteIds).toEqual([otherSiteId]);
  });

  it("upper-cases GST and PAN, and 404s a deleted client", async () => {
    const made = await clients.create(createClientSchema.parse({ name: "Shah", gstNo: "24aacd1234a1z5" }), ACTOR);
    expect(made.gstNo).toBe("24AACD1234A1Z5");
    await clients.remove(made.id, ACTOR);
    await expect(clients.findById(made.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
