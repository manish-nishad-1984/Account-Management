import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteFormDialog } from "./SiteFormDialog";
import { renderWithAuth, routeFetch } from "../../test/render";

const SAVED = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Surat Riverfront",
  isActive: true,
  contactPersonName: "Ramesh",
  contactPersonPhoneNo: "9824000001",
  address: null,
  area: null,
  cityId: null,
  stateId: null,
  countryId: null,
  pincode: null,
  shippingAddress: null,
  shippingArea: null,
  shippingCityId: null,
  shippingStateId: null,
  shippingCountryId: null,
  shippingPincode: null,
  contacts: [],
};

const posted = () => {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find(
      ([url, init]) => /\/sites$/.test(String(url)) && (init as RequestInit | undefined)?.method === "POST",
    );
  return call ? (JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>) : null;
};

/** Several contacts per site, each a name and a number — 15 Sep 2026. */
describe("SiteFormDialog contacts", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
    routeFetch([[/\/sites$/, SAVED]], { rows: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  const open = () =>
    renderWithAuth(<SiteFormDialog open siteId={null} onClose={() => {}} />, {
      permissions: ["site.view", "site.add"],
    });

  it("adds as many contacts as are needed and sends them in order", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/site name/i), "Surat Riverfront");
    await user.click(screen.getByRole("button", { name: /add contact/i }));
    await user.type(screen.getByLabelText("Contact 1 name"), "Ramesh");
    await user.type(screen.getByLabelText("Contact 1 phone"), "9824000001");
    await user.click(screen.getByRole("button", { name: /add contact/i }));
    await user.type(screen.getByLabelText("Contact 2 phone"), "9824000002, 9824000003");

    await user.click(screen.getByRole("button", { name: /create site/i }));

    await waitFor(() => expect(posted()).not.toBeNull());
    expect(posted()!.contacts).toEqual([
      { name: "Ramesh", phone: "9824000001" },
      { name: null, phone: "9824000002, 9824000003" },
    ]);
  });

  it("refuses a contact row left completely empty, and says why on the row", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/site name/i), "Surat Riverfront");
    await user.click(screen.getByRole("button", { name: /add contact/i }));
    await user.click(screen.getByRole("button", { name: /create site/i }));

    expect(await screen.findByText(/enter a name or a phone number/i)).toBeInTheDocument();
    expect(posted()).toBeNull();
  });

  it("removes a contact row", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: /add contact/i }));
    await user.click(screen.getByRole("button", { name: "Remove contact 1" }));
    expect(screen.queryByLabelText("Contact 1 name")).not.toBeInTheDocument();
    expect(screen.getByText(/no contacts yet/i)).toBeInTheDocument();
  });
});
