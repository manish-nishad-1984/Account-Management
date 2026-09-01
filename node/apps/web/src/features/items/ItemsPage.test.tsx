import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemsPage } from "./ItemsPage";
import { ItemFormDialog } from "./ItemFormDialog";
import { AuthProvider } from "../../contexts/AuthContext";

const idFor = (name: string) => `id-${name.toLowerCase().replace(/\s+/g, "-")}`;

const row = (name: string, overrides: Record<string, unknown> = {}) => ({
  id: idFor(name),
  name,
  unitId: 1,
  unitName: "Bag",
  pricePerUnit: "395.00",
  isWithGst: true,
  gstPercent: "18.00",
  gstAmount: "71.10",
  hsnCode: "25232910",
  isApproved: true,
  capabilities: { canEdit: true, canDelete: true, canApprove: false },
  ...overrides,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const UNITS = {
  rows: [
    { id: 1, name: "Bag", itemCount: 4, capabilities: { canEdit: true, canDelete: true, canApprove: false } },
    { id: 2, name: "Ton", itemCount: 0, capabilities: { canEdit: true, canDelete: true, canApprove: false } },
  ],
  nextCursor: null,
  total: 2,
};

/**
 * Routes by URL and builds a FRESH Response per call.
 *
 * Both halves matter. These screens make more than one request — the item list
 * and the unit list for the form's dropdown — so a single `mockResolvedValue`
 * hands the same Response to both, and a Response body can only be read once:
 * the second read throws, the query fails, and the grid renders "Could not load
 * this list" with nothing to say why. Returning the wrong payload to the wrong
 * endpoint fails just as quietly, at the schema.
 */
const routeFetch = (items: unknown, units: unknown = UNITS) => {
  vi.mocked(globalThis.fetch).mockImplementation((input) => {
    const url = new URL(String(input), "http://localhost");
    return Promise.resolve(url.pathname.startsWith("/api/v1/units") ? json(units) : json(items));
  });
};

function renderWith(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>{node}</AuthProvider>
    </QueryClientProvider>,
  );
}

const bodyOfMethod = (method: string) => {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === method);
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined;
};

describe("ItemsPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the unit name from the joined units table", async () => {
    routeFetch({ rows: [row("OPC 53 Grade Cement")], nextCursor: null, total: 1 });
    renderWith(<ItemsPage />);

    await screen.findByText("OPC 53 Grade Cement");
    expect(screen.getByText("Bag")).toBeInTheDocument();
  });

  it("renders the price from the string, without parsing it to a number", async () => {
    routeFetch({
      rows: [row("Expensive Item", { pricePerUnit: "1234567.89" })],
      nextCursor: null,
      total: 1,
    });
    renderWith(<ItemsPage />);

    // Indian grouping, and the exact digits that were stored.
    expect(await screen.findByText("12,34,567.89")).toBeInTheDocument();
  });

  it("says so plainly when an item is not GST-inclusive", async () => {
    routeFetch({
      rows: [row("Plain Item", { isWithGst: false, gstPercent: null, gstAmount: null })],
      nextCursor: null,
      total: 1,
    });
    renderWith(<ItemsPage />);

    expect(await screen.findByText("Not GST")).toBeInTheDocument();
  });
});

describe("ItemFormDialog", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers the unit list in a dropdown", async () => {
    routeFetch({ rows: [], nextCursor: null, total: 0 });
    renderWith(<ItemFormDialog open itemId={null} onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Bag" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("option", { name: "Ton" })).toBeInTheDocument();
  });

  /**
   * The single most important assertion about this form. `gstAmount` is
   * derivable, so the obvious thing is to compute it as the user types — and
   * that would silently pick a winner among the three disagreeing jQuery
   * calculators of finding B-2, months before the business decides which is
   * right. The value entered is the value sent.
   */
  it("sends the GST amount exactly as typed, deriving nothing", async () => {
    routeFetch({ rows: [], nextCursor: null, total: 0 });
    renderWith(<ItemFormDialog open itemId={null} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("option", { name: "Bag" })).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/item name/i), "Test Item");
    await userEvent.selectOptions(screen.getByLabelText(/^unit/i), "1");
    await userEvent.type(screen.getByLabelText(/price per unit/i), "100.00");
    await userEvent.click(screen.getByLabelText(/gst-inclusive/i));
    await userEvent.type(await screen.findByLabelText(/gst percentage/i), "18");
    // Deliberately NOT 18.00 — if anything derived it, this would be 18.00.
    await userEvent.type(screen.getByLabelText(/gst amount/i), "17.50");
    await userEvent.click(screen.getByRole("button", { name: /create item/i }));

    await waitFor(() => expect(bodyOfMethod("POST")).toBeDefined());
    expect(bodyOfMethod("POST").gstAmount).toBe("17.50");
    expect(bodyOfMethod("POST").pricePerUnit).toBe("100.00");
  });

  it("refuses a GST-inclusive item with no percentage", async () => {
    routeFetch({ rows: [], nextCursor: null, total: 0 });
    renderWith(<ItemFormDialog open itemId={null} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("option", { name: "Bag" })).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/item name/i), "Test Item");
    await userEvent.selectOptions(screen.getByLabelText(/^unit/i), "1");
    await userEvent.type(screen.getByLabelText(/price per unit/i), "100.00");
    await userEvent.click(screen.getByLabelText(/gst-inclusive/i));
    await userEvent.click(screen.getByRole("button", { name: /create item/i }));

    expect(await screen.findByText(/needs a gst percentage/i)).toBeInTheDocument();
    expect(bodyOfMethod("POST")).toBeUndefined();
  });

  it("refuses a price with more than two decimal places", async () => {
    routeFetch({ rows: [], nextCursor: null, total: 0 });
    renderWith(<ItemFormDialog open itemId={null} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("option", { name: "Bag" })).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/item name/i), "Test Item");
    await userEvent.selectOptions(screen.getByLabelText(/^unit/i), "1");
    await userEvent.type(screen.getByLabelText(/price per unit/i), "100.005");
    await userEvent.click(screen.getByRole("button", { name: /create item/i }));

    expect(await screen.findByText(/at most 2 decimal places/i)).toBeInTheDocument();
    expect(bodyOfMethod("POST")).toBeUndefined();
  });

  it("hides the GST fields entirely when the item is not GST-inclusive", async () => {
    routeFetch({ rows: [], nextCursor: null, total: 0 });
    renderWith(<ItemFormDialog open itemId={null} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("option", { name: "Bag" })).toBeInTheDocument());
    expect(screen.queryByLabelText(/gst percentage/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/gst-inclusive/i));
    expect(await screen.findByLabelText(/gst percentage/i)).toBeInTheDocument();
  });
});
