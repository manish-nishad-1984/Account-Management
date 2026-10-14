import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddItemLink, useItemIntoLine } from "./AddItemLink";
import { json, renderWithAuth } from "../../test/render";

/**
 * "ADD NEW ITEM" BESIDE THE PRODUCT HEADING (client, 14 Oct 2026): the item is
 * created in a popup and goes on the first empty line, or a new one.
 */
const CAPS = { canEdit: true, canDelete: true, canApprove: false };
const CREATED = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "M SAND", unitId: 1, pricePerUnit: "1200.00", gstPercent: null, gstAmount: null, hsnCode: null, isApproved: true };

describe("AddItemLink", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = new URL(String(input), "http://localhost");
      if ((init as RequestInit | undefined)?.method === "POST") return Promise.resolve(json(CREATED, 201));
      if (url.pathname.includes("/units")) return Promise.resolve(json({ rows: [{ id: 1, name: "Bag", itemCount: 0, capabilities: CAPS }], nextCursor: null, total: 1 }));
      if (url.pathname.endsWith("/items/name-check")) return Promise.resolve(json({ exact: null, similar: [] }));
      return Promise.resolve(json({ rows: [], nextCursor: null, total: 0 }));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the item form, and hands back the item that was saved", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithAuth(<AddItemLink onSaved={onSaved} />, { permissions: ["item.view", "item.add"] });

    await user.click(screen.getByRole("button", { name: /add new item/i }));
    await user.type(await screen.findByLabelText(/item name/i), "M SAND");
    await user.selectOptions(await screen.findByLabelText(/^unit/i), "Bag");
    await user.type(screen.getByLabelText(/price per unit/i), "1200");
    await user.click(screen.getByRole("button", { name: /create item/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: CREATED.id })));
  });

  it("is not shown to a user who may not add items", () => {
    renderWithAuth(<AddItemLink onSaved={vi.fn()} />, { permissions: ["item.view"] });
    expect(screen.queryByRole("button", { name: /add new item/i })).not.toBeInTheDocument();
  });
});

describe("useItemIntoLine", () => {
  const setup = (lines: Array<{ itemId?: string; itemName?: string }>) => {
    const insertAfter = vi.fn();
    const assign = vi.fn();
    const hook = renderHook(
      (props: { lines: typeof lines }) =>
        useItemIntoLine({ lines: props.lines, lineCount: props.lines.length, insertAfter, assign }),
      { initialProps: { lines } },
    );
    return { insertAfter, assign, hook };
  };

  it("puts the item on the first line that has none", () => {
    const { hook, assign, insertAfter } = setup([{ itemId: "a" }, {}, { itemName: "typed" }, {}]);
    act(() => hook.result.current({ id: "new" }));
    expect(assign).toHaveBeenCalledWith(1, "new");
    expect(insertAfter).not.toHaveBeenCalled();
  });

  it("adds a line after the last when every line has an item, and puts the item on it once it exists", () => {
    const { hook, assign, insertAfter } = setup([{ itemId: "a" }, { itemName: "typed" }]);
    act(() => hook.result.current({ id: "new" }));
    expect(insertAfter).toHaveBeenCalledWith(1);
    expect(assign).not.toHaveBeenCalled(); // the new line has no fields yet

    hook.rerender({ lines: [{ itemId: "a" }, { itemName: "typed" }, {}] });
    expect(assign).toHaveBeenCalledWith(2, "new");
  });
});
