import { render, screen } from "@testing-library/react";
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
 */

function renderShell(permissions: string[]) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AuthContext.Provider
        value={{
          user: { id: "u1", userName: "tester", permissions },
          isAuthenticated: true,
          isRestoring: false,
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

const navLinkNames = () =>
  screen
    .getAllByRole("link")
    .map((a) => a.textContent?.trim() ?? "")
    .filter(Boolean);

describe("the sidebar", () => {
  it("lists a screen the user can open", () => {
    renderShell(["supplier.view"]);
    expect(navLinkNames().join("|")).toContain("Suppliers");
  });

  it("does NOT list a screen the user has no permission for", () => {
    renderShell(["supplier.view"]);

    const names = navLinkNames().join("|");
    expect(names).not.toContain("Ledger & Balances");
    expect(names).not.toContain("Companies");
  });

  /**
   * The exact production case: a user with everything except the two report
   * forms, whose permissions the server does not issue because those forms are
   * inactive. Fifteen screens work; two do not.
   */
  it("hides only the reports when only the report permissions are missing", () => {
    renderShell([
      "dashboard.view",
      "company.view",
      "site.view",
      "group.view",
      "supplier.view",
      "item.view",
      "user.view",
      "purchase-request.view",
      "purchase-orders.view",
      "inward-challan.view",
      "inventory-inward.view",
      "purchase-invoice.view",
      "sales-invoice.view",
      "reports-payments.view",
    ]);

    const names = navLinkNames().join("|");
    expect(names).toContain("Payments");
    expect(names).toContain("Purchase Invoices");
    expect(names).not.toContain("Ledger & Balances");
    expect(names).not.toContain("Sales Report");
  });

  /** An empty section heading with nothing under it is worse than no heading. */
  it("drops a section heading when every screen in it is hidden", () => {
    renderShell(["supplier.view"]);
    expect(screen.queryByText("REPORTS")).not.toBeInTheDocument();
    expect(screen.queryByText("Reports")).not.toBeInTheDocument();
  });

  it("shows nothing at all to a user with no permissions", () => {
    renderShell([]);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
