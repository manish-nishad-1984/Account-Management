import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryPage } from "./InventoryPage";
import { json, noContent, renderWithAuth, routeFetch } from "../../test/render";

const ALL_RIGHTS = [
  "inventory-inward.view",
  "inventory-inward.add",
  "inventory-inward.edit",
  "inventory-inward.delete",
  "inventory-inward.approve",
];

const SITE = "22222222-2222-2222-2222-222222222222";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  siteId: SITE,
  siteName: "Akwada Lake Front",
  itemId: "33333333-3333-3333-3333-333333333333",
  itemName: "HELMET YELLOW LABOUR",
  unitId: 1,
  unitName: "Nos",
  quantity: "1000.00",
  documentDate: "2026-01-04T00:00:00.000Z",
  details: null,
  isApproved: true,
  createdAt: "2026-01-04T10:00:00.000Z",
  capabilities: { canEdit: true, canDelete: true, canApprove: true },
  ...overrides,
});

/** The list response carries `unallocated` alongside the page. */
const list = (rows: unknown[], unallocated = 0) => ({
  rows,
  nextCursor: null,
  total: rows.length,
  unallocated,
});

const SCOPE = {
  sites: [{ id: SITE, name: "Akwada Lake Front" }],
  canSelectAll: true,
};

const SCOPED = { ...SCOPE, siteId: SITE, siteName: "Akwada Lake Front" };

const routes = (rows: unknown[], unallocated = 0) =>
  routeFetch([
    [/\/inventory-inward\/.+\/approval$/, json(row({ isApproved: false }))],
    [/\/inventory-inward$/, list(rows, unallocated)],
    [/\/units$/, { rows: [], nextCursor: null, total: 0 }],
    [/\/items$/, { rows: [], nextCursor: null, total: 0 }],
  ]);

const listCalls = () =>
  vi.mocked(globalThis.fetch).mock.calls.filter((call) =>
    String(call[0]).includes("/inventory-inward?"),
  );

const lastListUrl = () => new URL(String(listCalls().at(-1)![0]), "http://localhost");

