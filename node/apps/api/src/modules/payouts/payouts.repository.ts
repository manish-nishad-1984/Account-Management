import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type {
  CreatePayoutList,
  ListQuery,
  PayoutListDetail,
  PayoutListRow,
  PayoutInvoiceInput,
  PayoutOutstandingResponse,
  PayoutPendingInvoice,
  UpdatePayoutList,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { payoutListInvoices, payoutListLines, payoutLists, suppliers, users } from "../../db/schema";
import { decodeCursor, encodeCursor } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";
import { rawRows } from "../../common/raw-rows";
import { ReportsRepository } from "../reports/reports.repository";

/** The most `balances` hands back in one page (MAX_PAGE_SIZE). */
const BALANCES_PAGE = 200;

/** Exact decimal on whole paise: money never goes through a float here. */
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

interface Owed {
  partyId: string;
  partyName: string;
  paise: bigint;
}

interface HeaderRow {
  id: string;
  list_date: string;
  title: string | null;
  budget: string | null;
  note: string | null;
  total: string;
  party_count: number;
  created_by_name: string | null;
  created_at: string;
  updated_at: string | null;
  updated_by_name: string | null;
  sort_key: string;
}

/**
 * One projection for the grid and for the detail's header, so the two cannot
 * drift. The lists table is aliased `l` and written as literal SQL: a Drizzle
 * column interpolated into `sql` renders qualified with the real table name,
 * which an alias hides (§7.1).
 */
const HEADER = sql`
  select
    l.id, l.list_date::text as list_date, l.title, l.budget::text as budget, l.note,
    coalesce(t.total, 0)::text as total, coalesce(t.party_count, 0)::int as party_count,
    nullif(trim(concat_ws(' ', cu.first_name, cu.last_name)), '') as created_by_name,
    l.created_at::text as created_at, l.updated_at::text as updated_at,
    nullif(trim(concat_ws(' ', uu.first_name, uu.last_name)), '') as updated_by_name,
    l.list_date::text || '|' || l.created_at::text as sort_key
  from ${payoutLists} l
  left join (
    select payout_list_id, sum(amount) as total, count(*) as party_count
    from ${payoutListLines} group by payout_list_id
  ) t on t.payout_list_id = l.id
  left join ${users} cu on cu.id = l.created_by
  left join ${users} uu on uu.id = l.updated_by
`;

const iso = (value: string | null): string | null => (value === null ? null : new Date(value).toISOString());

@Injectable()
export class PayoutsRepository extends BaseRepository {
  constructor(
    @Inject(DATABASE) database: Database | null,
    private readonly reports: ReportsRepository,
  ) {
    super(database);
  }

  /**
   * WHAT EACH SUPPLIER IS OWED, taken from the Pending Outstanding report
   * itself rather than re-derived, so a list and that report cannot disagree.
   *
   * The report groups by (site, party); a party's outstanding is the sum of its
   * site rows, and only a positive sum is money we owe. A supplier overpaid at
   * one site and owed at another nets across sites.
   *
   * PERMISSION WIDENING, on purpose: this reads the numbers behind
   * `reports-payments.view` for anyone holding `payout.view`. A payout list is
   * useless without the outstanding beside each party, and migration 0022 grants
   * `payout` only to people who already hold that report.
   */
  private async owedByParty(): Promise<Map<string, Owed>> {
    const sums = new Map<string, Owed>();
    for (let offset = 0; ; offset += BALANCES_PAGE) {
      const page = await this.reports.balances(
        { direction: "out", show: "outstanding" },
        { limit: BALANCES_PAGE, offset },
      );
      for (const row of page.rows) {
        const seen = sums.get(row.partyId);
        sums.set(row.partyId, {
          partyId: row.partyId,
          partyName: row.partyName,
          paise: (seen?.paise ?? 0n) + toPaise(row.netAmount),
        });
      }
      if (page.nextCursor === null) {
        break;
      }
    }
    for (const [partyId, owed] of sums) {
      if (owed.paise <= 0n) {
        sums.delete(partyId);
      }
    }
    return sums;
  }

  /**
   * THE BILLS STILL TO BE PAID, per party, from the Pending Outstanding report's
   * own pending ledger (payments settle the oldest bill first), so a list shows
   * the same bills that report does. Oldest first, which is the order they should
   * be paid in.
   */
  private async pendingByParty(): Promise<Map<string, PayoutPendingInvoice[]>> {
    const byParty = new Map<string, PayoutPendingInvoice[]>();
    for (let offset = 0; ; offset += BALANCES_PAGE) {
      const page = await this.reports.pendingLedger({ direction: "out" }, { limit: BALANCES_PAGE, offset });
      for (const row of page.rows) {
        const list = byParty.get(row.partyId) ?? [];
        list.push({
          source: row.source,
          documentId: row.documentId,
          displayNo: row.displayNo,
          documentDate: row.documentDate,
          siteName: row.siteName,
          amount: row.amount,
          pending: row.pending,
        });
        byParty.set(row.partyId, list);
      }
      if (page.nextCursor === null) {
        break;
      }
    }
    for (const list of byParty.values()) {
      list.sort((a, b) => (a.documentDate ?? "").localeCompare(b.documentDate ?? "") || a.displayNo.localeCompare(b.displayNo));
    }
    return byParty;
  }

  async outstanding(): Promise<PayoutOutstandingResponse> {
    const owed = [...(await this.owedByParty()).values()].sort(
      (a, b) => a.partyName.localeCompare(b.partyName) || a.partyId.localeCompare(b.partyId),
    );
    const bills = await this.pendingByParty();
    const total = owed.reduce((sum, row) => sum + row.paise, 0n);
    return {
      rows: owed.map((row) => ({
        partyId: row.partyId,
        partyName: row.partyName,
        outstanding: fromPaise(row.paise),
        invoices: bills.get(row.partyId) ?? [],
      })),
      total: fromPaise(total),
    };
  }

  /** Live lists; the search matches the title or any party's name on the list. */
  private where(search: string | undefined): SQL[] {
    const where: SQL[] = [sql`l.is_deleted = false`];
    if (search) {
      const pattern = `%${search}%`;
      where.push(
        sql`(l.title ilike ${pattern} or exists (
          select 1 from ${payoutListLines} x join ${suppliers} s on s.id = x.party_id
          where x.payout_list_id = l.id and s.name ilike ${pattern}))`,
      );
    }
    return where;
  }

  /**
   * Newest list date first, then newest typed. The order is fixed, so `sortBy`
   * and `sortDir` are ignored: the screen offers no other, and `keysetWhere`
   * cannot express a two-column key. The cursor value is `date|created_at` as
   * text, cast back in SQL for an exact round trip, compared as a row.
   */
  async list(query: ListQuery): Promise<{ rows: Omit<PayoutListRow, "capabilities">[]; nextCursor: string | null }> {
    const where = this.where(query.search);
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      const [date, createdAt] = cursor.value.split("|");
      if (!date || !createdAt) {
        throw new BadRequestException("Malformed cursor");
      }
      where.push(
        sql`(l.list_date, l.created_at, l.id)
            < (cast(${date} as date), cast(${createdAt} as timestamptz), cast(${cursor.id} as uuid))`,
      );
    }

    const found = rawRows<HeaderRow>(
      await this.db.execute(sql`
        ${HEADER}
        where ${sql.join(where, sql` and `)}
        order by l.list_date desc, l.created_at desc, l.id desc
        limit ${query.limit + 1}
      `),
    );

    const page = found.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      rows: page.map((row) => this.toRow(row)),
      nextCursor: found.length > query.limit && last ? encodeCursor({ value: last.sort_key, id: last.id }) : null,
    };
  }

  async total(search?: string): Promise<number> {
    const [row] = rawRows<{ n: number }>(
      await this.db.execute(
        sql`select count(*)::int as n from ${payoutLists} l where ${sql.join(this.where(search), sql` and `)}`,
      ),
    );
    return row?.n ?? 0;
  }

  private toRow(row: HeaderRow): Omit<PayoutListRow, "capabilities"> {
    return {
      id: row.id,
      listDate: row.list_date,
      title: row.title,
      budget: row.budget,
      total: row.total,
      partyCount: row.party_count,
      createdByName: row.created_by_name,
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at),
      updatedByName: row.updated_by_name,
    };
  }

  async findById(id: string): Promise<PayoutListDetail> {
    const [header] = rawRows<HeaderRow>(
      await this.db.execute(sql`${HEADER} where l.id = ${id} and l.is_deleted = false`),
    );
    if (!header) {
      throw new NotFoundException("Payout list not found");
    }

    const lines = await this.db
      .select({
        id: payoutListLines.id,
        partyId: payoutListLines.partyId,
        partyName: suppliers.name,
        amount: sql<string>`${payoutListLines.amount}::text`,
        outstandingAtSave: sql<string | null>`${payoutListLines.outstandingAtSave}::text`,
      })
      .from(payoutListLines)
      .innerJoin(suppliers, eq(suppliers.id, payoutListLines.partyId))
      .where(eq(payoutListLines.payoutListId, id))
      .orderBy(asc(payoutListLines.lineNumber));

    const bills = lines.length
      ? await this.db
          .select({
            lineId: payoutListInvoices.payoutLineId,
            source: payoutListInvoices.source,
            documentId: payoutListInvoices.documentId,
            displayNo: payoutListInvoices.displayNo,
            documentDate: sql<string | null>`${payoutListInvoices.documentDate}::text`,
            siteName: payoutListInvoices.siteName,
            amount: sql<string>`${payoutListInvoices.amount}::text`,
            pendingAtSave: sql<string | null>`${payoutListInvoices.pendingAtSave}::text`,
          })
          .from(payoutListInvoices)
          .where(inArray(payoutListInvoices.payoutLineId, lines.map((line) => line.id)))
          .orderBy(asc(payoutListInvoices.lineNumber))
      : [];

    const owed = await this.owedByParty();
    return {
      ...this.toRow(header),
      note: header.note,
      lines: lines.map((line) => ({
        ...line,
        outstandingNow: fromPaise(owed.get(line.partyId)?.paise ?? 0n),
        invoices: bills
          .filter((bill) => bill.lineId === line.id)
          .map(({ lineId: _lineId, source, ...rest }) => ({ source: source as "invoice" | "opening_balance", ...rest })),
      })),
    };
  }

  async create(input: CreatePayoutList, actorId: string): Promise<PayoutListDetail> {
    const lines = await this.priced(input);
    const id = await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(payoutLists)
          .values({
            listDate: input.listDate,
            title: input.title,
            budget: input.budget,
            note: input.note,
            ...createdBy(actorId),
          })
          .returning({ id: payoutLists.id });
        await this.writeLines(tx as unknown as Database, row!.id, lines);
        return row!.id;
      }),
    );
    return this.findById(id);
  }

  /** Replaces the lines as a whole, in one transaction with the header. */
  async update(id: string, input: UpdatePayoutList, actorId: string): Promise<PayoutListDetail> {
    const lines = await this.priced(input);
    await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(payoutLists)
          .set({
            listDate: input.listDate,
            title: input.title,
            budget: input.budget,
            note: input.note,
            ...updatedBy(actorId),
          })
          .where(and(eq(payoutLists.id, id), eq(payoutLists.isDeleted, false)))
          .returning({ id: payoutLists.id });
        if (!row) {
          throw new NotFoundException("Payout list not found");
        }
        await this.writeLines(tx as unknown as Database, id, lines);
      }),
    );
    return this.findById(id);
  }

  /** Soft delete: a list somebody sent on WhatsApp stays on record. */
  async remove(id: string, actorId: string): Promise<void> {
    const [row] = await this.db
      .update(payoutLists)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(payoutLists.id, id), eq(payoutLists.isDeleted, false)))
      .returning({ id: payoutLists.id });
    if (!row) {
      throw new NotFoundException("Payout list not found");
    }
  }

  /**
   * Every party must exist and be live, and each line is priced with what is
   * owed right now.
   *
   * `suppliers` is the one party table (a "customer" on a sales invoice is a row
   * in it too), so "a real supplier" means a live row there. Checked here rather
   * than left to the foreign key: its violation arrives as a generic 409 naming
   * nothing, and a SOFT-deleted party would not trip it at all.
   */
  private async priced(input: CreatePayoutList) {
    const ids = input.lines.map((line) => line.partyId);
    const live = await this.db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(inArray(suppliers.id, ids), eq(suppliers.isDeleted, false)));
    const known = new Set(live.map((row) => row.id));
    const missing = input.lines.findIndex((line) => !known.has(line.partyId));
    if (missing !== -1) {
      const message = "This party does not exist, or has been deleted";
      throw new BadRequestException({ message, issues: [{ path: `lines.${missing}.partyId`, message }] });
    }

    const owed = await this.owedByParty();
    return input.lines.map((line, index) => ({
      partyId: line.partyId,
      // With bills, the line IS their sum: whatever the form added up is not trusted.
      amount: line.invoices.length
        ? fromPaise(line.invoices.reduce((sum, bill) => sum + toPaise(bill.amount), 0n))
        : line.amount,
      invoices: line.invoices,
      outstandingAtSave: fromPaise(owed.get(line.partyId)?.paise ?? 0n),
      lineNumber: index + 1,
    }));
  }

  private async writeLines(
    db: Database,
    payoutListId: string,
    lines: {
      partyId: string;
      amount: string;
      invoices: PayoutInvoiceInput[];
      outstandingAtSave: string;
      lineNumber: number;
    }[],
  ) {
    // The bills go with their line (ON DELETE CASCADE), so clearing the lines clears both.
    await db.delete(payoutListLines).where(eq(payoutListLines.payoutListId, payoutListId));
    const saved = await db
      .insert(payoutListLines)
      .values(
        lines.map(({ invoices: _invoices, ...line }) => ({ payoutListId, ...line })),
      )
      .returning({ id: payoutListLines.id, partyId: payoutListLines.partyId });
    const lineOf = new Map(saved.map((row) => [row.partyId, row.id]));

    const bills = lines.flatMap((line) =>
      line.invoices.map((bill, index) => ({
        payoutLineId: lineOf.get(line.partyId)!,
        source: bill.source,
        documentId: bill.documentId,
        displayNo: bill.displayNo,
        documentDate: bill.documentDate ?? null,
        siteName: bill.siteName ?? null,
        amount: bill.amount,
        pendingAtSave: bill.pending ?? null,
        lineNumber: index + 1,
      })),
    );
    if (bills.length > 0) {
      await db.insert(payoutListInvoices).values(bills);
    }
  }
}
