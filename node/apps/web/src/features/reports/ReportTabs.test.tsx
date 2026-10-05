import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SECTION_TAB_ACTIONS_ID } from "../../components/section-tab-slot";
import { ReportTabs } from "./ReportGrid";

/**
 * A report page's own controls go to the right end of the section tabs' row.
 *
 * The lone tab that used to head these pages repeated the name the section tabs
 * already show (client request, 5 Oct 2026), so what survives of it is its
 * controls, and where they land is what is pinned here.
 */

const lone = (
  <ReportTabs
    value="ledger"
    onChange={() => {}}
    tabs={["ledger"]}
    labels={{ ledger: "Ledger" }}
    actions={<button type="button">Purchases</button>}
    panel={() => <p>the report</p>}
  />
);

describe("a report with one tab", () => {
  it("draws no tab, only its panel", () => {
    render(lone);

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("the report")).toBeInTheDocument();
  });

  it("puts its controls in the section tabs' row when the shell has one", () => {
    render(
      <>
        <div data-testid="slot" id={SECTION_TAB_ACTIONS_ID} />
        {lone}
      </>,
    );

    expect(within(screen.getByTestId("slot")).getByRole("button", { name: "Purchases" })).toBeInTheDocument();
  });

  it("keeps its controls on a line of their own when there is no such row", () => {
    render(lone);

    expect(screen.getByRole("button", { name: "Purchases" })).toBeInTheDocument();
  });
});

describe("a report with two tabs", () => {
  it("still draws both, as a tab list", () => {
    render(
      <ReportTabs
        value="ledger"
        onChange={() => {}}
        labels={{ ledger: "Ledger", balances: "Balance summary" }}
        panel={() => <p>the report</p>}
      />,
    );

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Ledger", "Balance summary"]);
  });
});
