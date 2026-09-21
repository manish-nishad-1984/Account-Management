import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { AuthContext } from "../contexts/AuthContext";
import { StaticRecordLayout } from "../contexts/RecordLayoutContext";
import { StaticSiteScope } from "../contexts/SiteScopeContext";
import { PageHeader } from "./ui";

/**
 * THE TRAIL IS IN THE TOP BAR, and it is derived from the route.
 *
 * Client request, 16 Sep 2026: `Masters > Companies` belongs in the header. It
 * had spent a day inside `PageHeader`, so the thing worth pinning is that it is
 * in the BANNER and not in the page — a breadcrumb in both places is the failure
 * this file exists to catch, and it is one that looks fine in a screenshot of
 * either half on its own.
 */

function renderAt(path: string, permissions = ["company.view", "dashboard.view"]) {
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
        <StaticRecordLayout layout="page">
          <StaticSiteScope>
            <AppShell>
              <PageHeader title="Companies" description="The businesses you raise documents for" />
            </AppShell>
          </StaticSiteScope>
        </StaticRecordLayout>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

const trail = () => screen.getByRole("navigation", { name: "Breadcrumb" });

describe("the breadcrumb", () => {
  it("names the section and the screen, in the top bar", () => {
    renderAt("/companies");

    const crumb = trail();
    expect(within(crumb).getByText("Masters")).toBeInTheDocument();
    expect(within(crumb).getByText("Companies")).toBeInTheDocument();

    // In the banner, not in the page body.
    expect(within(screen.getByRole("banner")).getByRole("navigation", { name: "Breadcrumb" }))
      .toBe(crumb);
  });

  it("is the only one on the screen", () => {
    renderAt("/companies");
    expect(screen.getAllByRole("navigation", { name: "Breadcrumb" })).toHaveLength(1);
  });

  it("reads the route, not the page title", () => {
    // The page passes "Companies" as its title either way; at "/" the trail must
    // say Dashboard, which is what proves it is derived rather than echoed.
    renderAt("/");

    const crumb = trail();
    expect(within(crumb).getByText("Overview")).toBeInTheDocument();
    expect(within(crumb).getByText("Dashboard")).toBeInTheDocument();
  });

  it("says nothing on a route that is not a screen", () => {
    renderAt("/nowhere");
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
  });
});
