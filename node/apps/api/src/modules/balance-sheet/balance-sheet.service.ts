import { Injectable } from "@nestjs/common";
import type {
  BalanceSheetDetail,
  BalanceSheetQuery,
  BalanceSheetResponse,
  BalanceSheetRow,
} from "@accountmanagement/contracts";
import { ClientIncomesRepository } from "../client-incomes/client-incomes.repository";
import { ReportsRepository } from "../reports/reports.repository";

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

interface Figures {
  income: bigint;
  billed: bigint;
  paid: bigint;
}

const NO_SITE = "No project";

const present = (figures: Figures) => ({
  income: fromPaise(figures.income),
  billed: fromPaise(figures.billed),
  paid: fromPaise(figures.paid),
  stillToPay: fromPaise(figures.billed - figures.paid),
  cashBalance: fromPaise(figures.income - figures.paid),
  projectResult: fromPaise(figures.income - figures.billed),
});

/**
 * The site-wise Balance Sheet (9 Oct 2026). See `contracts/balance-sheet.ts` for
 * what each column means. Income comes from the Income entries, billed and paid
 * from the same union the ledger reads, so the sheet agrees with both.
 */
@Injectable()
export class BalanceSheetService {
  constructor(
    private readonly incomes: ClientIncomesRepository,
    private readonly reports: ReportsRepository,
  ) {}

  async sheet(query: BalanceSheetQuery): Promise<BalanceSheetResponse> {
    const [income, expense] = await Promise.all([
      this.incomes.incomeBySite(query),
      this.reports.expenseBySite(query),
    ]);

    const bySite = new Map<string, { siteId: string | null; siteName: string; figures: Figures }>();
    const entry = (siteId: string | null, siteName: string | null) => {
      const key = siteId ?? "none";
      let row = bySite.get(key);
      if (!row) {
        row = { siteId, siteName: siteName ?? NO_SITE, figures: { income: 0n, billed: 0n, paid: 0n } };
        bySite.set(key, row);
      }
      return row;
    };
    for (const one of income) entry(one.siteId, one.siteName).figures.income += toPaise(one.income);
    for (const one of expense) {
      const row = entry(one.siteId, one.siteName);
      row.figures.billed += toPaise(one.billed);
      row.figures.paid += toPaise(one.paid);
    }

    const total: Figures = { income: 0n, billed: 0n, paid: 0n };
    const rows: BalanceSheetRow[] = [...bySite.values()]
      .sort((a, b) => a.siteName.localeCompare(b.siteName))
      .map((row) => {
        total.income += row.figures.income;
        total.billed += row.figures.billed;
        total.paid += row.figures.paid;
        return { siteId: row.siteId, siteName: row.siteName, ...present(row.figures) };
      });

    return { rows, totals: present(total) };
  }

  /** What is behind one project's row: its income entries and its suppliers. */
  async detail(siteId: string, query: Omit<BalanceSheetQuery, "siteId">): Promise<BalanceSheetDetail> {
    const filter = { ...query, siteId };
    const [incomes, suppliers] = await Promise.all([
      this.incomes.incomeEntries(filter),
      this.reports.expenseBySupplier(filter),
    ]);
    return {
      incomes,
      suppliers: suppliers
        .filter((one) => toPaise(one.billed) !== 0n || toPaise(one.paid) !== 0n)
        .map((one) => ({
          ...one,
          stillToPay: fromPaise(toPaise(one.billed) - toPaise(one.paid)),
        })),
    };
  }
}
