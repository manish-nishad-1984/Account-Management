import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteGroupFormDialog } from "./SiteGroupFormDialog";

/**
 * THE GROUP FORM: a name, the sites in the group, and the group's addresses.
 *
 * A save REPLACES both lists rather than merging them, which is the thing worth
 * pinning: the dialog shows the whole membership, so a site the person unticked
 * has to leave the payload, not merely fail to be re-added.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const SITES = {
  rows: [
    { id: "site-1", name: "Surat Riverfront", isActive: true, contactPersonName: null, contactPersonPhoneNo: null, area: null, pincode: null, userCount: 0, groupCount: 0, capabilities: { canEdit: true, canDelete: true, canApprove: false } },
    { id: "site-2", name: "Valsad Depot", isActive: true, contactPersonName: null, contactPersonPhoneNo: null, area: null, pincode: null, userCount: 0, groupCount: 0, capabilities: { canEdit: true, canDelete: true, canApprove: false } },
  ],
  nextCursor: null,
  total: 2,
};

const DETAIL = {
  id: "group-1",
  name: "North Gujarat",
  siteIds: ["site-1"],
  addresses: [{ id: "addr-1", address: "Yard 1, Ring Road" }],
};

function routes() {
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/sites?")) return Promise.resolve(json(SITES));
    if (url.includes("/site-groups/group-1") && method === "GET") {
      return Promise.resolve(json(DETAIL));
    }
    if (method === "POST" || method === "PATCH") {
      return Promise.resolve(json(DETAIL));
    }
    return Promise.resolve(json({ rows: [], nextCursor: null, total: 0 }));
  });
}

const written = () => {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find((c) => ["POST", "PATCH"].includes(String(c[1]?.method ?? "").toUpperCase()));
  return call ? (JSON.parse(String(call[1]!.body)) as Record<string, unknown>) : null;
};

function renderDialog(groupId: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <SiteGroupFormDialog open groupId={groupId} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe("SiteGroupFormDialog", () => {
  beforeEach(routes);
  afterEach(() => vi.restoreAllMocks());

  describe("creating", () => {
    it("sends the name and the sites that were ticked", async () => {
      renderDialog(null);
      await screen.findByLabelText("Search sites");

      await userEvent.type(screen.getByLabelText(/group name/i), "South Gujarat");
      await userEvent.click(screen.getByRole("checkbox", { name: "Valsad Depot" }));
      await userEvent.click(screen.getByRole("button", { name: /create group/i }));

      await waitFor(() => expect(written()).not.toBeNull());
      expect(written()).toMatchObject({ name: "South Gujarat", siteIds: ["site-2"] });
    });

    it("sends the addresses that were typed", async () => {
      renderDialog(null);
      await screen.findByLabelText("Search sites");

      await userEvent.type(screen.getByLabelText(/group name/i), "South Gujarat");
      await userEvent.click(screen.getByRole("button", { name: /add address/i }));
      await userEvent.type(screen.getByLabelText("Group address 1"), "Yard 9");
      await userEvent.click(screen.getByRole("button", { name: /create group/i }));

      await waitFor(() => expect(written()).not.toBeNull());
      expect(written()!.addresses).toEqual(["Yard 9"]);
    });

    it("will not save without a name, and says so", async () => {
      renderDialog(null);
      await screen.findByLabelText("Search sites");

      await userEvent.click(screen.getByRole("button", { name: /create group/i }));

      expect(await screen.findByText(/group name is required/i)).toBeInTheDocument();
      expect(written()).toBeNull();
    });

    it("drops an address box left blank", async () => {
      renderDialog(null);
      await screen.findByLabelText("Search sites");

      await userEvent.type(screen.getByLabelText(/group name/i), "South Gujarat");
      await userEvent.click(screen.getByRole("button", { name: /add address/i }));
      await userEvent.click(screen.getByRole("button", { name: /create group/i }));

      await waitFor(() => expect(written()).not.toBeNull());
      expect(written()!.addresses).toEqual([]);
    });
  });

  describe("editing", () => {
    it("shows what the group already holds", async () => {
      renderDialog("group-1");

      await waitFor(() =>
        expect(screen.getByLabelText(/group name/i)).toHaveValue("North Gujarat"),
      );
      expect(screen.getByRole("checkbox", { name: "Surat Riverfront" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Valsad Depot" })).not.toBeChecked();
      expect(screen.getByLabelText("Group address 1")).toHaveValue("Yard 1, Ring Road");
    });

    /**
     * THE ONE THAT MATTERS. The payload is the whole list, so an unticked site
     * must be absent from it — a merge on the server would silently keep a
     * membership the person just removed.
     */
    it("sends the membership WITHOUT a site that was unticked", async () => {
      renderDialog("group-1");
      await waitFor(() =>
        expect(screen.getByRole("checkbox", { name: "Surat Riverfront" })).toBeChecked(),
      );

      await userEvent.click(screen.getByRole("checkbox", { name: "Surat Riverfront" }));
      await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => expect(written()).not.toBeNull());
      expect(written()!.siteIds).toEqual([]);
    });

    it("sends a removed address as an absence", async () => {
      renderDialog("group-1");
      await waitFor(() =>
        expect(screen.getByLabelText("Group address 1")).toHaveValue("Yard 1, Ring Road"),
      );

      await userEvent.click(screen.getByRole("button", { name: "Remove group address 1" }));
      await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => expect(written()).not.toBeNull());
      expect(written()!.addresses).toEqual([]);
    });

    it("closes once the save succeeds", async () => {
      const onClose = renderDialog("group-1");
      await waitFor(() =>
        expect(screen.getByLabelText(/group name/i)).toHaveValue("North Gujarat"),
      );

      await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
  });

  describe("choosing sites", () => {
    it("filters the list", async () => {
      renderDialog(null);
      await screen.findByLabelText("Search sites");

      await userEvent.type(screen.getByLabelText("Search sites"), "valsad");

      expect(screen.getByRole("checkbox", { name: "Valsad Depot" })).toBeInTheDocument();
      expect(
        screen.queryByRole("checkbox", { name: "Surat Riverfront" }),
      ).not.toBeInTheDocument();
    });

    /**
     * A member hidden by a search would be saved away by a form that sends what
     * it is showing. It stays on screen instead.
     */
    it("keeps a ticked site visible even when the search excludes it", async () => {
      renderDialog("group-1");
      await waitFor(() =>
        expect(screen.getByRole("checkbox", { name: "Surat Riverfront" })).toBeChecked(),
      );

      await userEvent.type(screen.getByLabelText("Search sites"), "valsad");

      expect(screen.getByRole("checkbox", { name: "Surat Riverfront" })).toBeInTheDocument();
    });
  });
});
