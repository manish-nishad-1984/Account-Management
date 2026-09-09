import { z } from "zod";
import { PAYMENT_DIRECTIONS } from "./payments";

/**
 * The two report grids of `/Report/ReportDetails`, plus `/Sales/SalesReport`.
 *
 * `14-reports-and-payments.md` describes three stacked panels. Two of them are
 * the same query in different shapes, and the Sales Report is a third copy of
 * one of those against the sales tables — so this is two endpoints, not three.
 *
 *   panel 1  "Payout Summary"   -> `/reports/balances`, grouped by site + party
 *   panel 2  "Payment Report"   -> `/reports/ledger`, one row per document
 *   panel 3  "Payment Actions"  -> the payments module, not a report
 *   /Sales/SalesReport          -> `/reports/balances?direction=in`
 *
 * WHAT THE LEGACY VERSION GETS WRONG, AND WHERE
 *
 * These two panels sit on one screen and **disagree about the same supplier's
 * balance**. That is finding D7, and reading both implementations places it
 * precisely: the LEDGER is right and the SUMMARY is wrong.
 *
 * The summary's net (`SupplierInvoiceRepo.cs:229`) is
 *
 *     NetAmount = group.Sum(x => x.InvoiceNo != "PayOut" ? +Total : -Total)
 *
 * which negates payouts and nothing else — while the Debit column beside it
 * (`:227`) counts purchase returns and credit notes as debits. So a return is
 * shown as a debit and added to the balance. The ledger's balance, computed in
 * `Report.js:622`, subtracts returns and credit notes correctly.
 *
 * A ₹10,000 purchase return therefore leaves the two panels ₹20,000 apart.
 * Here the arithmetic is written once, in SQL, and both endpoints use it.
 */

/**
 * A row's effect on the balance.
 *
 * `credit` increases what is owed to the party, `debit` reduces it. Stated as a
 * column rather than inferred by the reader from four scattered string
 * comparisons.
 */
export const LEDGER_EFFECTS = ["credit", "debit"] as const;
export type LedgerEffect = (typeof LEDGER_EFFECTS)[number];

/** What produced the row, so the ledger can be read without decoding numbers. */
export const LEDGER_SOURCES = ["invoice", "return", "payment", "opening_balance"] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

export const ledgerRowSchema = z.object({
  /** `<source>:<uuid>` — unique across the union, which no single id would be. */
  id: z.string(),
  documentId: z.string(),
  source: z.enum(LEDGER_SOURCES),

  /** The number as its own screen shows it, or the payment's description. */
  displayNo: z.string(),
  /** `Purchase`, `Purchase Return`, `Credit Note`, `Payment`, `Opening balance`. */
  label: z.string(),

  documentDate: z.string().nullable(),

  partyId: z.string(),
  partyName: z.string(),
  siteId: z.string().nullable(),
  siteName: z.string().nullable(),
  siteGroupId: z.string().nullable(),
  siteGroupName: z.string().nullable(),
  companyId: z.string(),
  companyName: z.string(),

  effect: z.enum(LEDGER_EFFECTS),

  /** Decimal strings. Exactly one of these is non-zero on any row. */
  credit: z.string(),
  debit: z.string(),

  /**
   * The running balance AFTER this row, computed in SQL over the whole filtered
   * set before any paging.
   *
   * `14-reports-and-payments.md` point 1 is the reason: a cumulative column
   * cannot be produced page by page. The legacy grid dodges that by not paging
   * at all — `serverSide: true` with `paging: false` — and accumulating in a
   * DataTables cell renderer into a module-level object. See §5u for the four
   * defects that arrangement causes; the worst is that a second payment of the
   * same amount is silently skipped.
   */
  balance: z.string(),
});
export type LedgerRow = z.infer<typeof ledgerRowSchema>;

export const ledgerResponseSchema = z.object({
  rows: z.array(ledgerRowSchema),
  /** Every row in the filtered set, whether or not it fitted in this page. */
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),

  /**
   * Totals over the WHOLE filtered set, not the page.
   *
   * The legacy footer computes these over the whole set too, but from
   * `allData` — which is the whole set only because it never pages. The moment
   * paging is enabled there, its footer silently becomes a page total.
   */
  totalCredit: z.string(),
  totalDebit: z.string(),
  /** `totalCredit − totalDebit`. The closing balance of the filtered set. */
  closingBalance: z.string(),
});
export type LedgerResponse = z.infer<typeof ledgerResponseSchema>;

export const balanceRowSchema = z.object({
  /** `<siteId|none>:<partyId>` — the group key, since the pair is the identity. */
  id: z.string(),
  partyId: z.string(),
  partyName: z.string(),
  siteId: z.string().nullable(),
  siteName: z.string().nullable(),

  credit: z.string(),
  debit: z.string(),

  /**
   * `credit − debit`, which the legacy summary does NOT compute this way.
   *
   * See the note at the top of this file. Its `NetAmount` adds purchase returns
   * and credit notes while its own Debit column subtracts them.
   */
  netAmount: z.string(),
});
export type BalanceRow = z.infer<typeof balanceRowSchema>;

export const balancesResponseSchema = z.object({
  rows: z.array(balanceRowSchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  totalCredit: z.string(),
  totalDebit: z.string(),
  closingBalance: z.string(),
});
export type BalancesResponse = z.infer<typeof balancesResponseSchema>;

/**
 * The seven filters both panels carry, plus the direction.
 *
 * `filterType` in the source is a string switch over `currentMonth`,
 * `tillMonth`, `currentYear` and `betweenYear`, each of which computes a date
 * range in C# — four code paths that produce two dates. The client sends the
 * two dates here and the presets are built in the browser, where the financial
 * year the user is looking at is already known.
 */
export const reportFilterSchema = z.object({
  direction: z.enum(PAYMENT_DIRECTIONS).default("out"),
  companyId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
  partyId: z.string().uuid().optional(),
  siteGroupId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;

/**
 * WHY THE SUMMARY DOES NOT HIDE SETTLED PARTIES.
 *
 * `SupplierInvoiceRepo.cs:283` ends with
 * `CountTotalData.Where(i => i.NetAmount != 0)`, so a party whose balance is
 * exactly zero disappears from the report — and its credits and debits stay in
 * the footer totals, which are computed BEFORE that filter. The grid and its
 * own Total row therefore do not add up, and a fully settled supplier looks
 * like one that was never traded with.
 *
 * Both are departed from: nothing is hidden, and the footer is the sum of what
 * is shown. `settledOnly` is offered as an explicit filter instead, so the
 * behaviour is available to anyone who wanted it without being the default
 * nobody was told about.
 */
export const balancesQuerySchema = reportFilterSchema.extend({
  /** `outstanding` hides parties whose net is zero — the legacy behaviour, opt-in. */
  show: z.enum(["all", "outstanding"]).default("all"),
});
export type BalancesQuery = z.infer<typeof balancesQuerySchema>;
