import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuppliersPage } from "./SuppliersPage";
import { AuthProvider } from "../../contexts/AuthContext";

/** Ids are slugged, not the raw name: a real id is a UUID and never has spaces. */
const idFor = (name: string) => `id-${name.toLowerCase().replace(/\s+/g, "-")}`;

const row = (name: string, overrides: Record<string, unknown> = {}) => ({
  id: idFor(name),
  name,
  mobile: "9825012345",
  email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
  gstNo: "24AAACD1234A1Z5",
  area: "Navrangpura",
  pincode: "380001",
  isApproved: true,
  openingBalance: "1234.56",
  capabilities: { canEdit: true, canDelete: true, canApprove: false },
  ...overrides,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const noContent = () => new Response(null, { status: 204 });

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

const callWithMethod = (method: string) =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === method);

describe("SuppliersPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests a keyset-paginated page from the suppliers endpoint", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      json({ rows: [row("Ambica Steel Traders")], nextCursor: null, total: 1 }),
    );
    renderPage();

    await screen.findByText("Ambica Steel Traders");
    expect(lastRequestUrl().pathname).toBe("/api/v1/suppliers");
    expect(lastRequestUrl().searchParams.get("limit")).toBe("25");
    // Keyset, not offset: there is no page number to send.
    expect(lastRequestUrl().searchParams.has("page")).toBe(false);
    expect(lastRequestUrl().searchParams.has("skip")).toBe(false);
  });

  /**
   * Money is grouped the Indian way — 12,34,567.89, not 1,234,567.89. The
   * business is Indian and the amounts are rupees; a lakh grouped in thousands
   * is misread at a glance by the people who use this daily.
   */
  it("formats the opening balance with Indian digit grouping", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      json({
        rows: [row("Big Balance Co", { openingBalance: "1234567.89" })],
        nextCursor: null,
        total: 1,
      }),
    );
    renderPage();

    expect(await screen.findByText("12,34,567.89")).toBeInTheDocument();
  });

  it("shows the approval flag as recorded, not as a gate", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      json({ rows: [row("Unapproved Co", { isApproved: false })], nextCursor: null, total: 1 }),
    );
    renderPage();

    expect(await screen.findByText("Not approved")).toBeInTheDocument();
  });

  it("deletes through the API and keeps the dialog open on refusal", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(json({ rows: [row("Doomed Co")], nextCursor: null, total: 1 }))
      .mockResolvedValueOnce(
        json({ message: "This supplier still has 3 purchase orders." }, 409),
      );
    renderPage();

    await screen.findByText("Doomed Co");
    await userEvent.click(screen.getByRole("button", { name: /delete doomed co/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    // The refusal is the useful part of the interaction, so it stays on screen.
    expect(await screen.findByText(/still has 3 purchase orders/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("issues a DELETE to the row's own URL when confirmed", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(json({ rows: [row("Gone Co")], nextCursor: null, total: 1 }))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValue(json({ rows: [], nextCursor: null, total: 0 }));
    renderPage();

    await screen.findByText("Gone Co");
    await userEvent.click(screen.getByRole("button", { name: /delete gone co/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(callWithMethod("DELETE")).toBeDefined());
    expect(new URL(String(callWithMethod("DELETE")![0]), "http://x").pathname).toBe(
      `/api/v1/suppliers/${idFor("Gone Co")}`,
    );
  });

  /**
   * The row action buttons render from the server's per-row capability flags,
   * not from a client-side permission list — the server is the only thing that
   * knows whether a right is row-dependent.
   */
  it("hides row actions the server did not grant", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      json({
        rows: [
          row("Read Only Co", {
            capabilities: { canEdit: false, canDelete: false, canApprove: false },
          }),
        ],
        nextCursor: null,
        total: 1,
      }),
    );
    renderPage();

    await screen.findByText("Read Only Co");
    expect(screen.queryByRole("button", { name: /edit read only co/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete read only co/i })).not.toBeInTheDocument();
  });

  it("resets to the first page when the search changes", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(json({ rows: [row("Alpha")], nextCursor: "CURSOR_1", total: 2 }))
      .mockResolvedValueOnce(json({ rows: [row("Beta")], nextCursor: null, total: 2 }))
      .mockResolvedValue(json({ rows: [], nextCursor: null, total: 0 }));
    renderPage();

    await screen.findByText("Alpha");
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText("Beta");

    await userEvent.type(screen.getByLabelText("Search"), "z");

    // A cursor points into one ordering of one filter. Carried across a change
    // to either, it addresses a sequence that no longer exists.
    await waitFor(() => expect(lastRequestUrl().searchParams.has("cursor")).toBe(false));
  });
});
