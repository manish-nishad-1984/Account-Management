import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteLocationFormDialog } from "./SiteLocationFormDialog";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * The Site Location form — ONE LIST OF PAIRS since 17 Sep 2026.
 *
 * It was two independent lists until the business reversed that. The case worth
 * the most here is the last one: a pair carried across by migration 0020, which
 * has an address and NO NAME. That shape has to load, say what it is, and be
 * nameable without losing the address — it is the state every pre-existing
 * address on production is sitting in.
 */

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
const BHAVNAGAR = "55555555-5555-4555-8555-555555555555";
const SITES = list([
  siteRow(RIVERFRONT, "Surat Riverfront"),
  siteRow(DEPOT, "Valsad Depot"),
  siteRow(BHAVNAGAR, "Bhavnagar Yard"),
]);

const empty = (siteId: string, siteName: string) => ({ siteId, siteName, locations: [] });

const STORE_YARD = "33333333-3333-4333-8333-333333333333";
const EXISTING = {
  siteId: DEPOT,
  siteName: "Valsad Depot",
  locations: [{ id: STORE_YARD, name: "Store Yard", address: "NH 48, Valsad" }],
};

/** What migration 0020 leaves behind: an address, no name. */
const MIGRATED_A = "66666666-6666-4666-8666-666666666666";
const MIGRATED_B = "77777777-7777-4777-8777-777777777777";
const MIGRATED = {
  siteId: BHAVNAGAR,
  siteName: "Bhavnagar Yard",
  locations: [
    { id: MIGRATED_A, name: "", address: "Plot 5, Bardoli Road" },
    { id: MIGRATED_B, name: "", address: "Survey 122, Kamrej" },
  ],
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
      [new RegExp(`/site-locations/${BHAVNAGAR}$`), MIGRATED],
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

  it("saves each location together with its own address", async () => {
    const user = userEvent.setup();
    open();

    const box = await screen.findByRole("combobox", { name: /site/i });
    await user.type(box, "Surat");
    await user.keyboard("{Enter}");

    const first = await screen.findByRole("textbox", { name: "Location name 1" });
    await waitFor(() => expect(first).toBeEnabled());
    await user.type(first, "Block A");
    await user.type(screen.getByRole("textbox", { name: "Address 1" }), "Gate 1, Ring Road");

    await user.click(screen.getByRole("button", { name: "Add a location after 1" }));
    // The new box takes the cursor, so the next name can simply be typed.
    await user.keyboard("Store Yard");
    expect(screen.getByRole("textbox", { name: "Location name 2" })).toHaveValue("Store Yard");
    await user.type(screen.getByRole("textbox", { name: "Address 2" }), "Gate 2, Ring Road");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent("POST")).not.toBeNull());
    expect(sent("POST")!.body).toEqual({
      siteId: RIVERFRONT,
      locations: [
        { id: null, name: "Block A", address: "Gate 1, Ring Road" },
        { id: null, name: "Store Yard", address: "Gate 2, Ring Road" },
      ],
    });
  });

  it("opens a site's existing pairs when that site is picked, and saves them as an edit", async () => {
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
      { id: STORE_YARD, name: "Store Yard", address: "NH 48, Valsad" },
    ]);
  });

  it("drops a pair with both halves blank rather than refusing the save", async () => {
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

  describe("a pair carried over by the migration", () => {
    it("loads the address, says why it has no name, and keeps the address when named", async () => {
      const user = userEvent.setup();
      open(BHAVNAGAR);

      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: "Address 1" })).toHaveValue(
          "Plot 5, Bardoli Road",
        ),
      );
      expect(screen.getByRole("textbox", { name: "Location name 1" })).toHaveValue("");

      // The screen explains the blank rather than leaving it looking like a bug.
      expect(screen.getByText(/2 addresses here have no location name yet/i)).toBeInTheDocument();

      await user.type(screen.getByRole("textbox", { name: "Location name 1" }), "Block A");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(sent("PATCH")).not.toBeNull());
      expect(sent("PATCH")!.body.locations).toEqual([
        { id: MIGRATED_A, name: "Block A", address: "Plot 5, Bardoli Road" },
        // Still unnamed, and still kept — nothing is dropped for being half done.
        { id: MIGRATED_B, name: "", address: "Survey 122, Kamrej" },
      ]);
    });
  });
});
