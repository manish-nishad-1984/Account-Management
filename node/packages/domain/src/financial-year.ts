/**
 * The Indian financial year used to stamp document numbers
 * (purchase request, purchase order, purchase invoice, sales invoice).
 *
 * Ported from AccountManegment.Repo/Domain/FinancialYear.cs. This is a
 * CHARACTERISATION of current production behaviour, defect included — not a
 * statement of what the rule should be. See Migration-Assessment blocker 2.
 *
 * The defect: the boundary test is `month > 4`, so April is treated as belonging
 * to the PREVIOUS financial year and the year flips on 1 May instead of 1 April.
 *
 * Do not change `currentAsProduced` without written business sign-off — document
 * numbers issued under the current rule are already in the database and in
 * customers' hands.
 */

export interface FinancialYearRange {
  readonly startYear: number;
  readonly endYear: number;
}

/**
 * JavaScript months are 0-indexed; C# `DateTime.Month` is 1-indexed. The `+ 1`
 * below is what keeps this equivalent to the C# original — get it wrong and every
 * document number shifts by a month.
 */
const monthOf = (asAt: Date): number => asAt.getMonth() + 1;

/** The financial year as production computes it today, defect included. */
export function currentAsProduced(asAt: Date): FinancialYearRange {
  const endYear = monthOf(asAt) > 4 ? asAt.getFullYear() + 1 : asAt.getFullYear();
  return { startYear: endYear - 1, endYear };
}

/**
 * The financial year as the Indian FY convention actually defines it:
 * 1 April to 31 March. Not yet in use — pending business sign-off.
 */
export function currentAsIntended(asAt: Date): FinancialYearRange {
  const endYear = monthOf(asAt) >= 4 ? asAt.getFullYear() + 1 : asAt.getFullYear();
  return { startYear: endYear - 1, endYear };
}

/** Formats a range the way document numbers render it, e.g. "25-26". */
export function format(fy: FinancialYearRange): string {
  const pad = (year: number) => String(year % 100).padStart(2, "0");
  return `${pad(fy.startYear)}-${pad(fy.endYear)}`;
}
