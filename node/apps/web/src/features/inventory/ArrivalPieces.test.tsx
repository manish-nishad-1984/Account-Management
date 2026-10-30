import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryFormDialog, pieceCount } from "./InventoryFormDialog";
import { json, renderWithAuth } from "../../test/render";

/**
 * A tag name and a photo for each piece of a New Arrival, and the unit of a new
 * item from the Unit master (client, 30 Oct 2026).
 */
const caps = { canEdit: true, canDelete: true, canApprove: true };
const SITE = "22222222-2222-4222-8222-222222222222";

describe("New Arrival, piece by piece", () => {
  let posted: unknown = null;
  beforeEach(() => {
    posted = null;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/units")) {
          return Promise.resolve(json({ rows: [{ id: 1, name: "NOS - Number", itemCount: 0, capabilities: caps }], nextCursor: null, total: 1 }));
        }
        if (url.includes("/inventory-items")) return Promise.resolve(json({ rows: [] }));
        if (url.includes("/inventory-inward") && init?.method === "POST") {
          posted = JSON.parse(String(init.body));
          return Promise.resolve(
            json({
              id: "11111111-1111-4111-8111-111111111111",
              siteId: SITE,
              itemId: null,
              inventoryItemId: "33333333-3333-4333-8333-333333333333",
              unitId: null,
              hasPhoto: false,
              pieces: [],
              quantity: "3.00",
              documentDate: null,
              details: null,
              isApproved: false,
              createdAt: "2026-10-30T10:00:00.000Z",
            }),
          );
        }
        return Promise.resolve(json({ rows: [], nextCursor: null, total: 0 }));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("counts the pieces of a whole quantity only", () => {
    expect(pieceCount("3")).toBe(3);
    expect(pieceCount("3.00")).toBe(3);
    expect(pieceCount("2.5")).toBe(0);
    expect(pieceCount("")).toBe(0);
  });

  it("opens a tag name and a photo for each piece, and sends them in order", async () => {
    const user = userEvent.setup();
    renderWithAuth(<InventoryFormDialog open recordId={null} onClose={() => {}} />, {
      permissions: ["inventory-inward.view", "inventory-inward.add"],
      scope: { siteId: SITE, siteName: "Akwada" },
    });

    await user.selectOptions(await screen.findByLabelText(/^Inventory item/), "+ New item…");
    await user.type(screen.getByLabelText(/^New item name/), "Drill machine");
    // The unit comes from the Unit master.
    await waitFor(() => expect(screen.getByRole("option", { name: "NOS - Number" })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/^Unit/), "NOS - Number");

    await user.type(screen.getByLabelText(/^Quantity/), "3");
    expect(screen.getAllByLabelText(/^Tag name of piece/)).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Camera:/ })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Gallery:/ })).toHaveLength(3);

    await user.type(screen.getByLabelText("Tag name of piece 1"), "DRILL-01");
    await user.type(screen.getByLabelText("Tag name of piece 3"), "DRILL-03");
    await user.click(screen.getByRole("button", { name: /record arrival/i }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      newItemName: "Drill machine",
      unit: "NOS - Number",
      quantity: "3",
      pieces: [{ tag: "DRILL-01" }, { tag: "" }, { tag: "DRILL-03" }],
    });
  });

  it("has no piece rows for a quantity that is not whole", async () => {
    const user = userEvent.setup();
    renderWithAuth(<InventoryFormDialog open recordId={null} onClose={() => {}} />, {
      permissions: ["inventory-inward.view", "inventory-inward.add"],
      scope: { siteId: SITE, siteName: "Akwada" },
    });
    await user.type(await screen.findByLabelText(/^Quantity/), "2.5");
    expect(screen.queryByLabelText(/^Tag name of piece/)).not.toBeInTheDocument();
    expect(screen.getByText(/tags and photos are for a whole quantity/i)).toBeInTheDocument();
  });
});
