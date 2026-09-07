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

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  prNo: "PR/26-27/001",
  siteId: "22222222-2222-2222-2222-222222222222",
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

/** Must satisfy `siteRowSchema` in full, or the response fails validation and
 *  the dropdown renders empty with nothing to say why. */
const SITES = list([
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Akwada Lake Front",
    isActive: true,
    contactPersonName: null,
    contactPersonPhoneNo: null,
    area: null,
    pincode: null,
    userCount: 0,
    groupCount: 0,
    capabilities: { canEdit: true, canDelete: true, canApprove: false },
  },
]);

/**
 * The approval PATCH shares a prefix with the list, so its pattern must be
 * matched FIRST — `routeFetch` returns the first route that matches.
 */
const routes = (rows: unknown[]) =>
  routeFetch(
    [
      [/\/purchase-requests\/.+\/approval$/, json(row({ isApproved: true }))],
      [/\/purchase-requests$/, list(rows)],
      [/\/sites$/, SITES],
      [/\/units$/, list([])],
      [/\/items$/, list([])],
    ],
  );

/** The URL of the last GET that hit the purchase-request list. */
const lastListUrl = () => {
  const calls = vi
    .mocked(globalThis.fetch)
    .mock.calls.filter((call) => String(call[0]).includes("/purchase-requests?"));
  return new URL(String(calls[calls.length - 1]![0]), "http://localhost");
};

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

    // The site name is also an option in the filter dropdown, so scope to the grid.
    const inGrid = screen
      .getAllByText("Akwada Lake Front")
      .filter((element) => element.closest("table") !== null);
    expect(inGrid).toHaveLength(1);
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

    it("filters by site", async () => {
      routes([row()]);
      renderWithAuth(<PurchaseRequestsPage />, { permissions: ALL_RIGHTS });

      await screen.findByText("PR/26-27/001");
      await userEvent.selectOptions(
        screen.getByLabelText("Site"),
        "22222222-2222-2222-2222-222222222222",
      );

      await waitFor(() => {
        expect(lastListUrl().searchParams.get("siteId")).toBe(
          "22222222-2222-2222-2222-222222222222",
        );
      });
    });
  });

  it("deletes through a confirmation, naming the request", async () => {
    routeFetch([
      [/\/purchase-requests\/.+$/, noContent()],
      [/\/purchase-requests$/, list([row()])],
      [/\/sites$/, SITES],
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
