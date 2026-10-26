import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { INCOME_IMPORT_COLUMNS } from "@accountmanagement/contracts";
import { ClientIncomesRepository } from "./client-incomes.repository";
import { IncomeImportRejected, IncomeImportService } from "./income-import.service";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";
const HEADERS = INCOME_IMPORT_COLUMNS.map((c) => c.header);
const row = (cells: Record<string, string>) => HEADERS.map((h) => cells[h] ?? "");

async function sheet(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Income");
  ws.addRow(HEADERS);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const BASE = { Date: "05-10-2026", Client: "ULTRATECH", Company: "DH PATEL", Site: "Akwada", Amount: "1,00,000" };

/** Many income entries from one spreadsheet, from the balance sheet (client, 26 Oct 2026). */
describe("IncomeImportService (real PostgreSQL)", () => {
  let db: Database;
  let service: IncomeImportService;

  const live = async () => (await db.select().from(schema.clientIncomes)).filter((p) => !p.isDeleted);

  beforeEach(async () => {
    db = await freshDatabase();
    service = new IncomeImportService(db, new ClientIncomesRepository(db));
    await db.insert(schema.sites).values([{ name: "Akwada", isActive: true }, { name: "Surat", isActive: true }]);
    await db.insert(schema.clients).values([{ name: "ULTRATECH" }, { name: "JHM HOTELS" }]);
    await db.insert(schema.companies).values([{ name: "DH PATEL", invoicePrefix: "DHP" }, { name: "DH PATEL INFRA", invoicePrefix: "DHI" }]);
  });

  it("records one entry a row with its addition and deduction, after the totals are verified", async () => {
    const file = await sheet([
      row({ ...BASE, Addition: "18000", "Addition remark": "GST", Deduction: "2,000", "Deduction remark": "TDS", Method: "NEFT", "Reference no": "UTR1" }),
      row({ ...BASE, Date: "12/10/2026", Client: "jhm hotels", Company: "DH PATEL INFRA", Site: "surat", Amount: "50000.50" }),
    ]);
    const preview = await service.preview(file);
    expect(preview.errors).toEqual([]);
    expect(preview).toMatchObject({ rowCount: 2, incomeCount: 2, total: "166000.50" });
    expect(preview.incomes.map((one) => one.total)).toEqual(["116000.00", "50000.50"]);

    await expect(service.import(file, ACTOR, { count: 2, total: "1.00" })).rejects.toBeInstanceOf(BadRequestException);
    expect(await live()).toHaveLength(0);

    expect(await service.import(file, ACTOR, { count: 2, total: "166000.50" })).toEqual({ created: 2, total: "166000.50" });
    const saved = await live();
    expect(saved.map((p) => [String(p.incomeDate), p.amount, p.additionalTotal, p.deductionTotal, p.total]).sort()).toEqual([
      ["2026-10-05", "100000.00", "18000.00", "2000.00", "116000.00"],
      ["2026-10-12", "50000.50", "0.00", "0.00", "50000.50"],
    ]);
    const lines = await db.select().from(schema.clientIncomeAdjustments);
    expect(lines.map((line) => [line.kind, line.remark]).sort()).toEqual([["addition", "GST"], ["deduction", "TDS"]]);
  });

  it("names every problem with its row, and saves nothing", async () => {
    const file = await sheet([
      row({ ...BASE, Date: "31-02-2026" }),
      row({ ...BASE, Client: "NOBODY" }),
      row({ ...BASE, Amount: "-5" }),
      row({ ...BASE, Deduction: "200000" }),
      row({ ...BASE }),
    ]);
    const preview = await service.preview(file);
    expect(preview.errors.map((e) => [e.row, e.column])).toEqual([
      [2, "Date"],
      [3, "Client"],
      [4, "Amount"],
      [5, "Deduction"],
    ]);
    await expect(service.import(file, ACTOR, { count: 1, total: "100000" })).rejects.toBeInstanceOf(IncomeImportRejected);
    expect(await live()).toHaveLength(0);
  });

  it("refuses an entry already recorded, or twice in the file", async () => {
    const first = await sheet([row(BASE)]);
    await service.import(first, ACTOR, { count: 1, total: "100000" });
    const again = await sheet([row({ ...BASE, Date: "06-10-2026" }), row({ ...BASE, Date: "06-10-2026" }), row(BASE)]);
    const preview = await service.preview(again);
    expect(preview.errors.map((e) => e.row)).toEqual([3, 4]);
  });
});
