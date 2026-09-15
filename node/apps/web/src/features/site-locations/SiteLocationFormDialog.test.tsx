import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteLocationFormDialog } from "./SiteLocationFormDialog";
import { renderWithAuth, routeFetch } from "../../test/render";

const list = (rows: unknown[]) => ({ rows, nextCursor: null, total: rows.length });

const siteRow = (id: string, name: string) => ({
  id,
  name,
  isActive: true,
  contactPersonName: null,
  contactPersonPhoneNo: null,
  area: null,
  pincode: null,
  userCount: 0,
  contactCount: 0,
  locationCount: 0,
  capabilities: { canEdit: true, canDelete: true, canApprove: false },
});

const RIVERFRONT = "11111111-1111-4111-8111-111111111111";
const DEPOT = "22222222-2222-4222-8222-222222222222";
const SITES = list([siteRow(RIVERFRONT, "Surat Riverfront"), siteRow(DEPOT, "Valsad Depot")]);

const empty = (siteId: string, siteName: string) => ({ siteId, siteName, locations: [], addresses: [] });

const EXISTING = {
  siteId: DEPOT,
  siteName: "Valsad Depot",
  locations: [{ id: "33333333-3333-4333-8333-333333333333", name: "Store Yard" }],
  addresses: [{ id: "44444444-4444-4444-8444-444444444444", address: "NH 48, Valsad" }],
};

const sent = (method: string) => {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === method);
  if (!call) return null;
  return {
    url: String(call[0]),
    body: JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>,
  };
};

const open = (siteId: string | null = null) =>
  renderWithAuth(<SiteLocationFormDialog open siteId={siteId} onClose={() => {}} />, {
    permissions: ["group.view", "group.add", "group.edit"],
  });

describe("SiteLocationFormDialog", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
    routeFetch([
      [new RegExp(`/site-locations/${RIVERFRONT}$`), empty(RIVERFRONT, "Surat Riverfront")],
      [new RegExp(`/site-locations/${DEPOT}$`), EXISTING],
      [/\/site-locations$/, EXISTING],
      [/\/sites$/, SITES],
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("finds a site by typing part of its name, and picks it from the list", async () => {
    const user = userEvent.setup();
    open();

    const box = await screen.findByRole("combobox", { name: /site/i });
    await user.type(box, "river");

    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Surat Riverfront",
    ]);

    await user.click(within(listbox).getByRole("option", { name: "Surat Riverfront" }));
    expect(box).toHaveValue("Surat Riverfront");
  });

  it("adds a location box with + and saves the site's names and addresses as a new entry", async () => {
    const user = userEvent.setup();
    open();

    const box = await screen.findByRole("combobox", { name: /site/i });
    await user.type(box, "Surat");
    await user.keyboard("{Enter}");

    const first = await screen.findByRole("textbox", { name: "Location name 1" });
    await waitFor(() => expect(first).toBeEnabled());
    await user.type(first, "Block A");
    await user.click(screen.getByRole("button", { name: "Add a location after 1" }));
    // The new box takes the cursor, so the next name can simply be typed.
    await user.keyboard("Store Yard");
    expect(screen.getByRole("textbox", { name: "Location name 2" })).toHaveValue("Store Yard");

    await user.click(screen.getByRole("button", { name: /add address/i }));
    await user.type(screen.getByRole("textbox", { name: "Address 1" }), "Gate 1, Ring Road");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent("POST")).not.toBeNull());
    expect(sent("POST")!.body).toEqual({
      siteId: RIVERFRONT,
      locations: [
        { id: null, name: "Block A" },
        { id: null, name: "Store Yard" },
      ],
      addresses: ["Gate 1, Ring Road"],
    });
  });

  it("opens a site's existing locations when that site is picked, and saves them as an edit", async () => {
    const user = userEvent.setup();
    open();

    await user.type(await screen.findByRole("combobox", { name: /site/i }), "Valsad");
    await user.keyboard("{Enter}");

    expect(await screen.findByText(/already has locations/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Location name 1" })).toHaveValue("Store Yard"),
    );
    expect(screen.getByRole("textbox", { name: "Address 1" })).toHaveValue("NH 48, Valsad");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent("PATCH")).not.toBeNull());
    expect(sent("PATCH")!.url).toMatch(new RegExp(`/site-locations/${DEPOT}$`));
    // The stored location keeps its id, so documents that name it keep it.
    expect(sent("PATCH")!.body.locations).toEqual([
      { id: "33333333-3333-4333-8333-333333333333", name: "Store Yard" },
    ]);
  });

  it("drops a blank location box rather than refusing the save", async () => {
    const user = userEvent.setup();
    open(DEPOT);

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Location name 1" })).toHaveValue("Store Yard"),
    );
    await user.click(screen.getByRole("button", { name: "Add a location after 1" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent("PATCH")).not.toBeNull());
    expect(sent("PATCH")!.body.locations).toHaveLength(1);
  });
});
