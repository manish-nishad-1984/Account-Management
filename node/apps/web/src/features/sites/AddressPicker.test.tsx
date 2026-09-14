import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddressPicker } from "./AddressPicker";

/**
 * CHOOSING WHERE A DELIVERY GOES, on an invoice.
 *
 * The picker copies text into the document and stores nothing about which
 * address was chosen — an order keeps the words it was raised with, so
 * correcting a site's address later cannot rewrite where a delivery already
 * went. That is what the source does and it is right for a document.
 */

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const CHOICES = {
  rows: [
    { key: "site", source: "site", address: "Plot 14, Ring Road, Surat 395002" },
    { key: "extra-7", source: "extra", address: "Warehouse B, Sachin GIDC" },
  ],
};

function renderPicker(siteId: string | null, onChoose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AddressPicker siteId={siteId} onChoose={onChoose} />
    </QueryClientProvider>,
  );
  return onChoose;
}

describe("AddressPicker", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(json(CHOICES)));
  });

  afterEach(() => vi.restoreAllMocks());

  it("lists the addresses of the chosen site", async () => {
    renderPicker("11111111-1111-1111-1111-111111111111");

    expect(await screen.findByRole("option", { name: /Warehouse B/ })).toBeInTheDocument();
  });

  it("marks which one is the site's own address", async () => {
    renderPicker("11111111-1111-1111-1111-111111111111");

    expect(await screen.findByRole("option", { name: /^Site address — Plot 14/ })).toBeInTheDocument();
  });

  it("hands the chosen address back as text", async () => {
    const onChoose = renderPicker("11111111-1111-1111-1111-111111111111");
    await screen.findByRole("option", { name: /Warehouse B/ });

    await userEvent.selectOptions(screen.getByLabelText("Use a site address"), "extra-7");

    expect(onChoose).toHaveBeenCalledWith("Warehouse B, Sachin GIDC");
  });

  /**
   * A dropdown whose only option is "Choose an address" looks broken, and asks
   * the reader to try something that cannot work.
   */
  it("renders nothing until a site is chosen", () => {
    renderPicker(null);

    expect(screen.queryByLabelText("Use a site address")).not.toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("renders nothing for a site with no address on it", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(json({ rows: [] })));
    renderPicker("11111111-1111-1111-1111-111111111111");

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByLabelText("Use a site address")).not.toBeInTheDocument();
  });
});
