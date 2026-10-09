import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCombobox } from "./ItemCombobox";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * AN INVOICE OPENED FOR EDIT SHOWED A BLANK ITEM (client, 9 Oct 2026).
 *
 * With nothing typed the picker lists the first 200 items by name, and the
 * catalogue is larger. A line whose item sits further down the alphabet was not
 * among them, so the box looked empty although the id was stored and sent.
 */
const CHOSEN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const caps = { canEdit: true, canDelete: true, canApprove: false };
const list = (rows: unknown[]) => ({ rows, nextCursor: null, total: rows.length });

const item = (id: string, name: string) => ({
  id,
  name,
  unitId: 1,
  unitName: "Nos",
  pricePerUnit: "100.00",
  gstPercent: "18.00",
  gstAmount: null,
  hsnCode: null,
  isApproved: true,
  capabilities: caps,
});

const { capabilities: _omit, unitName: _unit, ...DETAIL } = item(CHOSEN_ID, "ZINC COATED COUPLER");

describe("ItemCombobox, an item that is not in the first page of the list", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
    routeFetch([
      [new RegExp(`/items/${CHOSEN_ID}$`), DETAIL],
      // The list holds other items only — the chosen one is not in it.
      [/\/items/, list([item("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "ANGLE 40x40")])],
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("still shows the chosen item's name", async () => {
    renderWithAuth(
      <ItemCombobox label="Item" itemId={CHOSEN_ID} onPick={() => undefined} />,
      { permissions: ["item.view"] },
    );

    const box = (await screen.findByLabelText("Item")) as HTMLInputElement;
    await vi.waitFor(() => expect(box.value).toBe("ZINC COATED COUPLER"));
  });
});
