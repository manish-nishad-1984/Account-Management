import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuppliersPage } from "./SuppliersPage";
import { AuthProvider } from "../../contexts/AuthContext";
import { DEFAULT_GRID_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "../../lib/page-size";

/**
 * How many rows a page holds is the reader's choice (client request,
 * 16 Sep 2026). Driven through Suppliers; every grid gets the control from
 * `useMasterScreen.gridProps`, so one screen proves the wiring.
 *
 * The case worth having a test for is the LAST one: changing the size while
 * holding a cursor. Keyset paging does not fail when a cursor and a limit
 * disagree — it returns a page of rows from nowhere in particular — so nothing
 * but an assertion catches it.
 */

const row = (name: string) => ({
  id: `id-${name.toLowerCase().replace(/\s+/g, "-")}`,
  name,
  mobile: "9825012345",
  email: null,
  gstNo: null,
  area: null,
  pincode: null,
  isApproved: true,
  openingBalance: "0.00",
  capabilities: { canEdit: true, canDelete: false, canApprove: false },
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

const page = (nextCursor: string | null) =>
  json({ rows: [row("Ambica Steel Traders")], nextCursor, total: 1 });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <SuppliersPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const lastRequestUrl = () => {
  const calls = vi.mocked(globalThis.fetch).mock.calls;
  return new URL(String(calls[calls.length - 1]![0]), "http://localhost");
};

describe("rows per page", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
    // The choice is remembered per person, so one test's pick must not be the
    // next test's starting point.
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("opens at 20 and offers 5 to 100 in steps of 5", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(page(null)));
    renderPage();

    await screen.findByText("Ambica Steel Traders");
    expect(lastRequestUrl().searchParams.get("limit")).toBe(String(DEFAULT_GRID_PAGE_SIZE));

    const select = screen.getByLabelText(/rows/i);
    expect(select).toHaveValue(String(DEFAULT_GRID_PAGE_SIZE));
    expect([...(select as HTMLSelectElement).options].map((option) => option.value)).toEqual(
      PAGE_SIZE_OPTIONS.map(String),
    );
    // Pinned against the list itself, so a typo in it cannot pass by agreeing
    // with the control it generated.
    expect(PAGE_SIZE_OPTIONS).toEqual([
      5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100,
    ]);
  });

  it("asks the server for the size the reader picked", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(page(null)));
    renderPage();

    await screen.findByText("Ambica Steel Traders");
    await user.selectOptions(screen.getByLabelText(/rows/i), "5");

    await waitFor(() => expect(lastRequestUrl().searchParams.get("limit")).toBe("5"));
  });

  it("goes back to page one, dropping a cursor taken at the old size", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(page("cursor-from-page-1")));
    renderPage();

    await screen.findByText("Ambica Steel Traders");
    await user.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(lastRequestUrl().searchParams.get("cursor")).toBe("cursor-from-page-1"));
    expect(screen.getByText("2")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/rows/i), "50");

    await waitFor(() => expect(lastRequestUrl().searchParams.get("limit")).toBe("50"));
    // The cursor encoded a position in pages of 20. Carried across, the server
    // would answer with 50 rows starting from row 21 — which is not page 1 and
    // not page 2 of the new paging, and the pager under it would be counting
    // something that does not exist.
    expect(lastRequestUrl().searchParams.has("cursor")).toBe(false);
  });

  it("remembers the choice for the next screen this person opens", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(page(null)));

    const first = renderPage();
    await screen.findByText("Ambica Steel Traders");
    await user.selectOptions(screen.getByLabelText(/rows/i), "40");
    await waitFor(() => expect(lastRequestUrl().searchParams.get("limit")).toBe("40"));
    first.unmount();

    renderPage();
    await screen.findByText("Ambica Steel Traders");
    expect(lastRequestUrl().searchParams.get("limit")).toBe("40");
  });
});
