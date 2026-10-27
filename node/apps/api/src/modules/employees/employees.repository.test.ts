import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ConflictException } from "@nestjs/common";
import { createEmployeeSchema, createPayoutListSchema, confirmPayoutListSchema } from "@accountmanagement/contracts";
import { EmployeesRepository, shiftMonth } from "./employees.repository";
import { PayoutsRepository } from "../payouts/payouts.repository";
import { ReportsRepository } from "../reports/reports.repository";
import { BalanceSheetService } from "../balance-sheet/balance-sheet.service";
import { ClientIncomesRepository } from "../client-incomes/client-incomes.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

/** The Employee Master and its salaries (client request, 23 Oct 2026). */
describe("EmployeesRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: EmployeesRepository;
  let payouts: PayoutsRepository;
  let companyId: string;
  let siteId: string;

  const employee = (overrides: Record<string, unknown> = {}) =>
    repo.create(
      createEmployeeSchema.parse({
        name: "Ramesh Patel",
        companyId,
        siteId,
        joinDate: "2026-01-15",
        basicSalary: "20000",
        items: [
          { kind: "addition", label: "Travel", amount: "1500" },
          { kind: "deduction", label: "PF", amount: "1800" },
        ],
        ...overrides,
      }),
      ACTOR,
    );

  /** The month the employees were entered, as the server counts it (India time). */
  const enteredMonth = async () => {
    const [row] = await db.select({ month: sql<string>`to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM')` }).from(schema.companies).limit(1);
    return row!.month;
  };

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new EmployeesRepository(db);
    payouts = new PayoutsRepository(db, new ReportsRepository(db));
    const [company] = await db.insert(schema.companies).values({ name: "DH PATEL", invoicePrefix: "DHP" }).returning();
    companyId = company!.id;
    const [site] = await db.insert(schema.sites).values({ name: "Akwada", isActive: true }).returning();
    siteId = site!.id;
  });

  it("keeps the employee with the month's net salary: basic + additions - deductions", async () => {
    const made = await employee();
    expect(made).toMatchObject({ name: "Ramesh Patel", basicSalary: "20000.00", joinDate: "2026-01-15", isActive: true });
    expect(made.items).toHaveLength(2);
    const { rows } = await repo.list({ limit: 50, sortDir: "asc" } as never);
    expect(rows[0]).toMatchObject({ companyName: "DH PATEL", siteName: "Akwada", additions: "1500.00", deductions: "1800.00", netSalary: "19700.00" });
  });

  it("counts months across a year end", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  });

  it("offers last month's salary on a list, from the month before the employee was entered at the earliest", async () => {
    await employee();
    // Entered this month: a list dated two months on offers the three months before it.
    const entered = await enteredMonth();
    const listDate = `${shiftMonth(entered, 2)}-07`;
    const due = await repo.salariesDue(listDate);
    expect(due.map((row) => row.month)).toEqual([shiftMonth(entered, -1), entered, shiftMonth(entered, 1)]);
    expect(due[0]).toMatchObject({ employeeName: "Ramesh Patel", netSalary: "19700.00", companyName: "DH PATEL", siteName: "Akwada" });
  });

  it("starts at the month of joining when that is later, and leaves out an inactive employee", async () => {
    const entered = await enteredMonth();
    await employee({ name: "New Joiner", joinDate: `${shiftMonth(entered, 1)}-10` });
    await employee({ name: "Gone", isActive: false });
    const due = await repo.salariesDue(`${shiftMonth(entered, 3)}-07`);
    expect(due.map((row) => [row.employeeName, row.month])).toEqual([
      ["New Joiner", shiftMonth(entered, 1)],
      ["New Joiner", shiftMonth(entered, 2)],
    ]);
  });

  it("pays a salary from a confirmed list, stops offering that month, and offers it again when reversed", async () => {
    const made = await employee();
    const month = await enteredMonth();
    const listDate = `${shiftMonth(month, 1)}-07`;
    expect((await repo.salariesDue(listDate)).map((row) => row.month)).toContain(month);

    const list = await payouts.create(
      createPayoutListSchema.parse({ listDate, companyId, salaries: [{ employeeId: made.id, month, amount: "19000.00", note: "2 days leave" }] }),
      ACTOR,
    );
    expect(list.total).toBe("19000.00");
    expect(list.salaries).toEqual([
      expect.objectContaining({ employeeName: "Ramesh Patel", month, amount: "19000.00", note: "2 days leave", paidAmount: null }),
    ]);

    await payouts.confirm(
      list.id,
      confirmPayoutListSchema.parse({ paymentDate: listDate, salaries: [{ employeeId: made.id, month, paid: "19000.00" }] }),
      ACTOR,
    );
    expect((await repo.salariesDue(listDate)).map((row) => row.month)).not.toContain(month);

    // The Balance Sheet counts it under the employee's site, and takes it off both balances.
    const sheet = await new BalanceSheetService(new ClientIncomesRepository(db), new ReportsRepository(db), repo).sheet({});
    expect(sheet.rows).toEqual([expect.objectContaining({ siteName: "Akwada", salary: "19000.00", cashBalance: "-19000.00", projectResult: "-19000.00" })]);
    const detail = await new BalanceSheetService(new ClientIncomesRepository(db), new ReportsRepository(db), repo).detail(siteId, {});
    expect(detail.salaries).toEqual([expect.objectContaining({ employeeName: "Ramesh Patel", companyName: "DH PATEL", month, paymentDate: listDate, amount: "19000.00" })]);

    // Paid, so the employee cannot be deleted.
    await expect(repo.remove(made.id, ACTOR)).rejects.toBeInstanceOf(ConflictException);

    await payouts.reverse(list.id, ACTOR);
    expect((await repo.salariesDue(listDate)).map((row) => row.month)).toContain(month);
  });

  it("will not pay the same month twice from two lists", async () => {
    const made = await employee();
    const month = await enteredMonth();
    const listDate = `${shiftMonth(month, 1)}-07`;
    const body = createPayoutListSchema.parse({ listDate, salaries: [{ employeeId: made.id, month, amount: "19700.00" }] });
    const confirm = confirmPayoutListSchema.parse({ paymentDate: listDate, salaries: [{ employeeId: made.id, month, paid: "19700.00" }] });
    const one = await payouts.create(body, ACTOR);
    const two = await payouts.create(body, ACTOR);
    await payouts.confirm(one.id, confirm, ACTOR);
    await expect(payouts.confirm(two.id, confirm, ACTOR)).rejects.toThrow(/already paid/);
  });
});
