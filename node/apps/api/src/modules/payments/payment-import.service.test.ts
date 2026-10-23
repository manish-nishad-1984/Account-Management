import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { PAYMENT_IMPORT_COLUMNS } from "@accountmanagement/contracts";
import { PaymentsRepository } from "./payments.repository";
import { PaymentImportRejected, PaymentImportService } from "./payment-import.service";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";
const HEADERS = PAYMENT_IMPORT_COLUMNS.map((c) => c.header);
const row = (cells: Record<string, string>) => HEADERS.map((h) => cells[h] ?? "");

async function sheet(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Payments");
  ws.addRow(HEADERS);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const BASE = { Date: "05-10-2026", Supplier: "SHAH ENTERPRISE", Company: "DH PATEL", Site: "Akwada", Amount: "1,000" };

/** Many payments from one spreadsheet, and many deleted at once (client, 23 Oct 2026). */
describe("PaymentImportService (real PostgreSQL)", () => {
  let db: Database;
  let service: PaymentImportService;
  let repo: PaymentsRepository;

  const live = async () => (await db.select().from(schema.payments)).filter((p) => !p.isDeleted);

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new PaymentsRepository(db);
    service = new PaymentImportService(db, repo);
    const [site] = await db.insert(schema.sites).values({ name: "Akwada", isActive: true }).returning();
    await db.insert(schema.siteLocations).values({ siteId: site!.id, name: "Block A" });
    await db.insert(schema.sites).values({ name: "Surat", isActive: true });
    await db.insert(schema.suppliers).values([{ name: "SHAH ENTERPRISE" }, { name: "AL BURHAN" }]);
    await db.insert(schema.companies).values([{ name: "DH PATEL", invoicePrefix: "DHP" }, { name: "DH PATEL INFRA", invoicePrefix: "DHI" }]);
  });

  it("records one payment a row, on its own date, supplier, company and site, after the totals are verified", async () => {
    const file = await sheet([
      row({ ...BASE, "Site location": "block a", Method: "NEFT", "Reference no": "UTR1" }),
      row({ ...BASE, Date: "12/10/2026", Supplier: "al burhan", Company: "DH PATEL INFRA", Site: "Surat", Amount: "2500.50" }),
    ]);
    const preview = await service.preview(file, "out");
    expect(preview.errors).toEqual([]);
    expect(preview).toMatchObject({ rowCount: 2, paymentCount: 2, total: "3500.50" });

    await expect(service.import(file, "out", ACTOR, { count: 2, total: "999.00" })).rejects.toBeInstanceOf(BadRequestException);
    expect(await live()).toHaveLength(0);

    expect(await service.import(file, "out", ACTOR, { count: 2, total: "3500.50" })).toEqual({ created: 2, total: "3500.50" });
    const saved = await live();
    expect(saved.map((p) => [new Date(p.paymentDate!).toISOString().slice(0, 10), p.amount, p.direction, p.method]).sort()).toEqual([
      ["2026-10-05", "1000.00", "out", "NEFT"],
      ["2026-10-12", "2500.50", "out", null],
    ]);
    expect(saved.find((p) => p.method === "NEFT")!.siteLocationId).not.toBeNull();
  });

  it("names every problem with its row, and saves nothing", async () => {
    const file = await sheet([
      row({ ...BASE, Date: "31-02-2026" }),
      row({ ...BASE, Supplier: "NOBODY" }),
      row({ ...BASE, Amount: "-5" }),
      row({ ...BASE, Site: "" }),
      row({ ...BASE }),
    ]);
    const preview = await service.preview(file, "out");
    expect(preview.errors.map((e) => [e.row, e.column])).toEqual([
      [2, "Date"],
      [3, "Supplier"],
      [4, "Amount"],
      [5, "Site"],
    ]);
    await expect(service.import(file, "out", ACTOR, { count: 1, total: "1000" })).rejects.toBeInstanceOf(PaymentImportRejected);
    expect(await live()).toHaveLength(0);
  });

  it("refuses a file imported twice, and the same payment twice in one file", async () => {
    const file = await sheet([row(BASE)]);
    await service.import(file, "out", ACTOR, { count: 1, total: "1000.00" });
    const again = await service.preview(file, "out");
    expect(again.errors[0]!.message).toMatch(/already recorded/);

    const twice = await service.preview(await sheet([row({ ...BASE, Amount: "7" }), row({ ...BASE, Amount: "7.00" })]), "out");
    expect(twice.errors[0]).toMatchObject({ row: 3, message: "The same payment is on row 2 too." });
  });

  it("deletes several payments together, and refuses any made by a confirmed payout list", async () => {
    await service.import(await sheet([row(BASE), row({ ...BASE, Amount: "2000" }), row({ ...BASE, Amount: "3000" })]), "out", ACTOR, { count: 3, total: "6000.00" });
    const ids = (await live()).map((p) => p.id);

    expect(await repo.removeMany(ids.slice(0, 2), ACTOR)).toBe(2);
    expect(await live()).toHaveLength(1);
    await expect(repo.removeMany(ids.slice(0, 2), ACTOR)).rejects.toThrow(/already deleted/);

    const [list] = await db.insert(schema.payoutLists).values({ listDate: "2026-10-05", status: "confirmed" }).returning();
    await db.update(schema.payments).set({ sourcePayoutListId: list!.id });
    await expect(repo.removeMany([ids[2]!], ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(await live()).toHaveLength(1);
  });
});
