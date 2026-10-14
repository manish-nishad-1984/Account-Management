import { useState } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCombobox } from "./ItemCombobox";
import { json, renderWithAuth } from "../../test/render";

/**
 * "ADD NEW ITEM" FROM A DOCUMENT LINE (client, 14 Oct 2026): a new item is
 * created in a popup without leaving the invoice, and lands on the line.
 */
const CAPS = { canEdit: true, canDelete: true, canApprove: false };
const NEW_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function Harness({ allowAddNew = true }: { allowAddNew?: boolean }) {
  const [picked, setPicked] = useState({ id: "", name: "" });
  return (
    <>
      <ItemCombobox
        label="Item"
        itemId={picked.id}
        allowAddNew={allowAddNew}
        onPick={(id, name) => setPicked({ id, name })}
      />
      <output aria-label="picked">{picked.id}</output>
    </>
  );
}

const posts = () =>
  vi.mocked(globalThis.fetch).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

describe("ItemCombobox, Add new item", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = new URL(String(input), "http://localhost");
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (method === "POST" && url.pathname.endsWith("/items")) {
        return Promise.resolve(
          json({ id: NEW_ID, name: "M SAND", unitId: 1, pricePerUnit: "1200.00", gstPercent: null, gstAmount: null, hsnCode: null, isApproved: true }, 201),
        );
      }
      if (url.pathname.endsWith(`/items/${NEW_ID}`)) {
        return Promise.resolve(json({ id: NEW_ID, name: "M SAND", unitId: 1, pricePerUnit: "1200.00", gstPercent: null, gstAmount: null, hsnCode: null, isApproved: true }));
      }
      if (url.pathname.includes("/units")) {
        return Promise.resolve(json({ rows: [{ id: 1, name: "Bag", itemCount: 0, capabilities: CAPS }], nextCursor: null, total: 1 }));
      }
      if (url.pathname.endsWith("/items/name-check")) return Promise.resolve(json({ exact: null, similar: [] }));
      return Promise.resolve(json({ rows: [], nextCursor: null, total: 0 }));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the item form with the typed name, and the saved item is picked for the line", async () => {
    const user = userEvent.setup();
    renderWithAuth(<Harness />, { permissions: ["item.view", "item.add"] });

    await user.type(screen.getByLabelText("Item"), "M SAND");
    await user.click(await screen.findByRole("button", { name: /add new item/i }));

    const name = await screen.findByLabelText(/item name/i);
    expect(name).toHaveValue("M SAND");

    await user.selectOptions(await screen.findByLabelText(/^unit/i), "Bag");
    await user.type(screen.getByLabelText(/price per unit/i), "1200");
    await user.click(screen.getByRole("button", { name: /create item/i }));

    await waitFor(() => expect(screen.getByLabelText("picked")).toHaveTextContent(NEW_ID));
    expect(posts()).toHaveLength(1);
  });

  it("is not offered to a user who may not add items, nor where the screen did not ask for it", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithAuth(<Harness />, { permissions: ["item.view"] });
    await user.click(screen.getByLabelText("Item"));
    await screen.findByRole("listbox");
    expect(screen.queryByRole("button", { name: /add new item/i })).not.toBeInTheDocument();
    unmount();

    renderWithAuth(<Harness allowAddNew={false} />, { permissions: ["item.view", "item.add"] });
    await user.click(screen.getByLabelText("Item"));
    await screen.findByRole("listbox");
    expect(screen.queryByRole("button", { name: /add new item/i })).not.toBeInTheDocument();
  });
});
