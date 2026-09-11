import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InwardChallansPage } from "./InwardChallansPage";
import { json, noContent, renderWithAuth, routeFetch } from "../../test/render";

const ALL_RIGHTS = [
  "inward-challan.view",
  "inward-challan.add",
  "inward-challan.edit",
  "inward-challan.delete",
  "inward-challan.approve",
];

const SITE = "22222222-2222-2222-2222-222222222222";
const SUPPLIER = "44444444-4444-4444-4444-444444444444";
const ITEM = "33333333-3333-3333-3333-333333333333";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  siteId: SITE,
  siteName: "SURAT-AURO UNIVERSITY",
  itemId: ITEM,
  itemName: "FLY ASH BRICKS",
  supplierId: SUPPLIER,
  supplierName: "RAJU M PATEL-CARTING",
  unitId: 1,
  unitName: "Nos",
  quantity: "4000.00",
  invoiceNo: "922",
  documentDate: "2026-08-07T00:00:00.000Z",
  vehicleNumber: "GJ 06 KK 1234",
  receiverName: "SURESHBHAI-CC-2000X2 7TH",
  documentCount: 0,
  isApproved: true,
  createdAt: "2026-08-07T10:00:00.000Z",
  capabilities: { canEdit: true, canDelete: true, canApprove: true },
  ...overrides,
});

const list = (rows: unknown[], totalQuantity = "4000.00") => ({
  rows,
  nextCursor: null,
  total: rows.length,
  totalQuantity,
});

const SUPPLIERS = {
  rows: [
    {
      id: SUPPLIER,
      name: "RAJU M PATEL-CARTING",
      mobile: null,
      email: null,
      gstNo: null,
      area: "Navrangpura",
      pincode: null,
      isApproved: true,
      openingBalance: null,
      capabilities: { canEdit: true, canDelete: true, canApprove: false },
    },
  ],
  nextCursor: null,
  total: 1,
};

const ITEMS = { rows: [], nextCursor: null, total: 0 };

const SCOPE = { sites: [{ id: SITE, name: "SURAT-AURO UNIVERSITY" }], canSelectAll: true };
const SCOPED = { ...SCOPE, siteId: SITE, siteName: "SURAT-AURO UNIVERSITY" };

const routes = (rows: unknown[], totalQuantity = "4000.00") =>
  routeFetch([
    [/\/inward-challans\/.+\/approval$/, json(row({ isApproved: false }))],
    [/\/inward-challans$/, list(rows, totalQuantity)],
    [/\/suppliers$/, SUPPLIERS],
    [/\/units$/, ITEMS],
    [/\/items$/, ITEMS],
  ]);

const listCalls = () =>
  vi.mocked(globalThis.fetch).mock.calls.filter((c) =>
    String(c[0]).includes("/inward-challans?"),
  );

const lastListUrl = () => new URL(String(listCalls().at(-1)![0]), "http://localhost");

