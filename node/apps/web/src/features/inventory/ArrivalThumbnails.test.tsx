import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryPage } from "./InventoryPage";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * NEW ARRIVALS AS THUMBNAILS, AND ISSUE FROM THERE (client, 2 Nov 2026): the list
 * also shows as cards with each item's photo, and an arrival's item is issued from
 * its own card or row, the item and site already chosen.
 */

const SITE = "22222222-2222-2222-2222-222222222222";
const DRILL = "44444444-4444-4444-4444-444444444444";

const arrival = {
  id: "11111111-1111-1111-1111-111111111111",
  siteId: SITE,
  siteName: "Akwada Lake Front",
  itemId: null,
  itemName: "Drill Machine",
  inventoryItemId: DRILL,
  hasPhoto: false,
  pieces: [{ tag: "DR-1", hasPhoto: true, out: false }],
  unitId: null,
  unitName: "Nos",
  quantity: "1.00",
  documentDate: "2026-11-01T00:00:00.000Z",
  details: null,
  isApproved: true,
  createdAt: "2026-11-01T10:00:00.000Z",
  capabilities: { canEdit: true, canDelete: true, canApprove: true },
};

const SCOPE = { sites: [{ id: SITE, name: "Akwada Lake Front" }], canSelectAll: true };

const ALL_RIGHTS = ["inventory-inward.view", "inventory-inward.add", "inventory-inward.edit", "inventory-inward.delete"];

describe("New arrivals as thumbnails", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
    window.localStorage.clear();
    routeFetch([
      [/\/inventory-inward$/, { rows: [arrival], nextCursor: null, total: 1, unallocated: 0 }],
      [/\/pieces\/0\/photo$/, new Response(new Blob(["x"], { type: "image/png" }))],
      [
        /\/inventory-items$/,
        {
          rows: [
            {
              id: DRILL,
              name: "Drill Machine",
              unit: "Nos",
              note: null,
              hasPhoto: false,
              stock: "1.00",
              out: "0.00",
              capabilities: { canEdit: true, canDelete: true, canApprove: false },
            },
          ],
        },
      ],
      [/\/inventory-issues\/agencies$/, []],
    ]);
    URL.createObjectURL = vi.fn(() => "blob:photo");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows each arrival as a card with its photo, and remembers the choice", async () => {
    const user = userEvent.setup();
    renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS, scope: SCOPE });
    await screen.findByText("Drill Machine");

    await user.click(screen.getByRole("radio", { name: /thumbnails/i }));
    const cards = screen.getByRole("list", { name: "Arrivals" });
    expect(within(cards).getByText("Drill Machine")).toBeInTheDocument();
    expect(within(cards).getByText("Tags: DR-1")).toBeInTheDocument();
    expect(await within(cards).findByRole("img", { name: "Drill Machine" })).toBeInTheDocument();
    expect(window.localStorage.getItem("inventory-arrivals-look")).toBe("thumbs");
  });

  it("issues the arrival's item from its card, the item and site chosen", async () => {
    const user = userEvent.setup();
    renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS, scope: SCOPE });
    await screen.findByText("Drill Machine");
    await user.click(screen.getByRole("radio", { name: /thumbnails/i }));

    await user.click(screen.getByRole("button", { name: "Issue Drill Machine" }));
    const item = (await screen.findByLabelText(/^Item/)) as HTMLSelectElement;
    await waitFor(() => expect(item.value).toBe(DRILL));
  });

  it("issues from the row in the list view too", async () => {
    const user = userEvent.setup();
    renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS, scope: SCOPE });
    await screen.findByText("Drill Machine");

    await user.click(screen.getByRole("button", { name: "Issue Drill Machine" }));
    const item = (await screen.findByLabelText(/^Item/)) as HTMLSelectElement;
    await waitFor(() => expect(item.value).toBe(DRILL));
  });

  // Client, 2 Nov 2026: "click the electric board and its five boards show".
  it("opens a card to its pieces, and issues the pieces ticked", async () => {
    const boards = {
      ...arrival,
      itemName: "Electric Board",
      quantity: "3.00",
      pieces: [
        { tag: "EB-1", hasPhoto: false, out: false },
        { tag: "EB-2", hasPhoto: false, out: true },
        { tag: "EB-3", hasPhoto: false, out: false },
      ],
    };
    routeFetch([
      [/\/inventory-inward$/, { rows: [boards], nextCursor: null, total: 1, unallocated: 0 }],
      [/\/inventory-items$/, { rows: [{ id: DRILL, name: "Electric Board", unit: "Nos", note: null, hasPhoto: false, stock: "2.00", out: "1.00", capabilities: { canEdit: true, canDelete: true, canApprove: false } }] }],
      [/\/inventory-issues\/agencies$/, []],
    ]);
    const user = userEvent.setup();
    renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS, scope: SCOPE });
    await screen.findByText("Electric Board");
    await user.click(screen.getByRole("radio", { name: /thumbnails/i }));

    await user.click(screen.getByRole("button", { name: "Open Electric Board" }));
    const pieces = await screen.findByRole("list", { name: "Pieces" });
    expect(within(pieces).getByText("EB-1")).toBeInTheDocument();
    // The one out on an issue cannot be ticked.
    expect(within(pieces).getByLabelText("Issue EB-2")).toBeDisabled();
    expect(within(pieces).getByText("Issued")).toBeInTheDocument();

    await user.click(within(pieces).getByLabelText("Issue EB-1"));
    await user.click(within(pieces).getByLabelText("Issue EB-3"));
    await user.click(screen.getByRole("button", { name: "Issue 2 selected" }));

    const chosen = await screen.findByRole("list", { name: "Pieces to issue" });
    expect(within(chosen).getByText("EB-1")).toBeInTheDocument();
    expect(within(chosen).getByText("EB-3")).toBeInTheDocument();
    const quantity = screen.getByLabelText(/^Quantity/) as HTMLInputElement;
    expect(quantity.value).toBe("2");
    expect(quantity.readOnly).toBe(true);
  });
});
