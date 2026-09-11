import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteGroupsPage } from "./SiteGroupsPage";
import { AuthProvider } from "../../contexts/AuthContext";

const row = (name: string, overrides: Record<string, unknown> = {}) => ({
  id: `id-${name}`,
  name,
  siteCount: 4,
  addressCount: 3,
  siteNames: ["Site 00", "Site 01", "Site 02"],
  capabilities: { canEdit: false, canDelete: false, canApprove: false },
  ...overrides,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <SiteGroupsPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const lastRequestUrl = () => {
  const calls = vi.mocked(globalThis.fetch).mock.calls;
  return new URL(String(calls[calls.length - 1]![0]), "http://localhost");
};

describe("SiteGroupsPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests a bounded page from the site-groups endpoint", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ rows: [row("North Gujarat")], nextCursor: null, total: 1 }),
    ));
    renderPage();

    await screen.findByText("North Gujarat");
    expect(lastRequestUrl().pathname).toBe("/api/v1/site-groups");
    expect(lastRequestUrl().searchParams.get("limit")).toBe("25");
  });

  /**
   * The source table stores one row per (site x address) pair, so a group with 4
   * sites and 3 addresses reads as 12 of something. The grid must show 4 and 3.
   */
  it("shows site and address counts as two separate numbers, not their product", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({
        rows: [row("North Gujarat", { siteCount: 4, addressCount: 3 })],
        nextCursor: null,
        total: 1,
      }),
    ));
    renderPage();

    await screen.findByText("North Gujarat");
    const table = screen.getByRole("table");
    expect(within(table).getByText("4")).toBeInTheDocument();
    expect(within(table).getByText("3")).toBeInTheDocument();
    expect(within(table).queryByText("12")).not.toBeInTheDocument();
  });

  it("names the first few member sites and counts the rest", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({
        rows: [
          row("North Gujarat", {
            siteCount: 6,
            siteNames: ["Site 00", "Site 01", "Site 02"],
          }),
        ],
        nextCursor: null,
        total: 1,
      }),
    ));
    renderPage();

    await screen.findByText("North Gujarat");
    expect(screen.getByText(/Site 00, Site 01, Site 02/)).toBeInTheDocument();
    expect(screen.getByText(/\+3 more/)).toBeInTheDocument();
  });

  it("does not claim there are more sites when the preview is complete", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({
        rows: [row("Small Group", { siteCount: 2, siteNames: ["Site 00", "Site 01"] })],
        nextCursor: null,
        total: 1,
      }),
    ));
    renderPage();

    await screen.findByText("Small Group");
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });

  /**
   * `Group-View` is the only group permission in the .NET solution. The screen must
   * say that plainly rather than showing buttons that nobody can be granted.
   */
  it("explains that groups are read-only, and offers no write actions", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ rows: [row("North Gujarat")], nextCursor: null, total: 1 }),
    ));
    renderPage();

    await screen.findByText("North Gujarat");
    expect(screen.getByRole("alert")).toHaveTextContent(/read-only/i);
    expect(screen.queryByRole("button", { name: /add group/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit north gujarat/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete north gujarat/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state rather than a blank table", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ rows: [], nextCursor: null, total: 0 }),
    ));
    renderPage();

    expect(await screen.findByText("No site groups match this search")).toBeInTheDocument();
  });
});
