import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDialog } from "./IssueDialog";
import { ToReceiveBack } from "./IssueLists";
import { json, renderWithAuth } from "../../test/render";

/** Issue an item to an agency's person, and receive it back from the dashboard (client, 26 Oct 2026). */
const SITE = "22222222-2222-4222-8222-222222222222";
const DRILL = "33333333-3333-4333-8333-333333333333";
const AGENCY = "44444444-4444-4444-8444-444444444444";
const CONTACT = "55555555-5555-4555-8555-555555555555";
const PERSON = "66666666-6666-4666-8666-666666666666";
const ISSUE = "77777777-7777-4777-8777-777777777777";
const caps = { canEdit: true, canDelete: true, canApprove: false };
const OUT = {
  id: ISSUE, siteId: SITE, siteName: "Akwada", source: "inventory", inventoryItemId: DRILL, itemId: null, itemName: "Drill Machine",
  unitName: "Nos", quantity: "2.00", returnable: true, agencyId: AGENCY, agencyName: "RAM SHUTTERING", contactName: "Ramesh",
  contactMobile: "9876543210", personId: PERSON, personName: "Suresh", personMobile: "9000000001", personHasPhoto: false, itemHasPhoto: false,
  issuedAt: "2026-10-26T04:30:00.000Z", note: null, returnedQuantity: null, returnedAt: null, returnNote: null, status: "out", capabilities: caps,
};

const calls = () => vi.mocked(globalThis.fetch).mock.calls.map(([input, init]) => ({ url: String(input), init: init as RequestInit | undefined }));
const sent = (path: string) => {
  const call = calls().find(({ url, init }) => url.includes(path) && init?.method === "POST");
  return call ? JSON.parse(String(call.init!.body)) : null;
};

describe("issuing and receiving back", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/sites/assignable")) return Promise.resolve(json({ sites: [{ id: SITE, name: "Akwada" }], canSelectAll: true }));
        if (url.includes("/inventory-items")) {
          return Promise.resolve(json({ rows: [{ id: DRILL, name: "Drill Machine", unit: "Nos", note: null, hasPhoto: false, stock: "5.00", out: "0.00", capabilities: caps }] }));
        }
        if (url.includes("/inventory-issues/agencies")) {
          return Promise.resolve(json([{ id: AGENCY, name: "RAM SHUTTERING", contacts: [{ id: CONTACT, name: "Ramesh", mobile: "9876543210" }] }]));
        }
        if (url.includes("/agency-persons") && init?.method === "POST") {
          return Promise.resolve(json({ id: PERSON, agencyId: AGENCY, name: "Suresh", mobile: "9000000001", hasPhoto: false }));
        }
        if (url.includes("/agency-persons")) return Promise.resolve(json([]));
        if (url.includes("/receive")) return Promise.resolve(json({ ...OUT, status: "returned", returnedQuantity: "2.00", returnedAt: "2026-10-26T13:00:00.000Z" }));
        if (url.includes("/inventory-issues") && init?.method === "POST") return Promise.resolve(json(OUT));
        if (url.includes("/inventory-issues")) return Promise.resolve(json({ rows: [OUT] }));
        return Promise.resolve(json({ rows: [], nextCursor: null, total: 0 }));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("issues an inventory item to a new person of the agency, through its main contact", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithAuth(<IssueDialog open onClose={onClose} />, {
      permissions: ["inventory-inward.view", "inventory-inward.add"],
      scope: { siteId: SITE, siteName: "Akwada" },
    });

    await screen.findByRole("option", { name: /Drill Machine · in stock 5 Nos/ });
    await user.selectOptions(screen.getByLabelText(/^Item/), DRILL);
    await user.type(screen.getByLabelText(/^Quantity/), "2");
    await screen.findByRole("option", { name: "RAM SHUTTERING" });
    await user.selectOptions(screen.getByLabelText(/^Agency/), AGENCY);
    expect(screen.getByLabelText("Main contact")).toHaveValue(CONTACT);
    await user.selectOptions(await screen.findByLabelText(/^Person taking it/), "__new__");
    await user.type(screen.getByLabelText(/^Name/), "Suresh");
    await user.type(screen.getByLabelText("Mobile"), "9000000001");
    await user.click(screen.getByRole("button", { name: "Issue" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent("/agency-persons")).toEqual({ agencyId: AGENCY, name: "Suresh", mobile: "9000000001", photoKey: null });
    expect(sent("/inventory-issues")).toMatchObject({
      siteId: SITE, source: "inventory", inventoryItemId: DRILL, quantity: "2", returnable: true, agencyId: AGENCY, agencyContactId: CONTACT, personId: PERSON,
    });
  });

  it("lists on the dashboard what is to come back, and receives it", async () => {
    const user = userEvent.setup();
    renderWithAuth(<ToReceiveBack />, { permissions: ["inventory-inward.view", "inventory-inward.add"] });
    const section = await screen.findByRole("region", { name: /to receive back \(1\)/i });
    expect(within(section).getByText("Drill Machine")).toBeInTheDocument();
    expect(within(section).getByText("RAM SHUTTERING · Ramesh 9876543210")).toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "Receive" }));
    const dialog = await screen.findByRole("dialog", { name: /receive back/i });
    expect(within(dialog).getByLabelText("Quantity received")).toHaveValue("2");
    await user.click(within(dialog).getByRole("button", { name: "Receive" }));
    await waitFor(() => expect(sent(`/inventory-issues/${ISSUE}/receive`)).toEqual({ quantity: "2", note: null }));
  });
});
