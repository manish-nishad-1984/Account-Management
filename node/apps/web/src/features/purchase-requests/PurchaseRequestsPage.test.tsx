import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseRequestsPage } from "./PurchaseRequestsPage";
import { json, noContent, renderWithAuth, routeFetch } from "../../test/render";

const ALL_RIGHTS = [
  "purchase-request.view",
  "purchase-request.add",
  "purchase-request.edit",
  "purchase-request.delete",
  "purchase-request.approve",
];

const SITE = "22222222-2222-2222-2222-222222222222";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  prNo: "PR/26-27/001",
  siteId: SITE,
  siteName: "Akwada Lake Front",
  itemId: "33333333-3333-3333-3333-333333333333",
  itemLabel: "OPC 53 Grade Cement",
  itemDescription: null,
  unitId: 1,
  unitName: "Bag",
  quantity: "150.00",
  documentDate: "2026-09-01T00:00:00.000Z",
  siteAddress: null,
  isApproved: false,
  createdAt: "2026-09-01T10:00:00.000Z",
  capabilities: { canEdit: true, canDelete: true, canApprove: true },
  ...overrides,
});

const list = (rows: unknown[]) => ({ rows, nextCursor: null, total: rows.length });

/**
 * The site scope the shell supplies. This screen has no site control of its own
 * — the header owns that choice for the whole application.
 */
const SCOPE = {
  sites: [{ id: SITE, name: "Akwada Lake Front" }],
  canSelectAll: true,
};

/**
 * The approval PATCH shares a prefix with the list, so its pattern must be
 * matched FIRST — `routeFetch` returns the first route that matches.
 */
const routes = (rows: unknown[]) =>
  routeFetch([
    [/\/purchase-requests\/.+\/approval$/, json(row({ isApproved: true }))],
    [/\/purchase-requests$/, list(rows)],
    [/\/units$/, list([])],
    [/\/items$/, list([])],
  ]);

/** The URL of the last GET that hit the purchase-request list. */
const listCalls = () =>
  vi.mocked(globalThis.fetch).mock.calls.filter((call) =>
    String(call[0]).includes("/purchase-requests?"),
  );

const lastListUrl = () => new URL(String(listCalls().at(-1)![0]), "http://localhost");

