import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompaniesPage } from "./CompaniesPage";
import { AuthProvider } from "../../contexts/AuthContext";

const row = (name: string, overrides: Record<string, unknown> = {}) => ({
  id: `id-${name}`,
  name,
  invoicePrefix: "DHI",
  gstNo: "24AAACD10001Z5",
  panNo: "AAACD1000F",
  area: "Navrangpura",
  pincode: "380001",
  bankName: "HDFC Bank",
  userCount: 2,
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
        <CompaniesPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const lastRequestUrl = () => {
  const calls = vi.mocked(globalThis.fetch).mock.calls;
  return new URL(String(calls[calls.length - 1]![0]), "http://localhost");
};

describe("CompaniesPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests a bounded page from the companies endpoint", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      json({ rows: [row("D H Infra")], nextCursor: null, total: 1 }),
    );
    renderPage();

    await screen.findByText("D H Infra");
    expect(lastRequestUrl().pathname).toBe("/api/v1/companies");
    expect(lastRequestUrl().searchParams.get("limit")).toBe("25");
  });

  it("sends the cursor — not a page number — when moving forward", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(json({ rows: [row("Alpha")], nextCursor: "CURSOR_1", total: 2 }))
      .mockResolvedValueOnce(json({ rows: [row("Beta")], nextCursor: null, total: 2 }));
    renderPage();

    await screen.findByText("Alpha");
    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    await screen.findByText("Beta");
    expect(lastRequestUrl().searchParams.get("cursor")).toBe("CURSOR_1");
    expect(lastRequestUrl().searchParams.has("page")).toBe(false);
  });

  it("searches on the server and resets paging", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      json({ rows: [row("Alpha")], nextCursor: null, total: 1 }),
    );
    renderPage();
    await screen.findByText("Alpha");

    await userEvent.type(screen.getByLabelText("Search"), "24AA");

    await waitFor(() => {
      expect(lastRequestUrl().searchParams.get("search")).toBe("24AA");
      expect(lastRequestUrl().searchParams.has("cursor")).toBe(false);
    });
  });

  it("shows the GST number, which is what people look a company up by", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      json({ rows: [row("Alpha")], nextCursor: null, total: 1 }),
    );
    renderPage();

    await screen.findByText("Alpha");
    expect(screen.getByText("24AAACD10001Z5")).toBeInTheDocument();
  });

  it("says a missing GST number is missing rather than rendering a blank cell", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      json({ rows: [row("Alpha", { gstNo: null, panNo: null })], nextCursor: null, total: 1 }),
    );
    renderPage();

    await screen.findByText("Alpha");
    expect(screen.getByText("PAN not recorded")).toBeInTheDocument();
  });

  it("renders the user count once per company", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      json({ rows: [row("Alpha", { userCount: 7 })], nextCursor: null, total: 1 }),
    );
    renderPage();

    await screen.findByText("Alpha");
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("Alpha")).toHaveLength(1);
    expect(within(table).getByText("7")).toBeInTheDocument();
  });

  it("shows the server's message when the list is refused", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      json({ message: "Missing permission: company.view" }, 403),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Missing permission: company.view",
    );
  });

  it("hides the delete action when the server says this caller cannot delete", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      json({
        rows: [row("Alpha", { capabilities: { canEdit: true, canDelete: false, canApprove: false } })],
        nextCursor: null,
        total: 1,
      }),
    );
    renderPage();

    await screen.findByText("Alpha");
    expect(screen.getByRole("button", { name: /edit alpha/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete alpha/i })).not.toBeInTheDocument();
  });
});
