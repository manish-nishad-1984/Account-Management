import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteDeleteDialog } from "./SiteDeleteDialog";
import { json, renderWithAuth } from "../../test/render";

const SITE = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Akwada" };
const CONTENTS = {
  siteName: "Akwada", purchaseRequests: 0, purchaseOrders: 2, inwardChallans: 0, inventoryArrivals: 0, purchaseInvoices: 1301,
  salesInvoices: 0, payments: 13, incomes: 1, locations: 2, users: 3, billedTotal: "51029125.00", paidTotal: "4776191.00",
};
const calls = () => vi.mocked(globalThis.fetch).mock.calls.map(([input, init]) => ({ url: String(input), init: init as RequestInit | undefined }));

/** A site deleted with everything in it, after the person's own password (client, 26 Oct 2026). */
describe("SiteDeleteDialog", () => {
  let accept = true;
  beforeEach(() => {
    accept = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/delete-everything")) {
          return Promise.resolve(
            accept ? json(CONTENTS) : json({ message: "That is not your password. Nothing was deleted.", statusCode: 400 }, 400),
          );
        }
        if (url.endsWith("/contents")) return Promise.resolve(json(CONTENTS));
        return Promise.resolve(json({}));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows what goes with the site and deletes it only with a password", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithAuth(<SiteDeleteDialog site={SITE} onClose={onClose} />, { permissions: ["site.delete"] });

    const table = await screen.findByRole("table", { name: "What is deleted" });
    expect(table).toHaveTextContent("Purchase invoices1,3015,10,29,125.00");
    expect(table).toHaveTextContent("Payments13");
    expect(table).not.toHaveTextContent("Sales invoices");

    await user.click(screen.getByRole("button", { name: /delete site and everything/i }));
    expect(await screen.findByText("Enter your password.")).toBeInTheDocument();
    expect(calls().some(({ url }) => url.endsWith("/delete-everything"))).toBe(false);

    await user.type(screen.getByLabelText("Your password"), "secret");
    await user.click(screen.getByRole("button", { name: /delete site and everything/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const sent = calls().find(({ url }) => url.endsWith(`/sites/${SITE.id}/delete-everything`))!;
    expect(JSON.parse(String(sent.init!.body))).toEqual({ password: "secret" });
  });

  it("says so when the password is wrong, and stays open", async () => {
    accept = false;
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithAuth(<SiteDeleteDialog site={SITE} onClose={onClose} />, { permissions: ["site.delete"] });
    await user.type(await screen.findByLabelText("Your password"), "wrong");
    await user.click(screen.getByRole("button", { name: /delete site and everything/i }));
    expect(await screen.findByText(/not your password/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
