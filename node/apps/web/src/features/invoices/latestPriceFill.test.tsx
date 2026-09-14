import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseInvoiceFormDialog } from "../purchase-invoices/PurchaseInvoiceFormDialog";
import { SalesInvoiceFormDialog } from "../sales-invoices/SalesInvoiceFormDialog";
import { renderWithAuth } from "../../test/render";

/**
 * Choosing an item on an invoice line fills its latest price, unit and GST
 * (client request, 14 Sep 2026). Driven through the real forms, because the
 * wiring — which box gets which value, and a slow answer for an item that was
 * since changed — is the part that can be wrong while the API is right.
 */

const list = (rows: unknown[]) => ({ rows, nextCursor: null, total: rows.length });

const CAPS = { canEdit: true, canDelete: true, canApprove: false };
const item = (id: string, name: string) => ({
  id,
  name,
  unitId: 1,
  unitName: "Bag",
  pricePerUnit: "395.00",
  isWithGst: false,
  gstPercent: null,
  gstAmount: null,
  hsnCode: null,
  isApproved: true,
  capabilities: CAPS,
});

const CEMENT = item("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "OPC Cement");
const SAND = item("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "River Sand");

const UNITS = list([
  { id: 1, name: "Bag", itemCount: 0, capabilities: CAPS },
  { id: 2, name: "Tonne", itemCount: 0, capabilities: CAPS },
]);

const fromPurchase = (itemId: string, unitPrice: string, overrides: Record<string, unknown> = {}) => ({
  itemId,
  source: "purchase-invoice",
  unitPrice,
  unitId: 2,
  gstPercent: "28.00",
  discountPerUnit: "15.00",
  documentDate: "2026-08-12T00:00:00.000Z",
  displayNo: "BB/171",
  partyName: "AL BURHAN PIPES",
  ...overrides,
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

/**
 * `latest` answers the latest-price request for each item id. A function
 * answer can hold a request open, to put a slow response behind a fast one.
 */
function routes(latest: Record<string, unknown | (() => Promise<Response>)>) {
  vi.mocked(globalThis.fetch).mockImplementation((input) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;

    const priced = path.match(/\/items\/([^/]+)\/latest-price$/);
    if (priced) {
      const answer = latest[priced[1]!];
      return typeof answer === "function" ? (answer as () => Promise<Response>)() : Promise.resolve(json(answer));
    }
    if (path.endsWith("/sites/assignable")) {
      return Promise.resolve(json({ scope: "all", sites: [{ id: "s1", name: "Akwada Lake Front" }] }));
    }
    if (path.includes("/units")) return Promise.resolve(json(UNITS));
    if (path.endsWith("/items")) return Promise.resolve(json(list([CEMENT, SAND])));
    return Promise.resolve(json(list([])));
  });
}

const latestRequests = () =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.map((call) => new URL(String(call[0]), "http://localhost"))
    .filter((url) => url.pathname.endsWith("/latest-price"));

const openPurchase = () =>
  renderWithAuth(<PurchaseInvoiceFormDialog open invoiceId={null} onClose={() => {}} />, {
    permissions: ["purchase-invoice.view", "purchase-invoice.add", "item.view"],
  });

const chooseItem = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  const select = screen.getByLabelText(/item on line 1/i);
  await waitFor(() => expect(select.querySelectorAll("option").length).toBeGreaterThan(2));
  await user.selectOptions(select, name);
};

describe("filling an invoice line with the item's latest price", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fills price, unit and GST from the latest purchase, and says where it came from", async () => {
    const user = userEvent.setup();
    routes({ [CEMENT.id]: fromPurchase(CEMENT.id, "410.00") });
    openPurchase();

    await chooseItem(user, "OPC Cement");

    await waitFor(() => expect(screen.getByLabelText(/price on line 1/i)).toHaveValue("410.00"));
    expect(screen.getByLabelText(/^unit on line 1/i)).toHaveValue("2");
    expect(screen.getByLabelText(/gst percent on line 1/i)).toHaveValue("28.00");
    expect(screen.getByLabelText(/quantity on line 1/i)).toHaveValue("1");
    expect(screen.getByLabelText(/discount per unit on line 1/i)).toHaveValue("15.00");
    expect(
      screen.getByRole("img", { name: "Last purchase · 12 Aug 2026 · invoice BB/171 · AL BURHAN PIPES" }),
    ).toBeInTheDocument();
    expect(latestRequests()[0]!.searchParams.get("direction")).toBe("out");
  });

  it("says when the price is the item master's, because the item was never invoiced", async () => {
    const user = userEvent.setup();
    routes({
      [CEMENT.id]: fromPurchase(CEMENT.id, "395.00", {
        source: "item-master",
        unitId: 1,
        gstPercent: null,
        discountPerUnit: null,
        documentDate: null,
        displayNo: null,
        partyName: null,
      }),
    });
    openPurchase();

    await chooseItem(user, "OPC Cement");

    await waitFor(() => expect(screen.getByLabelText(/price on line 1/i)).toHaveValue("395.00"));
    expect(screen.getByLabelText(/gst percent on line 1/i)).toHaveValue("");
    expect(screen.getByLabelText(/discount per unit on line 1/i)).toHaveValue("");
    expect(screen.getByRole("img", { name: /^Item master price/ })).toBeInTheDocument();
  });

  it("keeps a quantity already typed rather than resetting it to 1", async () => {
    const user = userEvent.setup();
    routes({ [CEMENT.id]: fromPurchase(CEMENT.id, "410.00") });
    openPurchase();

    await user.type(await screen.findByLabelText(/quantity on line 1/i), "12");
    await user.type(screen.getByLabelText(/price on line 1/i), "1");
    await chooseItem(user, "OPC Cement");

    await waitFor(() => expect(screen.getByLabelText(/price on line 1/i)).toHaveValue("410.00"));
    expect(screen.getByLabelText(/quantity on line 1/i)).toHaveValue("12");
  });

  /**
   * THE RACE. Cement's answer is slow and Sand's is fast. The person chose Sand
   * last, so Sand's price must stay — not be overwritten when Cement's answer
   * finally lands.
   */
  it("ignores a slow answer for an item that has since been changed", async () => {
    const user = userEvent.setup();
    let releaseCement: () => void = () => {};
    routes({
      [CEMENT.id]: () =>
        new Promise<Response>((resolve) => {
          releaseCement = () => resolve(json(fromPurchase(CEMENT.id, "410.00")));
        }),
      [SAND.id]: fromPurchase(SAND.id, "1800.00", { unitId: 2, gstPercent: "5.00" }),
    });
    openPurchase();

    await chooseItem(user, "OPC Cement");
    await user.selectOptions(screen.getByLabelText(/item on line 1/i), "River Sand");
    await waitFor(() => expect(screen.getByLabelText(/price on line 1/i)).toHaveValue("1800.00"));

    releaseCement();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByLabelText(/price on line 1/i)).toHaveValue("1800.00");
    expect(screen.getByLabelText(/gst percent on line 1/i)).toHaveValue("5.00");
  });

  it("asks for the latest SALE on a sales invoice", async () => {
    const user = userEvent.setup();
    routes({
      [CEMENT.id]: fromPurchase(CEMENT.id, "450.00", { source: "sales-invoice" }),
    });
    renderWithAuth(<SalesInvoiceFormDialog open invoiceId={null} onClose={() => {}} />, {
      permissions: ["sales-invoice.view", "sales-invoice.add", "item.view"],
    });

    await chooseItem(user, "OPC Cement");

    await waitFor(() => expect(screen.getByLabelText(/price on line 1/i)).toHaveValue("450.00"));
    expect(latestRequests()[0]!.searchParams.get("direction")).toBe("in");
    expect(screen.getByRole("img", { name: /^Last sale/ })).toBeInTheDocument();
  });
});