describe("InwardChallansPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the item, date, quantity, supplier and invoice number", async () => {
    routes([row()]);
    renderWithAuth(<InwardChallansPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("FLY ASH BRICKS")).toBeInTheDocument();
    expect(screen.getByText("922")).toBeInTheDocument();

    // The supplier name is also an option in the filter dropdown, and the
    // quantity is repeated in the footer total, so scope to the body.
    const body = screen.getByRole("table").querySelector("tbody") as HTMLElement;
    expect(within(body).getByText("4,000")).toBeInTheDocument();
    expect(within(body).getByText("RAJU M PATEL-CARTING")).toBeInTheDocument();
  });

  /** "SURESHBHAI-CC-2000X2 7TH" is one field. Never parsed into parts. */
  it("shows the receiver exactly as it is written", async () => {
    routes([row()]);
    renderWithAuth(<InwardChallansPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("SURESHBHAI-CC-2000X2 7TH")).toBeInTheDocument();
  });

  it("keeps a non-numeric invoice number intact", async () => {
    routes([row({ invoiceNo: "253-1" })]);
    renderWithAuth(<InwardChallansPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("253-1")).toBeInTheDocument();
  });

  /**
   * The source's registered create path never writes `SupplierId`, so this
   * population exists in production and a blank cell would read as broken.
   */
  it("says the supplier was not recorded rather than leaving the cell blank", async () => {
    routes([row({ supplierId: null, supplierName: null })]);
    renderWithAuth(<InwardChallansPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByText("Not recorded")).toBeInTheDocument();
  });

  it("marks a challan that has attachments", async () => {
    routes([row({ documentCount: 2 })]);
    renderWithAuth(<InwardChallansPage />, { permissions: ALL_RIGHTS });

    expect(await screen.findByTitle("2 attachments")).toBeInTheDocument();
  });

  /**
   * The legacy grid's purple footer row, and the only aggregate in the system.
   * The source computes it correctly and then loses it whenever the list is
   * empty, because it rides on `list[0]`.
   */
  describe("the quantity total", () => {
    it("shows the total for the filtered set in a footer row", async () => {
      routes([row()], "70013.25");
      renderWithAuth(<InwardChallansPage />, { permissions: ALL_RIGHTS });

      await screen.findByText("FLY ASH BRICKS");
      const footer = screen.getByRole("table").querySelector("tfoot")!;
      expect(within(footer as HTMLElement).getByText("70,013.25")).toBeInTheDocument();
      expect(within(footer as HTMLElement).getByText("Total")).toBeInTheDocument();
    });

    it("still shows a zero total when nothing matches", async () => {
      routes([], "0");
      renderWithAuth(<InwardChallansPage />, { permissions: ALL_RIGHTS });

      await screen.findByText(/no inward challans match/i);
      const footer = screen.getByRole("table").querySelector("tfoot")!;
      expect(within(footer as HTMLElement).getByText("0")).toBeInTheDocument();
    });
  });

  /**
   * The only screen in the system with explicit filtering — a Search button and
   * a Reset, matching the legacy one.
   */
  describe("the filters", () => {
    it("does not query until Search is pressed", async () => {
      routes([row()]);
      renderWithAuth(<InwardChallansPage />, { permissions: ALL_RIGHTS, scope: SCOPE });

      await screen.findByText("FLY ASH BRICKS");
      const before = listCalls().length;

      await userEvent.selectOptions(screen.getByLabelText("Supplier"), SUPPLIER);

      expect(listCalls()).toHaveLength(before);
      expect(lastListUrl().searchParams.has("supplierId")).toBe(false);
    });

    it("sends the supplier once Search is pressed", async () => {
      routes([row()]);
      renderWithAuth(<InwardChallansPage />, { permissions: ALL_RIGHTS, scope: SCOPE });

      await screen.findByText("FLY ASH BRICKS");
      await userEvent.selectOptions(screen.getByLabelText("Supplier"), SUPPLIER);
      await userEvent.click(screen.getByRole("button", { name: /^search$/i }));

      await waitFor(() => {
        expect(lastListUrl().searchParams.get("supplierId")).toBe(SUPPLIER);
      });
    });

    it("sends a date range, which the legacy screen never could", async () => {
      routes([row()]);
      renderWithAuth(<InwardChallansPage />, { permissions: ALL_RIGHTS, scope: SCOPE });

      await screen.findByText("FLY ASH BRICKS");
      await userEvent.type(screen.getByLabelText("From"), "2026-08-01");
      await userEvent.type(screen.getByLabelText("To"), "2026-08-31");
      await userEvent.click(screen.getByRole("button", { name: /^search$/i }));

      await waitFor(() => {
        expect(lastListUrl().searchParams.get("fromDate")).toBe("2026-08-01");
        expect(lastListUrl().searchParams.get("toDate")).toBe("2026-08-31");
      });
    });

    it("clears everything on Reset", async () => {
      routes([row()]);
      renderWithAuth(<InwardChallansPage />, { permissions: ALL_RIGHTS, scope: SCOPE });

      await screen.findByText("FLY ASH BRICKS");
      await userEvent.selectOptions(screen.getByLabelText("Supplier"), SUPPLIER);
      await userEvent.click(screen.getByRole("button", { name: /^search$/i }));
      await waitFor(() => expect(lastListUrl().searchParams.has("supplierId")).toBe(true));

      await userEvent.click(screen.getByRole("button", { name: /reset/i }));

      await waitFor(() => expect(lastListUrl().searchParams.has("supplierId")).toBe(false));
      expect(screen.getByLabelText("Supplier")).toHaveValue("");
    });
  });

  describe("site scope", () => {
    it("filters by the site the shell is scoped to", async () => {
      routes([row()]);
      renderWithAuth(<InwardChallansPage />, { permissions: ALL_RIGHTS, scope: SCOPED });

      await screen.findByText("FLY ASH BRICKS");
      expect(lastListUrl().searchParams.get("siteId")).toBe(SITE);
    });

    it("asks for nothing until the scope has resolved", async () => {
      routes([row()]);
      renderWithAuth(<InwardChallansPage />, {
        permissions: ALL_RIGHTS,
        scope: { ...SCOPE, isReady: false },
      });

      await screen.findByRole("button", { name: /new challan/i });
      expect(listCalls()).toHaveLength(0);
    });
  });

  it("sends the intended approval value, not a toggle", async () => {
    routes([row({ isApproved: true })]);
    renderWithAuth(<InwardChallansPage />, { permissions: ALL_RIGHTS });

    await userEvent.click(await screen.findByRole("button", { name: /withdraw approval/i }));

    await waitFor(() => {
      const call = vi
        .mocked(globalThis.fetch)
        .mock.calls.find((c) => String(c[0]).includes("/approval"));
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ isApproved: false });
    });
  });

  it("hides New challan from someone without the add right", async () => {
    routes([row()]);
    renderWithAuth(<InwardChallansPage />, { permissions: ["inward-challan.view"] });

    await screen.findByText("FLY ASH BRICKS");
    expect(screen.queryByRole("button", { name: /new challan/i })).not.toBeInTheDocument();
  });

  it("deletes through a confirmation", async () => {
    routeFetch([
      [/\/inward-challans\/.+$/, noContent()],
      [/\/inward-challans$/, list([row()])],
      [/\/suppliers$/, SUPPLIERS],
      [/\/units$/, ITEMS],
      [/\/items$/, ITEMS],
    ]);
    renderWithAuth(<InwardChallansPage />, { permissions: ALL_RIGHTS });

    await screen.findByText("FLY ASH BRICKS");
    await userEvent.click(screen.getByRole("button", { name: /delete FLY ASH BRICKS/i }));

    expect(await screen.findByText(/leaves the total/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      const call = vi
        .mocked(globalThis.fetch)
        .mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "DELETE");
      expect(call).toBeDefined();
    });
  });
});
