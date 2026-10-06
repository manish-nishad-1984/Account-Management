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
    if (url.pathname.endsWith("/items") && url.searchParams.has("search")) {
      const words = (url.searchParams.get("search") ?? "").toLowerCase().split(" ");
      const hit = words.every((word) => EXISTING.name.toLowerCase().includes(word));
      return Promise.resolve(json({ rows: hit ? [{ ...EXISTING, unitId: 1, unitName: "Bag", pricePerUnit: "395.00", gstPercent: null, gstAmount: null, hsnCode: null, isApproved: true, capabilities: CAPS }] : [], nextCursor: null, total: hit ? 1 : 0 }));
    }
    if (url.pathname.includes("/units")) return Promise.resolve(json(UNITS));
    if (url.pathname.endsWith(`/items/${EXISTING.id}`)) {
      return Promise.resolve(
        json({
          id: EXISTING.id,
          name: EXISTING.name,
          unitId: 1,
          pricePerUnit: "395.00",
          gstPercent: null,
          gstAmount: null,
          hsnCode: null,
          isApproved: true,
        }),
      );
    }
    if ((init?.method ?? "GET").toUpperCase() === "PATCH") {
      return Promise.resolve(json({ id: EXISTING.id, name: "renamed", unitId: 1, pricePerUnit: "400.00", gstPercent: null, gstAmount: null, hsnCode: null, isApproved: true }));
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

    const similar = await screen.findByRole("listbox", { name: "Existing items" });
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

  describe("starting a NEW item from a suggested one", () => {
    const openAddAs = (permissions: string[]) =>
      renderWithAuth(<ItemFormDialog open itemId={null} onClose={() => {}} />, { permissions });
    const patches = () =>
      vi.mocked(globalThis.fetch).mock.calls.filter((call) => (call[1]?.method ?? "").toUpperCase() === "PATCH");

    it("copies the picked item's details, and saving after a rename creates a NEW item, not an edit", async () => {
      const user = userEvent.setup();
      openAddAs(["item.view", "item.add"]);

      await user.type(screen.getByLabelText(/item name/i), "cement opc");
      await user.click(await screen.findByRole("option", { name: EXISTING.name }));

      const name = screen.getByLabelText(/item name/i);
      await waitFor(() => expect(name).toHaveValue(EXISTING.name));
      expect(screen.getByLabelText(/price per unit/i)).toHaveValue("395.00");
      expect(screen.getByRole("button", { name: /create item/i })).toBeInTheDocument();

      await user.clear(name);
      await user.type(name, "OPC 43 Grade Cement");
      await user.click(screen.getByRole("button", { name: /create item/i }));

      await waitFor(() => expect(posts()).toHaveLength(1));
      const body = JSON.parse(String(posts()[0]![1]!.body));
      expect(body.name).toBe("OPC 43 Grade Cement");
      expect(body.pricePerUnit).toBe("395.00");
      expect(patches()).toHaveLength(0);
    });

    it("will not save the copy under the picked item's own name", async () => {
      const user = userEvent.setup();
      openAddAs(["item.view", "item.add"]);

      await user.type(screen.getByLabelText(/item name/i), "cement opc");
      await user.click(await screen.findByRole("option", { name: EXISTING.name }));
      await waitFor(() => expect(screen.getByLabelText(/item name/i)).toHaveValue(EXISTING.name));
      await screen.findByText(/already exists/);

      await user.click(screen.getByRole("button", { name: /create item/i }));

      expect(posts()).toHaveLength(0);
    });

    it("offers to start from the item when the same name already exists", async () => {
      const user = userEvent.setup();
      openAddAs(["item.view", "item.add"]);

      await user.type(screen.getByLabelText(/item name/i), "OPC 53 Grade Cement");
      await user.click(await screen.findByRole("button", { name: /start from this item/i }));

      await waitFor(() => expect(screen.getByLabelText(/price per unit/i)).toHaveValue("395.00"));
      expect(screen.getByRole("button", { name: /create item/i })).toBeInTheDocument();
    });

    it("can start blank again", async () => {
      const user = userEvent.setup();
      openAddAs(["item.view", "item.add"]);

      await user.type(screen.getByLabelText(/item name/i), "cement opc");
      await user.click(await screen.findByRole("option", { name: EXISTING.name }));
      await user.click(await screen.findByRole("button", { name: /start blank/i }));

      await waitFor(() => expect(screen.getByLabelText(/item name/i)).toHaveValue(""));
      expect(screen.getByLabelText(/price per unit/i)).toHaveValue("");
    });

    it("shows the matches as a dropdown as soon as typing pauses, and the keyboard picks one", async () => {
      const user = userEvent.setup();
      openAddAs(["item.view", "item.add"]);

      await user.type(screen.getByLabelText(/item name/i), "cement");

      expect(await screen.findByRole("listbox", { name: "Existing items" }, { timeout: 4000 })).toHaveTextContent(EXISTING.name);
      await user.keyboard("{ArrowDown}{Enter}");
      await waitFor(() => expect(screen.getByLabelText(/price per unit/i)).toHaveValue("395.00"));
      expect(screen.getByRole("button", { name: /create item/i })).toBeInTheDocument();
    });
  });
});
