import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type {
  BalanceSheetPreview,
  CreateBalanceSheet,
  ListQuery,
  SavedBalanceSheetDetail,
  SavedBalanceSheetRow,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { balanceSheetRows, balanceSheets, companies, users } from "../../db/schema";
import { decodeCursor, encodeCursor } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";
import { rawRows } from "../../common/raw-rows";
import { BalanceSheetService, present, toPaise } from "./balance-sheet.service";

interface HeaderRow {
  id: string;
  title: string | null;
  note: string | null;
  company_id: string | null;
  company_name: string | null;
  income_from: string | null;
  income_to: string | null;
  invoice_from: string | null;
  invoice_to: string | null;
  project_count: number;
  income: string;
  billed: string;
  paid: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string | null;
  updated_by_name: string | null;
}

/**
 * One projection for the grid and the detail's header, so the two cannot drift.
 * The sheets table is aliased `s` and written as literal SQL: a Drizzle column
 * interpolated into `sql` renders qualified with the real table name, which an
 * alias hides.
 */
const HEADER = sql`
  select
    s.id, s.title, s.note, s.company_id, co.name as company_name,
    s.income_from::text as income_from, s.income_to::text as income_to,
    s.invoice_from::text as invoice_from, s.invoice_to::text as invoice_to,
    coalesce(t.project_count, 0)::int as project_count,
    coalesce(t.income, 0)::text as income, coalesce(t.billed, 0)::text as billed, coalesce(t.paid, 0)::text as paid,
    nullif(trim(concat_ws(' ', cu.first_name, cu.last_name)), '') as created_by_name,
    s.created_at::text as created_at, s.updated_at::text as updated_at,
    nullif(trim(concat_ws(' ', uu.first_name, uu.last_name)), '') as updated_by_name
  from ${balanceSheets} s
  left join (
    select balance_sheet_id, count(*) as project_count, sum(income) as income, sum(billed) as billed, sum(paid) as paid
    from ${balanceSheetRows} group by balance_sheet_id
  ) t on t.balance_sheet_id = s.id
  left join ${companies} co on co.id = s.company_id
  left join ${users} cu on cu.id = s.created_by
  left join ${users} uu on uu.id = s.updated_by
`;

const iso = (value: string | null): string | null => (value === null ? null : new Date(value).toISOString());

@Injectable()
export class SavedBalanceSheetsRepository extends BaseRepository {
  constructor(
    @Inject(DATABASE) database: Database | null,
    private readonly sheets: BalanceSheetService,
  ) {
    super(database);
  }

  /** The sheet as it would be worked out now, for the form's Generate. Saves nothing. */
  async preview(input: CreateBalanceSheet): Promise<BalanceSheetPreview> {
    const done = await this.sheets.generate(
      { companyId: input.companyId ?? undefined, fromDate: input.incomeFrom ?? undefined, toDate: input.incomeTo ?? undefined },
      { companyId: input.companyId ?? undefined, fromDate: input.invoiceFrom ?? undefined, toDate: input.invoiceTo ?? undefined },
    );
    return { rows: done.rows, totals: done.totals };
  }

  private where(search: string | undefined, companyId?: string): SQL[] {
    const where: SQL[] = [sql`s.is_deleted = false`];
    if (companyId) where.push(sql`s.company_id = ${companyId}::uuid`);
    if (search) {
      const pattern = `%${search}%`;
      where.push(sql`(s.title ilike ${pattern} or co.name ilike ${pattern})`);
    }
    return where;
  }

  private toRow(row: HeaderRow): Omit<SavedBalanceSheetRow, "capabilities"> {
    return {
      id: row.id,
      title: row.title,
      companyId: row.company_id,
      companyName: row.company_name,
      incomeFrom: row.income_from,
      incomeTo: row.income_to,
      invoiceFrom: row.invoice_from,
      invoiceTo: row.invoice_to,
      projectCount: row.project_count,
      figures: present({ income: toPaise(row.income), billed: toPaise(row.billed), paid: toPaise(row.paid) }),
      createdByName: row.created_by_name,
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at),
      updatedByName: row.updated_by_name,
    };
  }

  /** Newest first. The order is fixed, so `sortBy` and `sortDir` are ignored. */
  async list(
    query: ListQuery,
    companyId?: string,
  ): Promise<{ rows: Omit<SavedBalanceSheetRow, "capabilities">[]; nextCursor: string | null }> {
    const where = this.where(query.search, companyId);
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      where.push(sql`(s.created_at, s.id) < (cast(${cursor.value} as timestamptz), cast(${cursor.id} as uuid))`);
    }
    const found = rawRows<HeaderRow>(
      await this.db.execute(sql`
        ${HEADER}
        where ${sql.join(where, sql` and `)}
        order by s.created_at desc, s.id desc
        limit ${query.limit + 1}
      `),
    );
    const page = found.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      rows: page.map((row) => this.toRow(row)),
      nextCursor: found.length > query.limit && last ? encodeCursor({ value: last.created_at, id: last.id }) : null,
    };
  }

  async total(search?: string, companyId?: string): Promise<number> {
    const [row] = rawRows<{ n: number }>(
      await this.db.execute(
        sql`select count(*)::int as n from ${balanceSheets} s
            left join ${companies} co on co.id = s.company_id
            where ${sql.join(this.where(search, companyId), sql` and `)}`,
      ),
    );
    return row?.n ?? 0;
  }

  async findById(id: string): Promise<SavedBalanceSheetDetail> {
    const [header] = rawRows<HeaderRow>(
      await this.db.execute(sql`${HEADER} where s.id = ${id}::uuid and s.is_deleted = false`),
    );
    if (!header) throw new NotFoundException("Balance sheet not found");

    const lines = await this.db
      .select({
        siteId: balanceSheetRows.siteId,
        siteName: balanceSheetRows.siteName,
        income: sql<string>`${balanceSheetRows.income}::text`,
        billed: sql<string>`${balanceSheetRows.billed}::text`,
        paid: sql<string>`${balanceSheetRows.paid}::text`,
      })
      .from(balanceSheetRows)
      .where(eq(balanceSheetRows.balanceSheetId, id))
      .orderBy(asc(balanceSheetRows.lineNumber));

    return {
      ...this.toRow(header),
      note: header.note,
      rows: lines.map((line) => ({
        siteId: line.siteId,
        siteName: line.siteName,
        ...present({ income: toPaise(line.income), billed: toPaise(line.billed), paid: toPaise(line.paid) }),
      })),
    };
  }

  /** Works the sheet out on the server, from the filters alone, and keeps it with its rows. */
  async create(input: CreateBalanceSheet, actorId: string): Promise<SavedBalanceSheetDetail> {
    const worked = await this.preview(input);
    const id = await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(balanceSheets)
          .values({ ...this.header(input), ...createdBy(actorId) })
          .returning({ id: balanceSheets.id });
        await this.writeRows(tx as unknown as Database, row!.id, worked);
        return row!.id;
      }),
    );
    return this.findById(id);
  }

  /** The same body as create: the sheet is worked out afresh and its rows replaced. */
  async update(id: string, input: CreateBalanceSheet, actorId: string): Promise<SavedBalanceSheetDetail> {
    const worked = await this.preview(input);
    await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(balanceSheets)
          .set({ ...this.header(input), ...updatedBy(actorId) })
          .where(and(eq(balanceSheets.id, id), eq(balanceSheets.isDeleted, false)))
          .returning({ id: balanceSheets.id });
        if (!row) throw new NotFoundException("Balance sheet not found");
        await this.writeRows(tx as unknown as Database, id, worked);
      }),
    );
    return this.findById(id);
  }

  /** Soft delete: a sheet somebody was sent stays on record. */
  async remove(id: string, actorId: string): Promise<void> {
    const [row] = await this.db
      .update(balanceSheets)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(balanceSheets.id, id), eq(balanceSheets.isDeleted, false)))
      .returning({ id: balanceSheets.id });
    if (!row) throw new NotFoundException("Balance sheet not found");
  }

  private header(input: CreateBalanceSheet) {
    return {
      title: input.title,
      companyId: input.companyId,
      incomeFrom: input.incomeFrom,
      incomeTo: input.incomeTo,
      invoiceFrom: input.invoiceFrom,
      invoiceTo: input.invoiceTo,
      note: input.note,
    };
  }

  private async writeRows(handle: Database, sheetId: string, worked: BalanceSheetPreview): Promise<void> {
    await handle.delete(balanceSheetRows).where(eq(balanceSheetRows.balanceSheetId, sheetId));
    if (worked.rows.length === 0) return;
    await handle.insert(balanceSheetRows).values(
      worked.rows.map((row, index) => ({
        balanceSheetId: sheetId,
        siteId: row.siteId,
        siteName: row.siteName,
        income: row.income,
        billed: row.billed,
        paid: row.paid,
        lineNumber: index + 1,
      })),
    );
  }
}

