namespace AccountManagement.Repository.Domain
{
    /// <summary>
    /// The Indian financial year used to stamp document numbers (PR, PO, purchase
    /// invoice, sales invoice).
    ///
    /// IMPORTANT — this type deliberately reproduces the CURRENT production behaviour,
    /// including a known defect. It is a characterisation of what the system does today,
    /// not a statement of what it should do. See Migration-Assessment blocker 2.
    ///
    /// The defect: the boundary test is <c>Month &gt; 4</c>, so April is treated as
    /// belonging to the PREVIOUS financial year and the year flips on 1 May instead of
    /// 1 April. Every document raised in April is stamped with the wrong FY.
    ///
    /// Do not change <see cref="CurrentAsProduced"/> without written business sign-off:
    /// document numbers already issued under the current rule are in the database and
    /// in customers' hands. <see cref="CurrentAsIntended"/> is the corrected rule, kept
    /// alongside so the two can be diffed and the affected range quantified.
    /// </summary>
    public static class FinancialYear
    {
        /// <summary>
        /// The financial year as production computes it today, defect included.
        /// Returns the pair (startYear, endYear) — e.g. (2025, 2026) renders as "25-26".
        /// </summary>
        public static (int StartYear, int EndYear) CurrentAsProduced(DateTime asAt)
        {
            int endYear = asAt.Month > 4 ? asAt.Year + 1 : asAt.Year;
            return (endYear - 1, endYear);
        }

        /// <summary>
        /// The financial year as the Indian FY convention actually defines it:
        /// 1 April to 31 March. Not yet in use — pending business sign-off.
        /// </summary>
        public static (int StartYear, int EndYear) CurrentAsIntended(DateTime asAt)
        {
            int endYear = asAt.Month >= 4 ? asAt.Year + 1 : asAt.Year;
            return (endYear - 1, endYear);
        }

        /// <summary>Formats a year pair the way document numbers render it, e.g. "25-26".</summary>
        public static string Format((int StartYear, int EndYear) fy)
            => $"{(fy.StartYear % 100):D2}-{(fy.EndYear % 100):D2}";
    }
}
