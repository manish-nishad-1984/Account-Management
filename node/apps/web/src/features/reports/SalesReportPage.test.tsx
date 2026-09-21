import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SalesReportPage } from "./SalesReportPage";
import { renderWithAuth, routeFetch } from "../../test/render";

/** Laid out like the other reports since 18 Sep 2026. */

const EMPTY = { rows: [], nextCursor: null, total: 0 };

const salesRow = (overrides: Record<string, unknown> = {}) => ({
  id: "s1:c1",
  partyId: "c1",
  partyName: "RIVERFRONT DEVELOPERS",
  siteId: "s1",
  siteName: "Akwada Lake Front",
  credit: "10000.00",
  debit: "2500.00",
  netAmount: "7500.00",
  ...overrides,
});

const withSales = (rows: unknown[], overrides: Record<string, unknown> = {}) =>
  routeFetch([
    [
      /\/reports\/sales$/,
      {
        rows,
        total: rows.length,
        nextCursor: null,
        totalCredit: "10000.00",
        totalDebit: "2500.00",
        closingBalance: "7500.00",
        ...overrides,
      },
    ],
    [/\/suppliers/, EMPTY],
    [/\/companies/, EMPTY],
  ]);

describe("SalesReportPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the figures in the report grid, each amount aligned with its header", async () => {
    withSales([salesRow()]);
    renderWithAuth(<SalesReportPage />, { permissions: ["sales-report.view"] });

    const table = await screen.findByRole("table", { name: "Sales report" });
    const headers = within(table).getAllByRole("columnheader");
    for (const name of ["Invoiced", "Received", "Outstanding"]) {
      const index = headers.findIndex((header) => header.textContent === name);
      expect(headers[index]).toHaveClass("text-right");
      expect(table.querySelector("tbody tr")!.children[index]).toHaveClass("text-right", "tabular");
    }
    expect(within(table).getAllByText("7,500.00")).toHaveLength(2); // the row and the total
  });

  it("has no title block and no footnote, and puts the downloads on the filter row", async () => {
    withSales([salesRow()]);
    renderWithAuth(<SalesReportPage />, { permissions: ["sales-report.view"] });
    await screen.findByRole("table", { name: "Sales report" });

    expect(screen.queryByText("What each customer owes, by site")).not.toBeInTheDocument();
    expect(screen.queryByText(/Sales returns and credit notes reduce/)).not.toBeInTheDocument();
    // Inside the filter card (18 Sep 2026), rather than a row of their own above it.
    const excel = screen.getByRole("button", { name: /export to excel/i });
    const reset = screen.getByRole("button", { name: "Reset" });
    expect(reset.closest("form")).toContainElement(excel);
    expect(reset.compareDocumentPosition(excel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /** It asked for 50 rows and offered no way to the 51st. */
  it("pages", async () => {
    withSales([salesRow()], { total: 120, nextCursor: "50" });
    renderWithAuth(<SalesReportPage />, { permissions: ["sales-report.view"] });

    await userEvent.click(await screen.findByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(
        vi.mocked(globalThis.fetch).mock.calls.some(
          ([url]) => String(url).includes("/reports/sales?") && String(url).includes("offset=50"),
        ),
      ).toBe(true),
    );
  });
});
