import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type {
  ConfirmPayoutList,
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
import {
  paymentAllocations,
  payments,
  payoutListInvoices,
  payoutListLines,
  payoutLists,
  suppliers,
  users,
} from "../../db/schema";
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
  status: "draft" | "confirmed";
  confirmed_at: string | null;
  confirmed_by_name: string | null;
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
    l.status, l.confirmed_at::text as confirmed_at,
    nullif(trim(concat_ws(' ', cf.first_name, cf.last_name)), '') as confirmed_by_name,
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
  left join ${users} cf on cf.id = l.confirmed_by
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
  private async owedByParty(siteId?: string): Promise<Map<string, Owed>> {
    const sums = new Map<string, Owed>();
    for (let offset = 0; ; offset += BALANCES_PAGE) {
      const page = await this.reports.balances(
        { direction: "out", show: "outstanding", siteId },
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
  private async pendingByParty(siteId?: string): Promise<Map<string, PayoutPendingInvoice[]>> {
    const byParty = new Map<string, PayoutPendingInvoice[]>();
    for (let offset = 0; ; offset += BALANCES_PAGE) {
      const page = await this.reports.pendingLedger({ direction: "out", siteId }, { limit: BALANCES_PAGE, offset });
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

  /**
   * With a `siteId`, only what is owed AT THAT SITE: each party's outstanding is
   * its balance there, and a party owed nothing at that site is not listed, even
   * if it is owed elsewhere (client request, 7 Oct 2026: the header's site).
   * Without one, as before: the sum over every site, netted per party.
   */
  async outstanding(siteId?: string): Promise<PayoutOutstandingResponse> {
    const owed = [...(await this.owedByParty(siteId)).values()].sort(
      (a, b) => a.partyName.localeCompare(b.partyName) || a.partyId.localeCompare(b.partyId),
    );
    const bills = await this.pendingByParty(siteId);
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
      status: row.status,
      confirmedAt: iso(row.confirmed_at),
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
        extraPaid: sql<string | null>`${payoutListLines.extraPaid}::text`,
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
            paidAmount: sql<string | null>`${payoutListInvoices.paidAmount}::text`,
            pendingAtSave: sql<string | null>`${payoutListInvoices.pendingAtSave}::text`,
          })
          .from(payoutListInvoices)
          .where(inArray(payoutListInvoices.payoutLineId, lines.map((line) => line.id)))
          .orderBy(asc(payoutListInvoices.lineNumber))
      : [];

    const owed = await this.owedByParty();
    return {
      ...this.toRow(header),
      confirmedByName: header.confirmed_by_name,
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
    await this.refuseIfConfirmed(id);
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
    await this.refuseIfConfirmed(id);
    const [row] = await this.db
      .update(payoutLists)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(payoutLists.id, id), eq(payoutLists.isDeleted, false)))
      .returning({ id: payoutLists.id });
    if (!row) {
      throw new NotFoundException("Payout list not found");
    }
  }

  /** A confirmed list is locked: it has payments behind it. */
  private async refuseIfConfirmed(id: string): Promise<void> {
    const [row] = await this.db
      .select({ status: payoutLists.status })
      .from(payoutLists)
      .where(and(eq(payoutLists.id, id), eq(payoutLists.isDeleted, false)))
      .limit(1);
    if (row?.status === "confirmed") {
      throw new ConflictException("This list is confirmed and its payments are recorded. Reverse the confirmation to change it.");
    }
  }

  /**
   * What is pending on each of one party's bills RIGHT NOW, with the site and
   * company each belongs to: the Pending Outstanding report's own rows, so the
   * amount a bill may be paid up to is the amount that report shows.
   */
  private async pendingBills(partyId: string) {
    const bills = new Map<
      string,
      { pending: bigint; siteId: string | null; companyId: string; siteLocationId: string | null }
    >();
    for (let offset = 0; ; offset += BALANCES_PAGE) {
      const page = await this.reports.pendingLedger({ direction: "out", partyId }, { limit: BALANCES_PAGE, offset });
      for (const row of page.rows) {
        bills.set(`${row.source}:${row.documentId}`, {
          pending: toPaise(row.pending),
          siteId: row.siteId,
          companyId: row.companyId,
          siteLocationId: row.siteLocationId,
        });
      }
      if (page.nextCursor === null) break;
    }
    return bills;
  }

  /**
   * CONFIRM: the owner has paid, and a user with the right records it
   * (7 Oct 2026). One transaction does all of it or none:
   *
   *  - a payment is made for each party and each (company, site) its bills belong
   *    to, because a payment carries one of each and the ledger is kept by party
   *    and site;
   *  - each payment names the bills it settles, in `payment_allocations`, so those
   *    bills read as paid whatever order they were in;
   *  - the list is stamped confirmed and locked.
   *
   * Refused, with the reason, when a bill is not on the list, has less pending
   * than is being paid, or when a party has nothing ticked to settle. A line kept
   * party by party (no bills) cannot be confirmed: a payment needs a site and the
   * only place to get one is a bill.
   */
  async confirm(id: string, input: ConfirmPayoutList, actorId: string): Promise<PayoutListDetail> {
    const detail = await this.findById(id);
    if (detail.status === "confirmed") {
      throw new ConflictException("This list is already confirmed");
    }

    const issues: { path: string; message: string }[] = [];
    const fail = (path: string, message: string) => issues.push({ path, message });

    type Planned = {
      lineId: string;
      partyId: string;
      bill: { source: "invoice" | "opening_balance"; documentId: string };
      paid: bigint;
    };
    type Group = {
      partyId: string;
      companyId: string;
      siteId: string | null;
      siteLocationId: string | null;
      paid: bigint;
      bills: Planned[];
    };
    const planned: Planned[] = [];
    const groups = new Map<string, Group>();
    const extraByParty = new Map<string, bigint>();

    for (const [lineIndex, line] of input.lines.entries()) {
      const listed = detail.lines.find((candidate) => candidate.partyId === line.partyId);
      if (!listed) {
        fail(`lines.${lineIndex}.partyId`, "This party is not on the list");
        continue;
      }
      if (listed.invoices.length === 0) {
        fail(
          `lines.${lineIndex}.partyId`,
          `${listed.partyName} has no bills ticked, so there is nothing to settle. Open the list, tick the bills paid, save it, then confirm.`,
        );
        continue;
      }
      const pendingOf = await this.pendingBills(line.partyId);
      for (const [billIndex, bill] of line.bills.entries()) {
        const onList = listed.invoices.find(
          (candidate) => candidate.source === bill.source && candidate.documentId === bill.documentId,
        );
        const path = `lines.${lineIndex}.bills.${billIndex}.paid`;
        if (!onList) {
          fail(path, "This bill is not on the list");
          continue;
        }
        const paid = toPaise(bill.paid);
        if (paid === 0n) continue;
        const open = pendingOf.get(`${bill.source}:${bill.documentId}`);
        if (!open) {
          fail(path, `${onList.displayNo} has nothing pending, it is already settled`);
          continue;
        }
        if (paid > open.pending) {
          fail(path, `Only ${fromPaise(open.pending)} is pending on ${onList.displayNo}`);
          continue;
        }
        const entry: Planned = {
          lineId: listed.id,
          partyId: line.partyId,
          bill: { source: bill.source, documentId: bill.documentId },
          paid,
        };
        planned.push(entry);
        const key = `${line.partyId}|${open.companyId}|${open.siteId ?? "none"}`;
        const group: Group = groups.get(key) ?? {
          partyId: line.partyId,
          companyId: open.companyId,
          siteId: open.siteId,
          siteLocationId: null,
          paid: 0n,
          bills: [],
        };
        group.paid += paid;
        group.bills.push(entry);
        groups.set(key, group);
      }
      const extra = line.extra ? toPaise(line.extra) : 0n;
      if (extra > 0n) extraByParty.set(line.partyId, extra);
    }

    for (const [partyId, extra] of extraByParty) {
      if (extra > 0n && ![...groups.values()].some((group) => group.partyId === partyId)) {
        const lineIndex = input.lines.findIndex((line) => line.partyId === partyId);
        fail(`lines.${lineIndex}.extra`, "An extra amount needs at least one bill paid for this party, which gives the payment its site");
      }
    }
    if (issues.length === 0 && planned.length === 0) {
      fail("lines", "Nothing was paid, so there is nothing to confirm");
    }
    if (issues.length > 0) {
      throw new BadRequestException({ message: issues[0]!.message, issues });
    }

    // The extra rides on the party's largest payment, so it adds to one payment, not several.
    const biggest = new Map<string, string>();
    for (const [key, group] of groups) {
      const current = biggest.get(group.partyId);
      if (current === undefined || group.paid > groups.get(current)!.paid) biggest.set(group.partyId, key);
    }

    const description = `Payout list ${detail.listDate}${detail.title ? ` - ${detail.title}` : ""}`;
    const paymentDate = new Date(`${input.paymentDate}T00:00:00.000Z`);

    await writing(() =>
      this.db.transaction(async (tx) => {
        for (const [key, group] of groups) {
          const extra = biggest.get(group.partyId) === key ? (extraByParty.get(group.partyId) ?? 0n) : 0n;
          const [made] = await tx
            .insert(payments)
            .values({
              direction: "out",
              kind: "payment",
              partyId: group.partyId,
              companyId: group.companyId,
              siteId: group.siteId,
              siteLocationId: group.siteLocationId,
              paymentDate,
              amount: fromPaise(group.paid + extra),
              description,
              method: input.method,
              referenceNo: input.referenceNo,
              sourcePayoutListId: id,
              ...createdBy(actorId),
            })
            .returning({ id: payments.id });
          await tx.insert(paymentAllocations).values(
            group.bills.map((entry) => ({
              paymentId: made!.id,
              documentKind: entry.bill.source,
              documentId: entry.bill.documentId,
              amount: fromPaise(entry.paid),
            })),
          );
        }

        // What was paid of EVERY bill on the list, 0 for the ones left out.
        for (const line of detail.lines) {
          for (const bill of line.invoices) {
            const done = planned.find(
              (entry) =>
                entry.lineId === line.id && entry.bill.source === bill.source && entry.bill.documentId === bill.documentId,
            );
            await tx
              .update(payoutListInvoices)
              .set({ paidAmount: fromPaise(done?.paid ?? 0n) })
              .where(
                and(
                  eq(payoutListInvoices.payoutLineId, line.id),
                  eq(payoutListInvoices.source, bill.source),
                  eq(payoutListInvoices.documentId, bill.documentId),
                ),
              );
          }
          const extra = extraByParty.get(line.partyId);
          await tx
            .update(payoutListLines)
            .set({ extraPaid: extra && extra > 0n ? fromPaise(extra) : null })
            .where(eq(payoutListLines.id, line.id));
        }

        await tx
          .update(payoutLists)
          .set({ status: "confirmed", confirmedAt: new Date(), confirmedBy: actorId, ...updatedBy(actorId) })
          .where(eq(payoutLists.id, id));
      }),
    );
    return this.findById(id);
  }

  /**
   * REVERSE a confirmation: the payments it made are removed (soft-deleted, so the
   * record of them stays), the bills it settled are open again, and the list is a
   * draft that can be changed and confirmed again. Only the payments THIS list
   * made are touched.
   */
  async reverse(id: string, actorId: string): Promise<PayoutListDetail> {
    const detail = await this.findById(id);
    if (detail.status !== "confirmed") {
      throw new ConflictException("This list is not confirmed");
    }
    await writing(() =>
      this.db.transaction(async (tx) => {
        const made = await tx
          .select({ id: payments.id })
          .from(payments)
          .where(and(eq(payments.sourcePayoutListId, id), eq(payments.isDeleted, false)));
        const ids = made.map((row) => row.id);
        if (ids.length > 0) {
          await tx.delete(paymentAllocations).where(inArray(paymentAllocations.paymentId, ids));
          await tx.update(payments).set({ isDeleted: true, ...updatedBy(actorId) }).where(inArray(payments.id, ids));
        }
        const lineIds = detail.lines.map((line) => line.id);
        if (lineIds.length > 0) {
          await tx
            .update(payoutListInvoices)
            .set({ paidAmount: null })
            .where(inArray(payoutListInvoices.payoutLineId, lineIds));
          await tx.update(payoutListLines).set({ extraPaid: null }).where(inArray(payoutListLines.id, lineIds));
        }
        await tx
          .update(payoutLists)
          .set({ status: "draft", confirmedAt: null, confirmedBy: null, ...updatedBy(actorId) })
          .where(eq(payoutLists.id, id));
      }),
    );
    return this.findById(id);
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
