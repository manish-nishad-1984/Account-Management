import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemFormDialog } from "./ItemFormDialog";
import { renderWithAuth } from "../../test/render";

/**
 * The item form's name check (client request, 14 Sep 2026): as the name is
 * typed, show items with the same or a similar name, and refuse the same name.
 */

const CAPS = { canEdit: true, canDelete: true, canApprove: false };
const UNITS = { rows: [{ id: 1, name: "Bag", itemCount: 0, capabilities: CAPS }], nextCursor: null, total: 1 };
const EXISTING = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", name: "OPC 53 Grade Cement" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Answers the name check from the name asked about, the way the server would. */
function routes() {
  vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/items/name-check")) {
      const name = (url.searchParams.get("name") ?? "").toLowerCase().replace(/\s+/g, " ");
      const excludeId = url.searchParams.get("excludeId");
      const isSame = name === EXISTING.name.toLowerCase() && excludeId !== EXISTING.id;
      const isSimilar = !isSame && name.split(" ").every((word) => EXISTING.name.toLowerCase().includes(word));
      return Promise.resolve(
        json({ exact: isSame ? EXISTING : null, similar: isSimilar && excludeId !== EXISTING.id ? [EXISTING] : [] }),
      );
    }
    if (url.pathname.includes("/units")) return Promise.resolve(json(UNITS));
    if (url.pathname.endsWith(`/items/${EXISTING.id}`)) {
      return Promise.resolve(
        json({
          id: EXISTING.id,
          name: EXISTING.name,
          unitId: 1,
          pricePerUnit: "395.00",
          isWithGst: false,
          gstPercent: null,
          gstAmount: null,
          hsnCode: null,
          isApproved: true,
        }),
      );
    }
    if ((init?.method ?? "GET").toUpperCase() === "POST") {
      return Promise.resolve(json({ ...EXISTING, id: "new" }, 201));
    }
    return Promise.resolve(json({ rows: [], nextCursor: null, total: 0 }));
  });
}

const nameChecks = () =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.map((call) => new URL(String(call[0]), "http://localhost"))
    .filter((url) => url.pathname.endsWith("/name-check"));

const posts = () =>
  vi.mocked(globalThis.fetch).mock.calls.filter((call) => (call[1]?.method ?? "").toUpperCase() === "POST");

const openAdd = () =>
  renderWithAuth(<ItemFormDialog open itemId={null} onClose={() => {}} />, {
    permissions: ["item.view", "item.add"],
  });

describe("ItemFormDialog name check", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    routes();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists items with a similar name while typing", async () => {
    const user = userEvent.setup();
    openAdd();

    await user.type(screen.getByLabelText(/item name/i), "cement opc");

    const similar = await screen.findByRole("list", { name: "Items with a similar name" });
    expect(similar).toHaveTextContent("OPC 53 Grade Cement");
  });

  it("says the same name already exists, ignoring case and spacing", async () => {
    const user = userEvent.setup();
    openAdd();

    await user.type(screen.getByLabelText(/item name/i), "opc 53  grade CEMENT");

    expect(
      await screen.findByText('An item named "OPC 53 Grade Cement" already exists'),
    ).toBeInTheDocument();
  });

  it("will not save a name that already exists", async () => {
    const user = userEvent.setup();
    openAdd();

    await user.type(screen.getByLabelText(/item name/i), "OPC 53 Grade Cement");
    await user.selectOptions(await screen.findByLabelText(/^unit/i), "Bag");
    await user.type(screen.getByLabelText(/price per unit/i), "400");
    await screen.findByText(/already exists/);

    await user.click(screen.getByRole("button", { name: /create item/i }));

    await waitFor(() => expect(screen.getByLabelText(/item name/i)).toHaveAttribute("aria-invalid", "true"));
    expect(posts()).toHaveLength(0);
  });

  /** One request per pause in typing, not one per key. */
  it("waits for typing to pause before asking", async () => {
    const user = userEvent.setup();
    openAdd();

    await user.type(screen.getByLabelText(/item name/i), "River Sand");
    await waitFor(() => expect(nameChecks().length).toBeGreaterThan(0));

    expect(nameChecks()).toHaveLength(1);
    expect(nameChecks()[0]!.searchParams.get("name")).toBe("River Sand");
  });

  it("does not flag an item being edited as a duplicate of itself", async () => {
    renderWithAuth(<ItemFormDialog open itemId={EXISTING.id} onClose={() => {}} />, {
      permissions: ["item.view", "item.edit"],
    });

    await waitFor(() => expect(screen.getByLabelText(/item name/i)).toHaveValue(EXISTING.name));
    await waitFor(() => expect(nameChecks().length).toBeGreaterThan(0));

    expect(nameChecks()[0]!.searchParams.get("excludeId")).toBe(EXISTING.id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument();
  });
});
