import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type {
  BalanceRow,
  BalancesQuery,
  BalancesResponse,
  LedgerResponse,
  LedgerRow,
  ReportFilter,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { BaseRepository } from "../../common/base.repository";
import { rawRow, rawRows } from "../../common/raw-rows";

/**
 * The two report grids of `/Report/ReportDetails`, and `/Sales/SalesReport`.
 *
 * See `contracts/reports.ts` for what the legacy versions get wrong. The short
 * form: the summary panel and the ledger panel sit on one screen and disagree
 * about the same balance by twice the value of any purchase return, because the
 * summary's net negates payouts only while its own Debit column also counts
 * returns and credit notes. The arithmetic is written ONCE here and both
 * endpoints read it.
 *
 * EVERYTHING IS RAW SQL, AND THAT IS DELIBERATE.
 *
 * A ledger is a UNION of three tables plus a window function over the union.
 * Drizzle's query builder cannot express `union all` feeding `sum() over
 * (partition by ... order by ...)` without a subquery dance that obscures the
 * one thing a reader needs to check — which rows are credits and which are
 * debits. The `sql` template is parameterised throughout; no value is
 * interpolated as text.
 */

/**
 * A row's effect, as one expression used by BOTH endpoints.
 *
 * This is finding D7's fix, and it is three lines rather than three
 * disagreeing implementations spread across two C# repositories and a
 * JavaScript cell renderer:
 *
 *   - an invoice is a CREDIT (it increases what is owed)
 *   - a return or credit note is a DEBIT (it reduces it)
 *   - a payment is a DEBIT; an opening balance is a CREDIT
 *
 * The legacy ledger agrees with this. The legacy summary does not.
 */
const RETURN_TYPES = ["Purchase Return", "Credit Note", "Sales Return"];

/**
 * The same list, as a SQL `in` list.
 *
 * NOT `= any(${RETURN_TYPES})`. Drizzle expands a JavaScript array inside an
 * `sql` template into a ROW CONSTRUCTOR — `($1, $2, $3)` — rather than into a
 * PostgreSQL array, so `any()` is handed a row and PostgreSQL rejects it with
 * `42809: op ANY/ALL (array) requires array on right side`. It fails loudly,
 * which is the good case, but only once the query actually runs — there is no
 * type error and the template reads exactly like working code.
 */
const RETURN_TYPE_LIST = sql.join(
  RETURN_TYPES.map((type) => sql`${type}`),
  sql`, `,
);

@Injectable()
export class ReportsRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /**
   * The union of documents and payments for one direction, as one derived table.
   *
   * `out` reads purchase invoices (what we owe suppliers) and payments made;
   * `in` reads sales invoices (what customers owe us) and receipts. The source
   * needs two whole repositories for this because the two directions live in
   * two tables with different column names.
   */
  private entries(filter: ReportFilter): SQL {
    const isIn = filter.direction === "in";

    const documents = isIn
      ? sql`
        select
          si.id                                   as document_id,
          'invoice'::text                         as source_kind,
          coalesce(nullif(btrim(si.sales_invoice_no), ''), '(no number)') as display_no,
          si.invoice_type                         as label,
          si.document_date                        as document_date,
          si.created_at                           as created_at,
          si.customer_id                          as party_id,
          si.site_id                              as site_id,
          -- SALES INVOICES HAVE NO SITE GROUP. SalesInvoice carries no
          -- SiteGroup column and SalesInvoiceMasterModel carries no
          -- GroupName, yet Report.js:578 renders a Group column bound to
          -- groupName for exactly this grid — so that column is
          -- structurally empty on the sales ledger and always has been. The
          -- purchase side does have the column (SupplierInvoice.SiteGroup,
          -- an nvarchar holding the name; see §6). Null here, and the screen
          -- says so rather than drawing an empty column.
          null::uuid                              as site_group_id,
          si.company_id                           as company_id,
          si.total_amount                         as amount,
          case when si.invoice_type in (${RETURN_TYPE_LIST}) then 'debit' else 'credit' end as effect
        from sales_invoices si
      `
      : sql`
        select
          pi.id                                   as document_id,
          'invoice'::text                         as source_kind,
          coalesce(
            nullif(btrim(pi.supplier_invoice_no), ''),
            nullif(btrim(pi.invoice_no), ''),
            '(no number)'
          )                                       as display_no,
          pi.invoice_type                         as label,
          pi.document_date                        as document_date,
          pi.created_at                           as created_at,
          pi.supplier_id                          as party_id,
          pi.site_id                              as site_id,
          pi.site_group_id                        as site_group_id,
          pi.company_id                           as company_id,
          pi.total_amount                         as amount,
          case when pi.invoice_type in (${RETURN_TYPE_LIST}) then 'debit' else 'credit' end as effect
        from purchase_invoices pi
      `;

    return sql`
      ${documents}
      union all
      select
        p.id                                      as document_id,
        p.kind                                    as source_kind,
        coalesce(nullif(btrim(p.reference_no), ''), nullif(btrim(p.description), ''), '—') as display_no,
        case when p.kind = 'opening_balance' then 'Opening balance' else 'Payment' end as label,
        p.payment_date                            as document_date,
        p.created_at                              as created_at,
        p.party_id                                as party_id,
        p.site_id                                 as site_id,
        p.site_group_id                           as site_group_id,
        p.company_id                              as company_id,
        p.amount                                  as amount,
        -- An opening balance is what was already owed, so it is a CREDIT. The
        -- source cannot say this: both are stamped IsPayOut = true and told
        -- apart only by a string in the number column.
        case when p.kind = 'opening_balance' then 'credit' else 'debit' end as effect
      from payments p
      where p.is_deleted = false
        and p.direction = ${filter.direction}
    `;
  }

  /** The seven filters, applied to the union rather than to each table. */
  private where(filter: ReportFilter): SQL {
    const clauses: SQL[] = [sql`true`];

    if (filter.companyId) clauses.push(sql`e.company_id = ${filter.companyId}::uuid`);
    if (filter.siteId) clauses.push(sql`e.site_id = ${filter.siteId}::uuid`);
    if (filter.partyId) clauses.push(sql`e.party_id = ${filter.partyId}::uuid`);
    if (filter.siteGroupId) clauses.push(sql`e.site_group_id = ${filter.siteGroupId}::uuid`);
    // A document with no date is NOT excluded by a date filter it cannot be
    // compared against — it would silently vanish from a balance it belongs to.
    if (filter.fromDate) {
      clauses.push(sql`(e.document_date is null or e.document_date >= ${filter.fromDate}::timestamptz)`);
    }
    if (filter.toDate) {
      clauses.push(sql`(e.document_date is null or e.document_date <= ${filter.toDate}::timestamptz)`);
    }

    return sql.join(clauses, sql` and `);
  }

  /**
   * THE LEDGER, with the running balance computed in SQL before paging.
   *
   * `14-reports-and-payments.md` point 1 says a cumulative column cannot be
   * produced page by page. The legacy grid avoids the problem by never paging —
   * `serverSide: true, paging: false` — and accumulating in a DataTables cell
   * renderer into a module-level object that is never reset (§5u). Here the
   * window function runs over the whole filtered set and the page is taken
   * after, so page 2 continues page 1 rather than restarting.
   *
   * PARTITIONED BY PARTY, ordered by date. A ledger that ran one balance across
   * several suppliers would be meaningless, and the legacy version keys its
   * accumulator by supplier NAME — so two suppliers sharing a name share a
   * balance. `party_id` here.
   *
   * OFFSET paging, not keyset, and this is the one place in the system that is
   * true. A keyset cursor names a row; the balance depends on every row BEFORE
   * it in the ordering, so resuming from a cursor would have to re-scan the
   * prefix anyway. The window function already does that scan, and the result is
   * ordered deterministically by (date, created_at, id) so a page boundary is
   * stable.
   */
  async ledger(
    filter: ReportFilter,
    page: { limit: number; offset: number },
  ): Promise<LedgerResponse> {
    const entries = this.entries(filter);
    const where = this.where(filter);

    const base = sql`
      with entries as (${entries}),
      filtered as (
        select e.*,
          case when e.effect = 'credit' then e.amount else 0 end as credit,
          case when e.effect = 'debit'  then e.amount else 0 end as debit
        from entries e
        where ${where}
      )
    `;

    const totals = rawRow<{ total: string; total_credit: string; total_debit: string }>(
      await this.db.execute(sql`
        ${base}
        select
          count(*)::text                       as total,
          coalesce(sum(credit), 0)::text       as total_credit,
          coalesce(sum(debit), 0)::text        as total_debit
        from filtered
      `),
    );

    const rows = rawRows<Record<string, string | null>>(
      await this.db.execute(sql`
      ${base},
      running as (
        select f.*,
          sum(f.credit - f.debit) over (
            partition by f.party_id
            order by f.document_date asc nulls first, f.created_at asc, f.document_id asc
            rows between unbounded preceding and current row
          ) as balance
        from filtered f
      )
      select
        r.document_id, r.source_kind, r.display_no, r.label,
        r.document_date, r.party_id, r.site_id, r.site_group_id, r.company_id,
        r.effect, r.credit::text as credit, r.debit::text as debit,
        r.balance::text as balance,
        s.name  as party_name,
        st.name as site_name,
        sg.name as site_group_name,
        c.name  as company_name
      from running r
      join suppliers s  on s.id  = r.party_id
      join companies c  on c.id  = r.company_id
      left join sites st       on st.id = r.site_id
      left join site_groups sg on sg.id = r.site_group_id
      order by r.party_id, r.document_date asc nulls first, r.created_at asc, r.document_id asc
      limit ${page.limit} offset ${page.offset}
    `),
    );

    const total = Number.parseInt(totals?.total ?? "0", 10);
    const totalCredit = totals?.total_credit ?? "0";
    const totalDebit = totals?.total_debit ?? "0";

    return {
      rows: rows.map(
        (row): LedgerRow => ({
          id: `${row.source_kind}:${row.document_id}`,
          documentId: String(row.document_id),
          source: this.sourceOf(String(row.source_kind), String(row.label)),
          displayNo: String(row.display_no ?? "—"),
          label: String(row.label ?? ""),
          documentDate: row.document_date === null ? null : new Date(String(row.document_date)).toISOString(),
          partyId: String(row.party_id),
          partyName: String(row.party_name),
          siteId: row.site_id === null ? null : String(row.site_id),
          siteName: row.site_name === null ? null : String(row.site_name),
          siteGroupId: row.site_group_id === null ? null : String(row.site_group_id),
          siteGroupName: row.site_group_name === null ? null : String(row.site_group_name),
          companyId: String(row.company_id),
          companyName: String(row.company_name),
          effect: row.effect === "debit" ? "debit" : "credit",
          credit: this.money(row.credit),
          debit: this.money(row.debit),
          balance: this.money(row.balance),
        }),
      ),
      total,
      nextCursor: page.offset + page.limit < total ? String(page.offset + page.limit) : null,
      totalCredit: this.money(totalCredit),
      totalDebit: this.money(totalDebit),
      closingBalance: this.difference(totalCredit, totalDebit),
    };
  }

  /**
   * THE SUMMARY, grouped by (site, party) exactly as the source groups it.
   *
   * `netAmount` is `credit − debit`, which is the one thing the legacy version
   * does not do. And nothing is hidden: `CountTotalData.Where(i => i.NetAmount
   * != 0)` drops settled parties from the grid while leaving their credits and
   * debits in a footer computed before the filter, so the legacy grid does not
   * add up to its own Total row. `show: "outstanding"` offers that behaviour
   * explicitly, and the footer then matches what is shown.
   */
  async balances(
    query: BalancesQuery,
    page: { limit: number; offset: number },
  ): Promise<BalancesResponse> {
    const entries = this.entries(query);
    const where = this.where(query);
    const outstandingOnly = query.show === "outstanding";

    const base = sql`
      with entries as (${entries}),
      filtered as (
        select e.*,
          case when e.effect = 'credit' then e.amount else 0 end as credit,
          case when e.effect = 'debit'  then e.amount else 0 end as debit
        from entries e
        where ${where}
      ),
      grouped as (
        select
          f.party_id, f.site_id,
          sum(f.credit) as credit,
          sum(f.debit)  as debit,
          sum(f.credit) - sum(f.debit) as net_amount
        from filtered f
        group by f.party_id, f.site_id
      ),
      shown as (
        select * from grouped
        where ${outstandingOnly ? sql`net_amount <> 0` : sql`true`}
      )
    `;

    const totals = rawRow<{ total: string; total_credit: string; total_debit: string }>(
      await this.db.execute(sql`
        ${base}
        select
          count(*)::text                  as total,
          coalesce(sum(credit), 0)::text  as total_credit,
          coalesce(sum(debit), 0)::text   as total_debit
        from shown
      `),
    );

    const rows = rawRows<Record<string, string | null>>(
      await this.db.execute(sql`
      ${base}
      select
        g.party_id, g.site_id,
        g.credit::text as credit, g.debit::text as debit, g.net_amount::text as net_amount,
        s.name  as party_name,
        st.name as site_name
      from shown g
      join suppliers s on s.id = g.party_id
      left join sites st on st.id = g.site_id
      order by s.name asc, st.name asc nulls first, g.party_id asc
      limit ${page.limit} offset ${page.offset}
    `),
    );

    const total = Number.parseInt(totals?.total ?? "0", 10);
    const totalCredit = totals?.total_credit ?? "0";
    const totalDebit = totals?.total_debit ?? "0";

    return {
      rows: rows.map(
        (row): BalanceRow => ({
          id: `${row.site_id ?? "none"}:${row.party_id}`,
          partyId: String(row.party_id),
          partyName: String(row.party_name),
          siteId: row.site_id === null ? null : String(row.site_id),
          siteName: row.site_name === null ? null : String(row.site_name),
          credit: this.money(row.credit),
          debit: this.money(row.debit),
          netAmount: this.money(row.net_amount),
        }),
      ),
      total,
      nextCursor: page.offset + page.limit < total ? String(page.offset + page.limit) : null,
      totalCredit: this.money(totalCredit),
      totalDebit: this.money(totalDebit),
      closingBalance: this.difference(totalCredit, totalDebit),
    };
  }

  /** `payment`/`opening_balance` come through as the kind; invoices split by type. */
  private sourceOf(kind: string, label: string): LedgerRow["source"] {
    if (kind === "payment") return "payment";
    if (kind === "opening_balance") return "opening_balance";
    return RETURN_TYPES.includes(label) ? "return" : "invoice";
  }

  /**
   * Two decimal places, as a STRING, never through a float.
   *
   * PostgreSQL hands `numeric` back as a string already; this only normalises
   * the scale so the UI never has to. `Number(...)` here would put every rupee
   * in the system through a double.
   */
  private money(value: string | null | undefined): string {
    if (value === null || value === undefined) return "0.00";
    const [whole, fraction = ""] = String(value).split(".");
    return `${whole}.${(fraction + "00").slice(0, 2)}`;
  }

  /** `a − b` in exact decimal, via BigInt on the paise. */
  private difference(a: string, b: string): string {
    const paise = (value: string): bigint => {
      const negative = value.trimStart().startsWith("-");
      const [whole, fraction = ""] = value.replace("-", "").split(".");
      const cents = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
      return negative ? -cents : cents;
    };
    const result = paise(a) - paise(b);
    const sign = result < 0n ? "-" : "";
    const absolute = result < 0n ? -result : result;
    return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
  }
}
