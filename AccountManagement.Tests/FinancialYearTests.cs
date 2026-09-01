using AccountManagement.Repository.Domain;
using Xunit;

namespace AccountManagement.Tests
{
    /// <summary>
    /// Characterisation tests: these pin down what the system does TODAY so that any
    /// change to document numbering is a deliberate, visible decision rather than an
    /// accident. Several of these assertions encode a known defect — they are labelled.
    /// </summary>
    public class FinancialYearTests
    {
        [Theory]
        // Month > 4, so May onwards correctly rolls into the next FY.
        [InlineData(2025, 5, 1, "25-26")]
        [InlineData(2025, 12, 31, "25-26")]
        [InlineData(2026, 1, 1, "25-26")]
        [InlineData(2026, 3, 31, "25-26")]
        public void Produces_the_expected_financial_year_outside_April(
            int year, int month, int day, string expected)
        {
            var fy = FinancialYear.CurrentAsProduced(new DateTime(year, month, day));
            Assert.Equal(expected, FinancialYear.Format(fy));
        }

        [Theory]
        // DEFECT: April belongs to the FY that STARTS on 1 April, so these should all
        // be "26-27". Because the boundary test is `Month > 4`, production stamps them
        // "25-26". This test asserts the WRONG answer on purpose, to prove the defect
        // exists and to fail loudly if anyone changes the rule without sign-off.
        [InlineData(2026, 4, 1, "25-26")]
        [InlineData(2026, 4, 15, "25-26")]
        [InlineData(2026, 4, 30, "25-26")]
        public void DEFECT_April_is_stamped_with_the_previous_financial_year(
            int year, int month, int day, string producedButWrong)
        {
            var fy = FinancialYear.CurrentAsProduced(new DateTime(year, month, day));
            Assert.Equal(producedButWrong, FinancialYear.Format(fy));
        }

        [Theory]
        [InlineData(2026, 4, 1, "26-27")]
        [InlineData(2026, 4, 30, "26-27")]
        [InlineData(2026, 5, 1, "26-27")]
        [InlineData(2026, 3, 31, "25-26")]
        public void Corrected_rule_puts_April_in_the_financial_year_that_starts_that_month(
            int year, int month, int day, string expected)
        {
            var fy = FinancialYear.CurrentAsIntended(new DateTime(year, month, day));
            Assert.Equal(expected, FinancialYear.Format(fy));
        }

        [Fact]
        public void The_two_rules_differ_only_during_April()
        {
            var divergentDays = new List<DateTime>();
            for (var d = new DateTime(2024, 1, 1); d < new DateTime(2027, 1, 1); d = d.AddDays(1))
            {
                if (FinancialYear.CurrentAsProduced(d) != FinancialYear.CurrentAsIntended(d))
                {
                    divergentDays.Add(d);
                }
            }

            Assert.All(divergentDays, d => Assert.Equal(4, d.Month));
            // 3 Aprils in the range, 30 days each.
            Assert.Equal(90, divergentDays.Count);
        }
    }
}
