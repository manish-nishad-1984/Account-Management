import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { AuthContext } from "../contexts/AuthContext";
import { StaticRecordLayout } from "../contexts/RecordLayoutContext";
import { StaticSiteScope } from "../contexts/SiteScopeContext";

/**
 * THE SIDEBAR MUST NOT OFFER A DOOR THAT IS LOCKED.
 *
 * Every nav entry has carried the permission it needs since the navigation was
 * written, and nothing read it — so all seventeen screens were listed for
 * everyone. On the live site two of them answer 403 for every user, because the
 * forms behind them are deliberately inactive, and following those links drew a
 * complete page with "could not be loaded" on it.
 *
 * ONE ROW PER SECTION (client request, 5 Oct 2026: twenty entries was too long).
 * The rail lists sections; a section's other screens are tabs across the top of
 * the page. Two earlier attempts at folders that open inside the rail were both
 * turned down, so nothing in the rail expands and these tests say so.
 */

function renderShell(permissions: string[], path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider
        value={{
          user: { id: "u1", userName: "tester", permissions },
          isAuthenticated: true,
          isRestoring: false,
          endedReason: null,
          login: vi.fn(),
          logout: vi.fn(),
        }}
      >
        <StaticRecordLayout layout="modal">
          <StaticSiteScope>
            <AppShell>
              <p>page</p>
            </AppShell>
          </StaticSiteScope>
        </StaticRecordLayout>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

const rail = () => within(screen.getByRole("navigation", { name: "Main" }));
const railNames = () => rail().queryAllByRole("link").map((a) => a.textContent?.trim() ?? "");
const tabs = (section: string) =>
  within(screen.getByRole("navigation", { name: `${section} screens` }))
    .getAllByRole("link")
    .map((a) => a.textContent?.trim() ?? "");

describe("the sidebar", () => {
  it("lists one row per section, not one per screen", () => {
    renderShell(
      ["company.view", "supplier.view", "purchase-invoice.view", "reports-payments.view", "dashboard.view"],
      "/suppliers",
    );

    expect(railNames()).toEqual(["Dashboard", "Masters", "Invoicing", "Reports"]);
    expect(rail().queryAllByRole("button")).toHaveLength(0);
  });

  it("sends a section's row to the first screen of it the user can open", () => {
    renderShell(["supplier.view", "item.view"], "/suppliers");

    expect(rail().getByRole("link", { name: "Masters" })).toHaveAttribute("href", "/suppliers");
  });

  it("lights the row of the section the route is in, whichever screen of it that is", () => {
    renderShell(["company.view", "supplier.view"], "/suppliers");

    expect(rail().getByRole("link", { name: "Masters" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps a row lit on a screen opened from inside a section", () => {
    renderShell(["purchase-orders.view"], "/purchase-orders/abc");

    expect(rail().getByRole("link", { name: "Procurement" })).toHaveAttribute("aria-current", "page");
  });

  /** The other screens of the section are the tabs across the top of the page. */
  it("shows the section's other screens as tabs, for the ones the user can open", () => {
    renderShell(["company.view", "supplier.view", "item.view"], "/suppliers");

    expect(tabs("Masters")).toEqual(["Companies", "Suppliers", "Items"]);
  });

  it("marks the current screen's tab", () => {
    renderShell(["company.view", "supplier.view"], "/suppliers");

    const nav = within(screen.getByRole("navigation", { name: "Masters screens" }));
    expect(nav.getByRole("link", { name: "Suppliers" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "Companies" })).not.toHaveAttribute("aria-current");
  });

  /** A lone tab would only repeat the breadcrumb. */
  it("shows no tabs for a section with one screen to open", () => {
    renderShell(["supplier.view"], "/suppliers");

    expect(screen.queryByRole("navigation", { name: "Masters screens" })).not.toBeInTheDocument();
  });

  it("does NOT list a screen the user has no permission for", () => {
    renderShell(["supplier.view", "company.view"], "/suppliers");

    expect(tabs("Masters")).not.toContain("Items");
    expect(railNames()).not.toContain("Reports");
    expect(railNames()).not.toContain("Invoicing");
  });

  /**
   * ONE RIGHT OPENS THE WHOLE REPORTS AND PAYMENTS SCREEN, because that is what
   * the legacy app does: `InvoiceMasterController.PayOutInvoice` guards the page
   * and its data with `Reports & Payments-View`, and its three panels are the
   * payments list, the ledger and the balance summary.
   *
   * THIS TEST ASSERTED THE OPPOSITE UNTIL 10 Sep 2026, and the thing it asserted
   * was the defect: the ledger and the sales summary had been guarded by
   * `details-report` and `sales-report`, two rows in the `Form` table that no
   * .NET code checks and that are inactive in production, so nobody could ever
   * hold them. The report was invisible on the live site until the client asked
   * where it had gone.
   */
  it("opens the Ledger and the Sales Report on the one right", () => {
    renderShell(["reports-payments.view"], "/reports/ledger");

    expect(tabs("Reports")).toContain("Ledger");
    expect(tabs("Reports")).toContain("Sales Report");
    expect(railNames()).toContain("Invoicing");
  });

  it("opens Payments on the same right", () => {
    renderShell(["reports-payments.view", "purchase-invoice.view"], "/payments");

    expect(tabs("Invoicing")).toContain("Payments");
  });

  /** The client asked for the trial copy to sit directly under the ledger; it is Pending Outstanding since 1 Oct 2026. */
  it("puts Pending Outstanding straight after the Ledger, on the same right", () => {
    renderShell(["reports-payments.view"], "/reports/ledger");

    const names = tabs("Reports");
    const ledger = names.findIndex((name) => name === "Ledger");
    expect(ledger).toBeGreaterThanOrEqual(0);
    expect(names[ledger + 1]).toBe("Pending Outstanding");
  });

  it("shows none of them without that right", () => {
    renderShell(["purchase-invoice.view"], "/purchase-invoices");

    expect(railNames()).toContain("Invoicing");
    expect(railNames()).not.toContain("Reports");
    expect(screen.queryByRole("link", { name: "Payments" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ledger" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Pending Outstanding" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sales Report" })).not.toBeInTheDocument();
  });

  /**
   * A section of one, so the rail names it after its screen. It sits between
   * Invoicing and Reports, and "Payout List" has to fit 88px at 11px type.
   */
  it("shows the Payout List row only with payout.view, between Invoicing and Reports", () => {
    renderShell(["purchase-invoice.view", "reports-payments.view"], "/purchase-invoices");
    expect(railNames()).not.toContain("Payout List");
    cleanup();

    renderShell(["purchase-invoice.view", "payout.view", "reports-payments.view"], "/payouts");
    expect(railNames()).toEqual(["Invoicing", "Payout List", "Reports"]);
    expect(rail().getByRole("link", { name: "Payout List" })).toHaveAttribute("href", "/payouts");
    expect(rail().getByRole("link", { name: "Payout List" })).toHaveAttribute("aria-current", "page");
  });

  /** An empty section row with nothing behind it is worse than no row. */
  it("drops a section row when every screen in it is hidden", () => {
    renderShell(["supplier.view"], "/suppliers");
    expect(railNames()).toEqual(["Masters"]);
  });

  it("draws the Dashboard as its own row, named after the screen", () => {
    renderShell(["dashboard.view"]);

    expect(rail().getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/");
    expect(rail().queryByRole("link", { name: "Overview" })).not.toBeInTheDocument();
  });

  /** Settings are the gear in the top bar, not a row in the rail. */
  it("puts Settings behind a gear in the top bar for whoever holds the template right", () => {
    renderShell(["document-template.view"]);

    const gear = screen.getByRole("link", { name: "Settings" });
    expect(gear).toHaveAttribute("href", "/settings/document-layouts");
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Settings" })).toBe(gear);
    expect(railNames()).toEqual([]);
  });

  /** Printing an invoice needs only the invoice; managing layouts is its own right. */
  it("shows no gear to someone who can only open invoices", () => {
    renderShell(["sales-invoice.view", "purchase-invoice.view"], "/sales-invoices");

    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Document Layouts" })).not.toBeInTheDocument();
  });

  /**
   * THE RAIL HAS NOTHING TO OPEN OR CLOSE (client request, 5 Oct 2026). It had a
   * collapse control and two widths; it is now one narrow rail, Keshav-style,
   * with every section named under its icon at all times.
   */
  it("has no control to collapse or expand it", () => {
    renderShell(["supplier.view"], "/suppliers");

    expect(screen.queryByRole("button", { name: /(Collapse|Expand) navigation/ })).not.toBeInTheDocument();
    // The phone drawer keeps its own way in and out.
    expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
  });

  it("names every section in the rail, so nothing has to be hovered or opened to be read", () => {
    renderShell(["supplier.view", "purchase-invoice.view"], "/suppliers");

    expect(railNames()).toEqual(["Masters", "Invoicing"]);
  });

  it("shows nothing at all to a user with no permissions", () => {
    renderShell([]);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
