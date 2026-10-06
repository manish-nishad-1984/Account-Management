import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithAuth, routeFetch } from "../../test/render";
import { SiteAddressFields } from "./SiteAddressFields";

/**
 * A LOCATION IS AN ADDRESS NOW (client request, 28 Sep 2026).
 *
 * Since 17 Sep 2026 a row on the Site Location screen pairs one name with one
 * address — it is not a name with a list of addresses to choose among below it.
 * Making someone pick the location and then separately re-find the same address
 * in the shipping dropdown was asking them to say the same thing twice; this
 * file pins that choosing the location now fills the shipping choice directly.
 */

const SITE_ID = "11111111-1111-4111-8111-111111111111";

const SITE_OPTIONS = {
  billingAddress: "Plot 12, Akwada Lake Front",
  shippingAddresses: [
    { key: "site", source: "site", address: "Plot 12, Akwada Lake Front" },
    { key: "location-loc-1", source: "location", address: "Block A gate, Hazira" },
  ],
  locations: [
    { id: "loc-1", name: "Block A", address: "Block A gate, Hazira" },
    // Named on the Site Location screen, but its own row has no address paired.
    { id: "loc-2", name: "Store Yard (no address yet)", address: "" },
  ],
  contacts: [],
};

function Harness() {
  const [shippingAddress, setShippingAddress] = useState("");
  const [locationId, setLocationId] = useState("");
  return (
    <SiteAddressFields
      siteId={SITE_ID}
      shippingAddress={shippingAddress}
      onShippingChange={setShippingAddress}
      location={{ value: locationId, onChange: setLocationId }}
    />
  );
}

describe("choosing a location on SiteAddressFields", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
    routeFetch([[/\/document-options/, SITE_OPTIONS]]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fills the shipping address with the location's own address", async () => {
    renderWithAuth(<Harness />);
    await screen.findByRole("option", { name: "Block A" });

    await userEvent.selectOptions(screen.getByLabelText("Location"), "Block A");

    expect(screen.getByLabelText("Shipping address")).toHaveValue("Block A gate, Hazira");
    // The existing "chosen address" preview is what shows it — no second display.
    expect(screen.getAllByText("Block A gate, Hazira")).toHaveLength(2); // the option, and the preview
    expect(screen.getByText("Location address")).toBeInTheDocument(); // the preview's source label
  });

  it("clears the shipping choice and says so, for a location with no address paired", async () => {
    renderWithAuth(<Harness />);
    await screen.findByRole("option", { name: "Block A" });

    // Pick the address-bearing location first, so there is something to clear.
    await userEvent.selectOptions(screen.getByLabelText("Location"), "Block A");
    expect(screen.getByLabelText("Shipping address")).toHaveValue("Block A gate, Hazira");

    await userEvent.selectOptions(screen.getByLabelText("Location"), "Store Yard (no address yet)");

    expect(screen.getByLabelText("Shipping address")).toHaveValue("");
    expect(
      screen.getByText(/this location has no address yet\. add one on the site location screen/i),
    ).toBeInTheDocument();
  });

  it("leaves an already-chosen shipping address alone when the location is cleared to none", async () => {
    renderWithAuth(<Harness />);
    await screen.findByRole("option", { name: "Block A" });

    await userEvent.selectOptions(screen.getByLabelText("Location"), "Block A");
    await userEvent.selectOptions(screen.getByLabelText("Location"), "No location");

    expect(screen.getByLabelText("Shipping address")).toHaveValue("Block A gate, Hazira");
  });

});