describe("PurchaseRequestsPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the request number, item, site and quantity with its unit", async () => {
    routes([row()]);
    renderWithAuth(<PurchaseRequestsPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("PR/26-27/001")).toBeInTheDocument();
    expect(screen.getByText("OPC 53 Grade Cement")).toBeInTheDocument();
    expect(screen.getByText("Bag")).toBeInTheDocument();
    expect(screen.getByText("Akwada Lake Front")).toBeInTheDocument();
  });

  /**
   * "150.00 Bag" reads as a measurement rather than a count. Money keeps its two
   * decimals; a quantity does not.
   */
  it("renders a whole quantity without trailing zeros", async () => {
    routes([row({ quantity: "150.00" })]);
    renderWithAuth(<PurchaseRequestsPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("150")).toBeInTheDocument();
    expect(screen.queryByText("150.00")).not.toBeInTheDocument();
  });

  it("keeps a fractional quantity exactly as stored", async () => {
    routes([row({ quantity: "2.50" })]);
    renderWithAuth(<PurchaseRequestsPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("2.5")).toBeInTheDocument();
  });

  /**
   * The source's list INNER JOINs ItemMaster, so these rows are invisible there.
   * Here they appear, labelled by their free text and marked as off-catalogue.
   */
  it("shows a request that names an item not in the catalogue", async () => {
    routes([row({ itemId: null, itemLabel: "Scaffolding hire" })]);
    renderWithAuth(<PurchaseRequestsPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("Scaffolding hire")).toBeInTheDocument();
    expect(screen.getByText("Not in the item catalogue")).toBeInTheDocument();
  });

  it("hides New request from someone without the add right", async () => {
    routes([row()]);
    renderWithAuth(<PurchaseRequestsPage />, { permissions: ["purchase-request.view"] });

    await screen.findByText("PR/26-27/001");
    expect(screen.queryByRole("button", { name: /new request/i })).not.toBeInTheDocument();
  });

  it("shows New request to someone with it", async () => {
    routes([row()]);
    renderWithAuth(<PurchaseRequestsPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByRole("button", { name: /new request/i })).toBeInTheDocument();
  });

  describe("approval", () => {
    it("offers Approve only when the row says the caller may", async () => {
      routes([row({ capabilities: { canEdit: true, canDelete: true, canApprove: false } })]);
      renderWithAuth(<PurchaseRequestsPage />, { permissions: ["purchase-request.view"] });

      await screen.findByText("PR/26-27/001");
      expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    });

    /**
     * The request states the value it wants rather than asking for a flip. The
     * source's endpoint reads the row and writes the opposite, so two approvers
     * racing land wherever ordering puts them.
     */
    it("sends the intended value, not a toggle instruction", async () => {
      routes([row({ isApproved: false })]);
      renderWithAuth(<PurchaseRequestsPage />, { permissions: ALL_RIGHTS });

      await userEvent.click(await screen.findByRole("button", { name: /^approve$/i }));

      await waitFor(() => {
        const call = vi
          .mocked(globalThis.fetch)
          .mock.calls.find((c) => String(c[0]).includes("/approval"));
        expect(call).toBeDefined();
        expect((call![1] as RequestInit).method).toBe("PATCH");
        expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ isApproved: true });
      });
    });

    it("asks to withdraw approval on a row that is already approved", async () => {
      routes([row({ isApproved: true })]);
      renderWithAuth(<PurchaseRequestsPage />, { permissions: ALL_RIGHTS });

      await userEvent.click(await screen.findByRole("button", { name: /unapprove/i }));

      await waitFor(() => {
        const call = vi
          .mocked(globalThis.fetch)
          .mock.calls.find((c) => String(c[0]).includes("/approval"));
        expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ isApproved: false });
      });
    });
  });

  describe("filters", () => {
    it("sends isApproved=false when the queue is narrowed to awaiting approval", async () => {
      routes([row()]);
      renderWithAuth(<PurchaseRequestsPage />, { permissions: ALL_RIGHTS });

      await screen.findByText("PR/26-27/001");
      await userEvent.selectOptions(screen.getByLabelText("Status"), "pending");

      await waitFor(() => {
        expect(lastListUrl().searchParams.get("isApproved")).toBe("false");
      });
    });

    it("sends no isApproved at all when showing everything", async () => {
      routes([row()]);
      renderWithAuth(<PurchaseRequestsPage />, { permissions: ALL_RIGHTS });

      await screen.findByText("PR/26-27/001");
      expect(lastListUrl().searchParams.has("isApproved")).toBe(false);
    });
  });

  /**
   * The site is chosen once, in the shell header, exactly as `drpSiteName` works
   * in the legacy layout. These assert the screen OBEYS that choice rather than
   * carrying a site filter of its own.
   */
  describe("site scope", () => {
    it("has no site filter of its own", async () => {
      routes([row()]);
      renderWithAuth(<PurchaseRequestsPage />, { permissions: ALL_RIGHTS, scope: SCOPE });

      await screen.findByText("PR/26-27/001");
      expect(screen.queryByLabelText("Site")).not.toBeInTheDocument();
    });

    it("filters by the site the shell is scoped to", async () => {
      routes([row()]);
      renderWithAuth(<PurchaseRequestsPage />, {
        permissions: ALL_RIGHTS,
        scope: { ...SCOPE, siteId: SITE, siteName: "Akwada Lake Front" },
      });

      await screen.findByText("PR/26-27/001");
      expect(lastListUrl().searchParams.get("siteId")).toBe(SITE);
    });

    it("sends no siteId when the scope is every site", async () => {
      routes([row()]);
      renderWithAuth(<PurchaseRequestsPage />, { permissions: ALL_RIGHTS, scope: SCOPE });

      await screen.findByText("PR/26-27/001");
      expect(lastListUrl().searchParams.has("siteId")).toBe(false);
    });

    /**
     * An assigned user's default scope is their FIRST SITE, not everything — so a
     * request sent before the scope resolves returns another site's rows and is
     * then replaced. That reads as a bug in the data rather than a loading state.
     */
    it("asks for nothing until the scope has resolved", async () => {
      routes([row()]);
      renderWithAuth(<PurchaseRequestsPage />, {
        permissions: ALL_RIGHTS,
        scope: { ...SCOPE, isReady: false },
      });

      await screen.findByRole("button", { name: /new request/i });
      expect(listCalls()).toHaveLength(0);
      // And it must not claim there is nothing to show while it is still waiting.
      expect(screen.queryByText(/no purchase requests/i)).not.toBeInTheDocument();
    });

    it("names the scoped site in its empty state, so an empty grid explains itself", async () => {
      routes([]);
      renderWithAuth(<PurchaseRequestsPage />, {
        permissions: ALL_RIGHTS,
        scope: { ...SCOPE, siteId: SITE, siteName: "Akwada Lake Front" },
      });

      expect(
        await screen.findByText(/No purchase requests for Akwada Lake Front/i),
      ).toBeInTheDocument();
    });
  });

  it("deletes through a confirmation, naming the request", async () => {
    routeFetch([
      [/\/purchase-requests\/.+$/, noContent()],
      [/\/purchase-requests$/, list([row()])],
      [/\/units$/, list([])],
      [/\/items$/, list([])],
    ]);
    renderWithAuth(<PurchaseRequestsPage />, { permissions: ALL_RIGHTS });

    await screen.findByText("PR/26-27/001");
    await userEvent.click(screen.getByRole("button", { name: /delete PR\/26-27\/001/i }));

    expect(await screen.findByText(/is not reissued/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      const call = vi
        .mocked(globalThis.fetch)
        .mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "DELETE");
      expect(call).toBeDefined();
    });
  });
});
