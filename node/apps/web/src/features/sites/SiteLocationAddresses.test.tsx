import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithAuth, routeFetch } from "../../test/render";
import { SiteLocationAddresses } from "./SiteLocationAddresses";

/**
 * Purchase invoices (client request, 6 Oct 2026): location, billing and shipping
 * on one row. Shipping is the location's address - blank, and not editable, when
 * the location has none or there is no location.
 */

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const OPTIONS = {
  billingAddress: "Plot 12, Akwada Lake Front",
  shippingAddresses: [
    { key: "site", source: "site", address: "Plot 12, Akwada Lake Front" },
    { key: "location-loc-1", source: "location", address: "Block A gate, Hazira" },
  ],
  locations: [
    { id: "loc-1", name: "Block A", address: "Block A gate, Hazira" },
    { id: "loc-2", name: "Store Yard (no address yet)", address: "" },
    // Its address is the SITE's own, so the shipping list (which drops a repeat) has no
    // entry for it. Shipping must still show it.
    { id: "loc-3", name: "Main Gate", address: "Plot 12, Akwada Lake Front" },
  ],
  contacts: [],
};

function Harness({ initialShipping = "" }: { initialShipping?: string }) {
  const [shipping, setShipping] = useState(initialShipping);
  const [locationId, setLocationId] = useState("");
  return (
    <SiteLocationAddresses
      siteId={SITE_ID}
      shippingAddress={shipping}
      onShippingChange={setShipping}
      location={{ value: locationId, onChange: setLocationId }}
    />
  );
}

const box = (label: string) => document.querySelector(`div[aria-label='${label}']`);

describe("SiteLocationAddresses", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
    routeFetch([[/\/document-options/, OPTIONS]]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the site's billing address, and shipping blank until a location is chosen", async () => {
    renderWithAuth(<Harness />);
    await screen.findByRole("option", { name: "Block A" });
    expect(box("Billing address")).toHaveTextContent("Plot 12, Akwada Lake Front");
    expect(box("Shipping address")).toBeEmptyDOMElement();
    // Both are text, not controls: nothing to type into and no address picker.
    expect(screen.queryByRole("combobox", { name: "Shipping address" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the location's address as shipping, and blank again for no location", async () => {
    renderWithAuth(<Harness />);
    await screen.findByRole("option", { name: "Block A" });

    await userEvent.selectOptions(screen.getByLabelText("Location"), "Block A");
    expect(box("Shipping address")).toHaveTextContent("Block A gate, Hazira");

    await userEvent.selectOptions(screen.getByLabelText("Location"), "No location");
    expect(box("Shipping address")).toBeEmptyDOMElement();
  });

  it("leaves shipping blank for a location that has no address", async () => {
    renderWithAuth(<Harness initialShipping="Block A gate, Hazira" />);
    await screen.findByRole("option", { name: "Block A" });

    await userEvent.selectOptions(screen.getByLabelText("Location"), "Store Yard (no address yet)");
    expect(box("Shipping address")).toBeEmptyDOMElement();
  });

  it("shows a location's address even when it is the same as the site's own", async () => {
    renderWithAuth(<Harness />);
    await screen.findByRole("option", { name: "Main Gate" });

    await userEvent.selectOptions(screen.getByLabelText("Location"), "Main Gate");
    expect(box("Shipping address")).toHaveTextContent("Plot 12, Akwada Lake Front");
  });
});
