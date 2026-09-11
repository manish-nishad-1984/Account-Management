import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsersPage } from "./UsersPage";
import { AuthProvider } from "../../contexts/AuthContext";

const row = (userName: string, overrides: Record<string, unknown> = {}) => ({
  id: `id-${userName}`,
  userName,
  firstName: "First",
  lastName: "Last",
  email: `${userName}@example.com`,
  phoneNo: "0000000000",
  isActive: true,
  passwordIsLegacy: false,
  siteCount: 2,
  capabilities: { canEdit: true, canDelete: false, canApprove: false },
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
        <UsersPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const lastRequestUrl = () => {
  const calls = vi.mocked(globalThis.fetch).mock.calls;
  return new URL(String(calls[calls.length - 1]![0]), "http://localhost");
};

describe("UsersPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests a bounded page — never the whole table", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ rows: [row("alice")], nextCursor: null, total: 1 }),
    ));
    renderPage();

    await screen.findByText("alice");
    expect(lastRequestUrl().searchParams.get("limit")).toBe("25");
  });

  it("renders rows and the total from the server", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ rows: [row("alice"), row("bob")], nextCursor: null, total: 2 }),
    ));
    renderPage();

    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByTestId("record-count")).toHaveTextContent("2 records");
  });

  it("sends the cursor — not a page number — when moving forward", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(json({ rows: [row("alice")], nextCursor: "CURSOR_1", total: 2 }))
      .mockResolvedValueOnce(json({ rows: [row("bob")], nextCursor: null, total: 2 }));
    renderPage();

    await screen.findByText("alice");
    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    await screen.findByText("bob");
    expect(lastRequestUrl().searchParams.get("cursor")).toBe("CURSOR_1");
    expect(lastRequestUrl().searchParams.has("page")).toBe(false);
  });

  it("disables Next on the last page", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ rows: [row("alice")], nextCursor: null, total: 1 }),
    ));
    renderPage();

    await screen.findByText("alice");
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  });

  it("sorts on the SERVER, and resets paging when the sort changes", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ rows: [row("alice")], nextCursor: "CURSOR_1", total: 9 }),
    ));
    renderPage();
    await screen.findByText("alice");

    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(lastRequestUrl().searchParams.get("cursor")).toBe("CURSOR_1"));

    await userEvent.click(screen.getByRole("button", { name: /sort by email/i }));

    await waitFor(() => {
      const params = lastRequestUrl().searchParams;
      expect(params.get("sortBy")).toBe("email");
      // Paging must reset — a cursor from the old sort order is meaningless.
      expect(params.has("cursor")).toBe(false);
    });
  });

  it("searches on the server and resets paging", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ rows: [row("alice")], nextCursor: null, total: 1 }),
    ));
    renderPage();
    await screen.findByText("alice");

    await userEvent.type(screen.getByLabelText("Search"), "ali");

    await waitFor(() => {
      expect(lastRequestUrl().searchParams.get("search")).toBe("ali");
      expect(lastRequestUrl().searchParams.has("cursor")).toBe(false);
    });
  });

  it("flags users still holding a legacy plaintext password", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({
        rows: [row("alice", { passwordIsLegacy: true }), row("bob")],
        nextCursor: null,
        total: 2,
      }),
    ));
    renderPage();

    await screen.findByText("alice");
    expect(screen.getAllByText("Legacy password")).toHaveLength(1);
  });

  it("shows the server's message when the list is refused", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ message: "Missing permission: user.view" }, 403),
    ));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Missing permission: user.view");
  });

  it("shows an empty state rather than a blank table", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ rows: [], nextCursor: null, total: 0 }),
    ));
    renderPage();

    expect(await screen.findByText("No users match this search")).toBeInTheDocument();
  });

  it("renders the site count from the server, one row per user", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json({ rows: [row("alice", { siteCount: 3 })], nextCursor: null, total: 1 }),
    ));
    renderPage();

    await screen.findByText("alice");
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("alice")).toHaveLength(1);
    expect(within(table).getByText("3")).toBeInTheDocument();
  });
});
