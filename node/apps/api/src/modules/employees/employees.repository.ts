import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type {
  CreateEmployee,
  EmployeeDetail,
  EmployeeRow,
  ListQuery,
  SalaryDue,
  SortDirection,
  UpdateEmployee,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { companies, employeeSalaryItems, employees, payoutListSalaries, payoutLists, salaryPayments, sites } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

const SORTABLE = { name: employees.name, createdAt: employees.createdAt } as const;
type EmployeeSortKey = keyof typeof SORTABLE;

/** Exact decimal on whole paise. */
const toPaise = (value: string): bigint => {
  const negative = value.trimStart().startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const paise = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  return negative ? -paise : paise;
};
const fromPaise = (paise: bigint): string => {
  const sign = paise < 0n ? "-" : "";
  const absolute = paise < 0n ? -paise : paise;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
};

/** `YYYY-MM` of a `YYYY-MM-DD…` date. */
const monthOf = (isoDate: string): string => isoDate.slice(0, 7);
/** The month after (or before, with -1) a `YYYY-MM`. */
export const shiftMonth = (month: string, by: number): string => {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (number - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};

export interface SalaryFilter {
  siteId?: string;
  companyId?: string;
  fromDate?: string;
  toDate?: string;
}

export interface EmployeeFilters {
  companyId?: string;
  /** Active only, inactive only, or both when absent. */
  active?: boolean;
}

/** The salary of a month from the master: basic + additions - deductions. */
interface Pay {
  basicSalary: string;
  additions: string;
  deductions: string;
  netSalary: string;
}

/**
 * The Employee Master (client request, 23 Oct 2026). Soft delete, like the other
 * masters; refused once a salary has been paid, so the history keeps a name.
 */
@Injectable()
export class EmployeesRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  private where(search: string | undefined, options: EmployeeFilters) {
    const filters = [eq(employees.isDeleted, false)];
    if (search) {
      const pattern = `%${search}%`;
      filters.push(or(ilike(employees.name, pattern), ilike(employees.mobile, pattern))!);
    }
    if (options.companyId) filters.push(eq(employees.companyId, options.companyId));
    if (options.active !== undefined) filters.push(eq(employees.isActive, options.active));
    return filters;
  }

  /** Additions and deductions of each employee named, summed. */
  private async payOf(ids: string[], basics: Map<string, string>): Promise<Map<string, Pay>> {
    const items = ids.length
      ? await this.db
          .select({ employeeId: employeeSalaryItems.employeeId, kind: employeeSalaryItems.kind, amount: sql<string>`${employeeSalaryItems.amount}::text` })
          .from(employeeSalaryItems)
          .where(inArray(employeeSalaryItems.employeeId, ids))
      : [];
    const pay = new Map<string, Pay>();
    for (const id of ids) {
      const add = items.filter((item) => item.employeeId === id && item.kind === "addition").reduce((sum, item) => sum + toPaise(item.amount), 0n);
      const cut = items.filter((item) => item.employeeId === id && item.kind === "deduction").reduce((sum, item) => sum + toPaise(item.amount), 0n);
      const basic = toPaise(basics.get(id) ?? "0");
      pay.set(id, { basicSalary: fromPaise(basic), additions: fromPaise(add), deductions: fromPaise(cut), netSalary: fromPaise(basic + add - cut) });
    }
    return pay;
  }

  async list(query: ListQuery, options: EmployeeFilters = {}): Promise<{ rows: Omit<EmployeeRow, "capabilities">[]; nextCursor: string | null }> {
    const sortKey: EmployeeSortKey = query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as EmployeeSortKey) : "name";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const filters = this.where(query.search, options);
    const seek = keysetWhere(sortColumn, employees.id, direction, query.cursor ? decodeCursor(query.cursor) : null);
    if (seek) filters.push(seek);

    const rows = await this.db
      .select({
        id: employees.id,
        name: employees.name,
        mobile: employees.mobile,
        companyId: employees.companyId,
        companyName: companies.name,
        siteId: employees.siteId,
        siteName: sites.name,
        joinDate: sql<string | null>`${employees.joinDate}::text`,
        basicSalary: sql<string>`${employees.basicSalary}::text`,
        isActive: employees.isActive,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(employees)
      .innerJoin(companies, eq(companies.id, employees.companyId))
      .leftJoin(sites, eq(sites.id, employees.siteId))
      .where(and(...filters))
      .orderBy(...keysetOrder(sortColumn, employees.id, direction))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    const pay = await this.payOf(
      page.rows.map((row) => row.id),
      new Map(page.rows.map((row) => [row.id, row.basicSalary])),
    );
    return {
      rows: page.rows.map(({ sortValue: _ignored, basicSalary: _basic, ...row }) => ({ ...row, ...pay.get(row.id)! })),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string, options: EmployeeFilters = {}): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(employees).where(and(...this.where(search, options)));
    return row?.value ?? 0;
  }

  async findById(id: string): Promise<EmployeeDetail> {
    const [row] = await this.db
      .select({
        id: employees.id,
        name: employees.name,
        mobile: employees.mobile,
        address: employees.address,
        companyId: employees.companyId,
        siteId: employees.siteId,
        joinDate: sql<string | null>`${employees.joinDate}::text`,
        bankName: employees.bankName,
        accountHolder: employees.accountHolder,
        accountNo: employees.accountNo,
        ifscCode: employees.ifscCode,
        basicSalary: sql<string>`${employees.basicSalary}::text`,
        isActive: employees.isActive,
        note: employees.note,
      })
      .from(employees)
      .where(and(eq(employees.id, id), eq(employees.isDeleted, false)))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Employee not found");
    }
    const items = await this.db
      .select({ kind: employeeSalaryItems.kind, label: employeeSalaryItems.label, amount: sql<string>`${employeeSalaryItems.amount}::text` })
      .from(employeeSalaryItems)
      .where(eq(employeeSalaryItems.employeeId, id))
      .orderBy(asc(employeeSalaryItems.lineNumber));
    return { ...row, items: items.map((item) => ({ ...item, kind: item.kind as "addition" | "deduction" })) };
  }

  private fields(input: CreateEmployee) {
    const { items: _items, ifscCode, ...rest } = input;
    return { ...rest, ifscCode: ifscCode ? ifscCode.toUpperCase() : null };
  }

  private async writeItems(db: Database, employeeId: string, items: CreateEmployee["items"]) {
    await db.delete(employeeSalaryItems).where(eq(employeeSalaryItems.employeeId, employeeId));
    if (items.length > 0) {
      await db.insert(employeeSalaryItems).values(items.map((item, index) => ({ employeeId, ...item, lineNumber: index + 1 })));
    }
  }

  async create(input: CreateEmployee, actorId: string): Promise<EmployeeDetail> {
    const id = await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(employees)
          .values({ ...this.fields(input), ...createdBy(actorId) })
          .returning({ id: employees.id });
        await this.writeItems(tx as unknown as Database, row!.id, input.items);
        return row!.id;
      }),
    );
    return this.findById(id);
  }

  async update(id: string, input: UpdateEmployee, actorId: string): Promise<EmployeeDetail> {
    await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(employees)
          .set({ ...this.fields(input), ...updatedBy(actorId) })
          .where(and(eq(employees.id, id), eq(employees.isDeleted, false)))
          .returning({ id: employees.id });
        if (!row) {
          throw new NotFoundException("Employee not found");
        }
        await this.writeItems(tx as unknown as Database, id, input.items);
      }),
    );
    return this.findById(id);
  }

  /** Refused once a salary is paid or listed: mark the employee inactive instead. */
  async remove(id: string, actorId: string): Promise<void> {
    const [paid] = await this.db
      .select({ value: count() })
      .from(salaryPayments)
      .where(and(eq(salaryPayments.employeeId, id), eq(salaryPayments.isDeleted, false)));
    const [listed] = await this.db
      .select({ value: count() })
      .from(payoutListSalaries)
      .innerJoin(payoutLists, eq(payoutLists.id, payoutListSalaries.payoutListId))
      .where(and(eq(payoutListSalaries.employeeId, id), eq(payoutLists.isDeleted, false)));
    if ((paid?.value ?? 0) > 0 || (listed?.value ?? 0) > 0) {
      throw new ConflictException("A salary of this employee is on a payout list or paid. Mark the employee inactive instead.");
    }
    const [row] = await this.db
      .update(employees)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(employees.id, id), eq(employees.isDeleted, false)))
      .returning({ id: employees.id });
    if (!row) {
      throw new NotFoundException("Employee not found");
    }
  }

  private paidWhere(filter: SalaryFilter) {
    const where = [eq(salaryPayments.isDeleted, false)];
    if (filter.companyId) where.push(eq(salaryPayments.companyId, filter.companyId));
    if (filter.siteId) where.push(eq(salaryPayments.siteId, filter.siteId));
    // As the ledger reads a payment's date: the day, at midnight.
    if (filter.fromDate) where.push(sql`${salaryPayments.paymentDate} >= ${filter.fromDate}::timestamptz`);
    if (filter.toDate) where.push(sql`${salaryPayments.paymentDate} <= ${filter.toDate}::timestamptz`);
    return where;
  }

  /** Salaries PAID, by the site they were paid for (the Balance Sheet, 23 Oct 2026). */
  async salaryBySite(filter: SalaryFilter): Promise<{ siteId: string | null; siteName: string | null; salary: string }[]> {
    const rows = await this.db
      .select({
        siteId: salaryPayments.siteId,
        siteName: sites.name,
        salary: sql<string>`coalesce(sum(${salaryPayments.amount}), 0)::text`,
      })
      .from(salaryPayments)
      .leftJoin(sites, eq(sites.id, salaryPayments.siteId))
      .where(and(...this.paidWhere(filter)))
      .groupBy(salaryPayments.siteId, sites.name);
    return rows;
  }

  /** One site's salaries paid, oldest first. */
  async salaryEntries(filter: SalaryFilter & { siteId: string }) {
    return this.db
      .select({
        id: salaryPayments.id,
        employeeName: employees.name,
        month: sql<string>`to_char(${salaryPayments.salaryMonth}, 'YYYY-MM')`,
        paymentDate: sql<string>`to_char(${salaryPayments.paymentDate} at time zone 'UTC', 'YYYY-MM-DD')`,
        amount: sql<string>`${salaryPayments.amount}::text`,
      })
      .from(salaryPayments)
      .innerJoin(employees, eq(employees.id, salaryPayments.employeeId))
      .where(and(...this.paidWhere(filter)))
      .orderBy(asc(salaryPayments.paymentDate), asc(employees.name));
  }

  /**
   * THE SALARIES STILL TO BE PAID on a list dated `listDate` (client, 23 Oct
   * 2026): for each active employee, every month before the list's month that has
   * no salary paid, from the employee's first month.
   *
   * The first month is the month of joining, but never earlier than the month
   * before the employee was entered here: someone who joined years ago and was
   * added today is owed last month, not every month since they joined.
   */
  async salariesDue(listDate: string, companyId?: string): Promise<SalaryDue[]> {
    const lastMonth = shiftMonth(monthOf(listDate), -1);
    const filters = [eq(employees.isDeleted, false), eq(employees.isActive, true)];
    if (companyId) filters.push(eq(employees.companyId, companyId));
    const people = await this.db
      .select({
        id: employees.id,
        name: employees.name,
        companyId: employees.companyId,
        companyName: companies.name,
        siteName: sites.name,
        joinDate: sql<string | null>`${employees.joinDate}::text`,
        createdAt: sql<string>`(${employees.createdAt} at time zone 'Asia/Kolkata')::date::text`,
        basicSalary: sql<string>`${employees.basicSalary}::text`,
      })
      .from(employees)
      .innerJoin(companies, eq(companies.id, employees.companyId))
      .leftJoin(sites, eq(sites.id, employees.siteId))
      .where(and(...filters))
      .orderBy(asc(employees.name));
    if (people.length === 0) return [];

    const ids = people.map((person) => person.id);
    const paid = await this.db
      .select({ employeeId: salaryPayments.employeeId, month: sql<string>`to_char(${salaryPayments.salaryMonth}, 'YYYY-MM')` })
      .from(salaryPayments)
      .where(and(inArray(salaryPayments.employeeId, ids), eq(salaryPayments.isDeleted, false)));
    const done = new Set(paid.map((row) => `${row.employeeId}|${row.month}`));
    const pay = await this.payOf(ids, new Map(people.map((person) => [person.id, person.basicSalary])));

    const due: SalaryDue[] = [];
    for (const person of people) {
      const floor = shiftMonth(monthOf(person.createdAt), -1);
      const joined = person.joinDate ? monthOf(person.joinDate) : floor;
      let month = joined > floor ? joined : floor;
      for (; month <= lastMonth; month = shiftMonth(month, 1)) {
        if (done.has(`${person.id}|${month}`)) continue;
        const { basicSalary, additions, deductions, netSalary } = pay.get(person.id)!;
        if (toPaise(netSalary) <= 0n) continue;
        due.push({
          employeeId: person.id,
          employeeName: person.name,
          companyId: person.companyId,
          companyName: person.companyName,
          siteName: person.siteName,
          month,
          basicSalary,
          additions,
          deductions,
          netSalary,
        });
      }
    }
    return due;
  }
}