describe("InventoryPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the item, date, quantity with its unit, and site", async () => {
    routes([row()]);
    renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("HELMET YELLOW LABOUR")).toBeInTheDocument();
    expect(screen.getByText("Nos")).toBeInTheDocument();
    expect(screen.getByText("Akwada Lake Front")).toBeInTheDocument();
  });

  /** The legacy list renders "1000.0" and "1.0". Neither is a measurement. */
  it("trims a whole quantity rather than printing 1000.00", async () => {
    routes([row({ quantity: "1000.00" })]);
    renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("1,000")).toBeInTheDocument();
    expect(screen.queryByText("1000.00")).not.toBeInTheDocument();
  });

  it("shows the free text under the item, whatever it happens to say", async () => {
    routes([row({ details: "TO RAJAOUL" })]);
    renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("TO RAJAOUL")).toBeInTheDocument();
  });

  /**
   * `InventoryInward.SiteId` is never written by the .NET application, so every
   * imported row has none. Rendering that as blank would read as missing data.
   */
  it("says a row has no site rather than leaving the cell empty", async () => {
    routes([row({ siteId: null, siteName: null })]);
    renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("No site recorded")).toBeInTheDocument();
  });

  describe("the unallocated notice", () => {
    /**
     * Without this, a site-scoped list showing rows from no site looks like the
     * site filter is broken.
     */
    it("explains why rows from no site appear under a chosen site", async () => {
      routes([row()], 3);
      renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS, scope: SCOPED });

      expect(
        await screen.findByText(/3 arrivals recorded before this system/i),
      ).toBeInTheDocument();
    });

    it("says arrival, singular, when there is one", async () => {
      routes([row()], 1);
      renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS, scope: SCOPED });

      expect(await screen.findByText(/1 arrival recorded/i)).toBeInTheDocument();
    });

    it("disappears once the history has been backfilled", async () => {
      routes([row()], 0);
      renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS, scope: SCOPED });

      await screen.findByText("HELMET YELLOW LABOUR");
      expect(screen.queryByText(/recorded before this system/i)).not.toBeInTheDocument();
    });

    it("is not shown when no site is chosen, because nothing is being narrowed", async () => {
      routes([row()], 3);
      renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS, scope: SCOPE });

      await screen.findByText("HELMET YELLOW LABOUR");
      expect(screen.queryByText(/recorded before this system/i)).not.toBeInTheDocument();
    });
  });

  describe("site scope", () => {
    it("has no site filter of its own", async () => {
      routes([row()]);
      renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS, scope: SCOPE });

      await screen.findByText("HELMET YELLOW LABOUR");
      expect(screen.queryByLabelText("Site")).not.toBeInTheDocument();
    });

    it("filters by the site the shell is scoped to", async () => {
      routes([row()]);
      renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS, scope: SCOPED });

      await screen.findByText("HELMET YELLOW LABOUR");
      expect(lastListUrl().searchParams.get("siteId")).toBe(SITE);
    });

    it("asks for nothing until the scope has resolved", async () => {
      routes([row()]);
      renderWithAuth(<InventoryPage />, {
        permissions: ALL_RIGHTS,
        scope: { ...SCOPE, isReady: false },
      });

      await screen.findByRole("button", { name: /new arrival/i });
      expect(listCalls()).toHaveLength(0);
      expect(screen.queryByText(/no inventory arrivals/i)).not.toBeInTheDocument();
    });
  });

  describe("approval", () => {
    it("sends the intended value, not a toggle instruction", async () => {
      routes([row({ isApproved: true })]);
      renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS });

      await userEvent.click(await screen.findByRole("button", { name: /unapprove/i }));

      await waitFor(() => {
        const call = vi
          .mocked(globalThis.fetch)
          .mock.calls.find((c) => String(c[0]).includes("/approval"));
        expect(call).toBeDefined();
        expect((call![1] as RequestInit).method).toBe("PATCH");
        expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ isApproved: false });
      });
    });

    it("offers Approve only when the row says the caller may", async () => {
      routes([row({ capabilities: { canEdit: true, canDelete: true, canApprove: false } })]);
      renderWithAuth(<InventoryPage />, { permissions: ["inventory-inward.view"] });

      await screen.findByText("HELMET YELLOW LABOUR");
      expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    });

    it("narrows to the pending queue", async () => {
      routes([row()]);
      renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS });

      await screen.findByText("HELMET YELLOW LABOUR");
      await userEvent.selectOptions(screen.getByLabelText("Status"), "pending");

      await waitFor(() => {
        expect(lastListUrl().searchParams.get("isApproved")).toBe("false");
      });
    });
  });

  it("hides New arrival from someone without the add right", async () => {
    routes([row()]);
    renderWithAuth(<InventoryPage />, { permissions: ["inventory-inward.view"] });

    await screen.findByText("HELMET YELLOW LABOUR");
    expect(screen.queryByRole("button", { name: /new arrival/i })).not.toBeInTheDocument();
  });

  /** The source removes the row from the table. The dialog says this one does not. */
  it("deletes through a confirmation that says the row is kept", async () => {
    routeFetch([
      [/\/inventory-inward\/.+$/, noContent()],
      [/\/inventory-inward$/, list([row()])],
      [/\/units$/, { rows: [], nextCursor: null, total: 0 }],
      [/\/items$/, { rows: [], nextCursor: null, total: 0 }],
    ]);
    renderWithAuth(<InventoryPage />, { permissions: ALL_RIGHTS });

    await screen.findByText("HELMET YELLOW LABOUR");
    await userEvent.click(screen.getByRole("button", { name: /delete HELMET YELLOW LABOUR/i }));

    expect(await screen.findByText(/removed the row outright/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      const call = vi
        .mocked(globalThis.fetch)
        .mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "DELETE");
      expect(call).toBeDefined();
    });
  });
});
