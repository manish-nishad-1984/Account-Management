import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SitesPage } from "./SitesPage";
import { AuthProvider } from "../../contexts/AuthContext";

const row = (name: string, overrides: Record<string, unknown> = {}) => ({
  id: `id-${name}`,
  name,
  isActive: true,
  contactPersonName: "Amit Patel",
  contactPersonPhoneNo: "9720000000",
  area: "Navrangpura",
  pincode: "380001",
  userCount: 2,
  groupCount: 1,
  capabilities: { canEdit: true, canDelete: true, canApprove: false },
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
        <SitesPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const lastRequestUrl = () => {
  const calls = vi.mocked(globalThis.fetch).mock.calls;
  return new URL(String(calls[calls.length - 1]![0]), "http://localhost");
};

describe("SitesPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests a bounded page from the sites endpoint", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ rows: [row("Ahmedabad Riverfront")], nextCursor: null, total: 1 }),
    ));
    renderPage();

    await screen.findByText("Ahmedabad Riverfront");
    expect(lastRequestUrl().pathname).toBe("/api/v1/sites");
    expect(lastRequestUrl().searchParams.get("limit")).toBe("25");
  });

  it("shows the user and group counts as separate numbers", async () => {
    // The source stores group membership as a cross product; two counts that are
    // actually independent must render as two independent numbers.
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({
        rows: [row("Site A", { userCount: 3, groupCount: 2 })],
        nextCursor: null,
        total: 1,
      }),
    ));
    renderPage();

    await screen.findByText("Site A");
    const table = screen.getByRole("table");
    expect(within(table).getByText("3")).toBeInTheDocument();
    expect(within(table).getByText("2")).toBeInTheDocument();
  });

  it("marks an inactive site rather than hiding it", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({
        rows: [row("Live Site"), row("Closed Site", { isActive: false })],
        nextCursor: null,
        total: 2,
      }),
    ));
    renderPage();

    await screen.findByText("Closed Site");
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("says so when no contact person is recorded", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({
        rows: [row("Site A", { contactPersonName: null, contactPersonPhoneNo: null })],
        nextCursor: null,
        total: 1,
      }),
    ));
    renderPage();

    await screen.findByText("Site A");
    expect(screen.getByText("No contact recorded")).toBeInTheDocument();
  });

  /**
   * The legacy field holds SEVERAL numbers in one string, comma separated —
   * `9624972802,7567501707,98982598555` is a real row on the live site. A phone
   * number is `.tabular`, which is `nowrap`, so run together they were 33
   * unbreakable characters holding this grid 321px wide and scrolling sideways.
   */
  it("puts each of several phone numbers on its own line", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve(
        json({
          rows: [
            row("Site A", {
              contactPersonPhoneNo: "9624972802,7567501707, 98982598555",
            }),
          ],
          nextCursor: null,
          total: 1,
        }),
      ),
    );
    renderPage();

    await screen.findByText("Site A");
    expect(screen.getByText("9624972802")).toBeInTheDocument();
    expect(screen.getByText("7567501707")).toBeInTheDocument();
    // Trimmed: the source separates with ", " as often as with ",".
    expect(screen.getByText("98982598555")).toBeInTheDocument();
  });

  it("leaves a single number exactly as it is", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve(json({ rows: [row("Site A")], nextCursor: null, total: 1 })),
    );
    renderPage();

    await screen.findByText("Site A");
    expect(screen.getByText("9720000000")).toBeInTheDocument();
  });

  it("searches on the server and resets paging", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ rows: [row("Site A")], nextCursor: null, total: 1 }),
    ));
    renderPage();
    await screen.findByText("Site A");

    await userEvent.type(screen.getByLabelText("Search"), "Amit");

    await waitFor(() => {
      expect(lastRequestUrl().searchParams.get("search")).toBe("Amit");
      expect(lastRequestUrl().searchParams.has("cursor")).toBe(false);
    });
  });

  it("never shows a company column — the source schema has no such relationship", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ rows: [row("Site A")], nextCursor: null, total: 1 }),
    ));
    renderPage();

    await screen.findByText("Site A");
    expect(
      screen.queryByRole("columnheader", { name: /company/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state rather than a blank table", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ rows: [], nextCursor: null, total: 0 }),
    ));
    renderPage();

    expect(await screen.findByText("No sites match this search")).toBeInTheDocument();
  });
});
