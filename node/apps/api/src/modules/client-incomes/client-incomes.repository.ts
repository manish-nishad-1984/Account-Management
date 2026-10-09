import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, eq, ilike, or, sql } from "drizzle-orm";
import type {
  ClientIncomeDetail,
  ClientIncomeFilter,
  CreateClientIncome,
  ListQuery,
  SortDirection,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { clientIncomeAdjustments, clientIncomes, clients, companies, sites } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

const SORTABLE = {
  incomeDate: clientIncomes.incomeDate,
  total: clientIncomes.total,
  createdAt: clientIncomes.createdAt,
} as const;
type IncomeSortKey = keyof typeof SORTABLE;

/** Exact decimal on whole paise: money never goes through a float here. */
const toPaise = (value: string): bigint => {
  const [whole, fraction = ""] = value.trim().split(".");
  return BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
};
const fromPaise = (paise: bigint): string => {
  const sign = paise < 0n ? "-" : "";
  const absolute = paise < 0n ? -paise : paise;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
};

export interface ClientIncomeListRow {
  id: string;
  incomeDate: string;
  siteId: string;
  siteName: string;
  companyId: string;
  companyName: string;
  clientId: string;
  clientName: string;
  amount: string;
  additionalTotal: string;
  deductionTotal: string;
  total: string;
  method: string | null;
  referenceNo: string | null;
  createdAt: string;
}

/**
 * Income: what a project's client has paid us. See `contracts/client-incomes.ts`.
 *
 * The FINAL TOTAL is worked out here from the amount and the lines, in whole
 * paise, never taken from the request: amount + additions - deductions.
 */
@Injectable()
export class ClientIncomesRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  private where(search: string | undefined, filter: ClientIncomeFilter) {
    const where = [eq(clientIncomes.isDeleted, false)];
    if (filter.siteId) where.push(eq(clientIncomes.siteId, filter.siteId));
    if (filter.companyId) where.push(eq(clientIncomes.companyId, filter.companyId));
    if (filter.clientId) where.push(eq(clientIncomes.clientId, filter.clientId));
    if (search) {
      const pattern = `%${search}%`;
      where.push(
        or(
          ilike(clients.name, pattern),
          ilike(sites.name, pattern),
          ilike(clientIncomes.referenceNo, pattern),
        )!,
      );
    }
    return where;
  }

  async list(
    query: ListQuery,
    filter: ClientIncomeFilter = {},
  ): Promise<{ rows: ClientIncomeListRow[]; nextCursor: string | null }> {
    const sortKey: IncomeSortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as IncomeSortKey) : "incomeDate";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const where = this.where(query.search, filter);
    const seek = keysetWhere(
      sortColumn,
      clientIncomes.id,
      direction,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    if (seek) where.push(seek);

    const rows = await this.db
      .select({
        id: clientIncomes.id,
        incomeDate: sql<string>`${clientIncomes.incomeDate}::text`,
        siteId: clientIncomes.siteId,
        siteName: sites.name,
        companyId: clientIncomes.companyId,
        companyName: companies.name,
        clientId: clientIncomes.clientId,
        clientName: clients.name,
        amount: sql<string>`${clientIncomes.amount}::text`,
        additionalTotal: sql<string>`${clientIncomes.additionalTotal}::text`,
        deductionTotal: sql<string>`${clientIncomes.deductionTotal}::text`,
        total: sql<string>`${clientIncomes.total}::text`,
        method: clientIncomes.method,
        referenceNo: clientIncomes.referenceNo,
        createdAt: sql<string>`${clientIncomes.createdAt}`,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(clientIncomes)
      .innerJoin(sites, eq(sites.id, clientIncomes.siteId))
      .innerJoin(companies, eq(companies.id, clientIncomes.companyId))
      .innerJoin(clients, eq(clients.id, clientIncomes.clientId))
      .where(and(...where))
      .orderBy(...keysetOrder(sortColumn, clientIncomes.id, direction))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    return {
      rows: page.rows.map(({ sortValue: _ignored, createdAt, ...row }) => ({
        ...row,
        createdAt: new Date(createdAt).toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string, filter: ClientIncomeFilter = {}): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(clientIncomes)
      .innerJoin(sites, eq(sites.id, clientIncomes.siteId))
      .innerJoin(clients, eq(clients.id, clientIncomes.clientId))
      .where(and(...this.where(search, filter)));
    return row?.value ?? 0;
  }

  /** The Final Totals of everything the filters match, for the list's footer. */
  async sumOf(search?: string, filter: ClientIncomeFilter = {}): Promise<string> {
    const [row] = await this.db
      .select({ value: sql<string>`coalesce(sum(${clientIncomes.total}), 0)::text` })
      .from(clientIncomes)
      .innerJoin(sites, eq(sites.id, clientIncomes.siteId))
      .innerJoin(clients, eq(clients.id, clientIncomes.clientId))
      .where(and(...this.where(search, filter)));
    return fromPaise(toPaise(row?.value ?? "0"));
  }

  /** The conditions the Balance Sheet puts on income: project, company and a date range. */
  private balanceWhere(filter: { siteId?: string; companyId?: string; fromDate?: string; toDate?: string }) {
    const where = [eq(clientIncomes.isDeleted, false)];
    if (filter.siteId) where.push(eq(clientIncomes.siteId, filter.siteId));
    if (filter.companyId) where.push(eq(clientIncomes.companyId, filter.companyId));
    if (filter.fromDate) where.push(sql`${clientIncomes.incomeDate} >= ${filter.fromDate}::date`);
    if (filter.toDate) where.push(sql`${clientIncomes.incomeDate} <= ${filter.toDate}::date`);
    return and(...where);
  }

  /** Income per project - the Final Totals added up - for the site-wise Balance Sheet. */
  async incomeBySite(filter: {
    siteId?: string;
    companyId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ siteId: string; siteName: string; income: string }[]> {
    const rows = await this.db
      .select({
        siteId: clientIncomes.siteId,
        siteName: sites.name,
        income: sql<string>`coalesce(sum(${clientIncomes.total}), 0)::text`,
      })
      .from(clientIncomes)
      .innerJoin(sites, eq(sites.id, clientIncomes.siteId))
      .where(this.balanceWhere(filter))
      .groupBy(clientIncomes.siteId, sites.name);
    return rows.map((row) => ({ ...row, income: fromPaise(toPaise(row.income)) }));
  }

  /** The entries behind one project's income, newest first. */
  async incomeEntries(filter: {
    siteId?: string;
    companyId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ id: string; incomeDate: string; clientName: string; companyName: string; total: string }[]> {
    return this.db
      .select({
        id: clientIncomes.id,
        incomeDate: sql<string>`${clientIncomes.incomeDate}::text`,
        clientName: clients.name,
        companyName: companies.name,
        total: sql<string>`${clientIncomes.total}::text`,
      })
      .from(clientIncomes)
      .innerJoin(clients, eq(clients.id, clientIncomes.clientId))
      .innerJoin(companies, eq(companies.id, clientIncomes.companyId))
      .where(this.balanceWhere(filter))
      .orderBy(sql`${clientIncomes.incomeDate} desc`, clientIncomes.id);
  }

  async findById(id: string): Promise<ClientIncomeDetail> {
    const [row] = await this.db
      .select({
        id: clientIncomes.id,
        incomeDate: sql<string>`${clientIncomes.incomeDate}::text`,
        siteId: clientIncomes.siteId,
        companyId: clientIncomes.companyId,
        clientId: clientIncomes.clientId,
        amount: sql<string>`${clientIncomes.amount}::text`,
        additionalTotal: sql<string>`${clientIncomes.additionalTotal}::text`,
        deductionTotal: sql<string>`${clientIncomes.deductionTotal}::text`,
        total: sql<string>`${clientIncomes.total}::text`,
        method: clientIncomes.method,
        referenceNo: clientIncomes.referenceNo,
        note: clientIncomes.note,
        createdAt: sql<string>`${clientIncomes.createdAt}`,
      })
      .from(clientIncomes)
      .where(and(eq(clientIncomes.id, id), eq(clientIncomes.isDeleted, false)))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Income not found");
    }

    const lines = await this.db
      .select({
        kind: clientIncomeAdjustments.kind,
        amount: sql<string>`${clientIncomeAdjustments.amount}::text`,
        remark: clientIncomeAdjustments.remark,
      })
      .from(clientIncomeAdjustments)
      .where(eq(clientIncomeAdjustments.incomeId, id))
      .orderBy(asc(clientIncomeAdjustments.lineNumber));

    const pick = (kind: string) =>
      lines.filter((line) => line.kind === kind).map(({ amount, remark }) => ({ amount, remark }));
    return {
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
      additions: pick("addition"),
      deductions: pick("deduction"),
    };
  }

  /** amount + additions - deductions, in whole paise. */
  private totals(input: CreateClientIncome) {
    const sum = (lines: { amount: string }[]) => lines.reduce((acc, line) => acc + toPaise(line.amount), 0n);
    const additions = sum(input.additions);
    const deductions = sum(input.deductions);
    return {
      additional: fromPaise(additions),
      deduction: fromPaise(deductions),
      total: fromPaise(toPaise(input.amount) + additions - deductions),
    };
  }

  private async writeLines(tx: Database, incomeId: string, input: CreateClientIncome) {
    await tx.delete(clientIncomeAdjustments).where(eq(clientIncomeAdjustments.incomeId, incomeId));
    const lines = [
      ...input.additions.map((line) => ({ kind: "addition", ...line })),
      ...input.deductions.map((line) => ({ kind: "deduction", ...line })),
    ].map((line, index) => ({
      incomeId,
      kind: line.kind,
      amount: line.amount,
      remark: line.remark,
      lineNumber: index + 1,
    }));
    if (lines.length > 0) await tx.insert(clientIncomeAdjustments).values(lines);
  }

  private fields(input: CreateClientIncome) {
    const totals = this.totals(input);
    return {
      incomeDate: input.incomeDate,
      siteId: input.siteId,
      companyId: input.companyId,
      clientId: input.clientId,
      amount: input.amount,
      additionalTotal: totals.additional,
      deductionTotal: totals.deduction,
      total: totals.total,
      method: input.method,
      referenceNo: input.referenceNo,
      note: input.note,
    };
  }

  async create(input: CreateClientIncome, actorId: string): Promise<ClientIncomeDetail> {
    const id = await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(clientIncomes)
          .values({ ...this.fields(input), ...createdBy(actorId) })
          .returning({ id: clientIncomes.id });
        await this.writeLines(tx as unknown as Database, row!.id, input);
        return row!.id;
      }),
    );
    return this.findById(id);
  }

  /** The whole entry is sent and replaces the old one, lines included. */
  async update(id: string, input: CreateClientIncome, actorId: string): Promise<ClientIncomeDetail> {
    await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(clientIncomes)
          .set({ ...this.fields(input), ...updatedBy(actorId) })
          .where(and(eq(clientIncomes.id, id), eq(clientIncomes.isDeleted, false)))
          .returning({ id: clientIncomes.id });
        if (!row) {
          throw new NotFoundException("Income not found");
        }
        await this.writeLines(tx as unknown as Database, id, input);
      }),
    );
    return this.findById(id);
  }

  /** Soft delete: the money was received; the record of it is kept. */
  async remove(id: string, actorId: string): Promise<void> {
    const [row] = await this.db
      .update(clientIncomes)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(clientIncomes.id, id), eq(clientIncomes.isDeleted, false)))
      .returning({ id: clientIncomes.id });
    if (!row) {
      throw new NotFoundException("Income not found");
    }
  }
}
