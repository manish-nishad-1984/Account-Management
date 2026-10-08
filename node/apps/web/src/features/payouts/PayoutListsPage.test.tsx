import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayoutListsPage } from "./PayoutListsPage";
import { json, noContent, renderWithAuth } from "../../test/render";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ALL = { canEdit: true, canDelete: true, canApprove: false };
const VIEW_ONLY = { canEdit: false, canDelete: false, canApprove: false };

const row = (overrides: Record<string, unknown> = {}) => ({
  id: ID_A,
  listDate: "2026-10-05",
  title: "Weekly payout",
  budget: "4000000.00",
  total: "640000.00",
  partyCount: 2,
  status: "draft",
  confirmedAt: null,
  confirmedByName: null,
  createdByName: "Office",
  createdAt: "2026-10-04T10:00:00.000Z",
  updatedAt: "2026-10-05T09:30:00.000Z",
  updatedByName: "Manish",
  capabilities: ALL,
  ...overrides,
});

const DETAIL = {
  id: ID_A,
  listDate: "2026-10-05",
  title: "Weekly payout",
  budget: "4000000.00",
  total: "640000.00",
  partyCount: 2,
  status: "draft",
  confirmedAt: null,
  confirmedByName: null,
  createdByName: "Office",
  createdAt: "2026-10-04T10:00:00.000Z",
  updatedAt: null,
  updatedByName: null,
  note: null,
  lines: [
    { id: "l1", partyId: "p1", partyName: "Ambica Steel Traders", amount: "125000.00", outstandingAtSave: "125000.00", outstandingNow: "125000.00", extraPaid: null, invoices: [] },
    { id: "l2", partyId: "p2", partyName: "Shree Cement", amount: "515000.00", outstandingAtSave: "515000.00", outstandingNow: "515000.00", extraPaid: null, invoices: [] },
  ],
};

let rows: unknown[];

const serve = () =>
  vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
    const url = new URL(String(input), "http://localhost");
    if (/\/grid-preferences/.test(url.pathname)) return Promise.resolve(json({ columns: null }));
    if ((init as RequestInit | undefined)?.method === "DELETE") return Promise.resolve(noContent());
    if (/\/payout-lists\/outstanding$/.test(url.pathname)) return Promise.resolve(json({ rows: [], total: "0.00" }));
    if (/\/payout-lists\/[^/]+$/.test(url.pathname)) return Promise.resolve(json(DETAIL));
    if (/\/payout-lists$/.test(url.pathname)) return Promise.resolve(json({ rows, nextCursor: null, total: rows.length }));
    return Promise.resolve(json({ message: "No test route" }, 404));
  });

describe("PayoutListsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    rows = [
      row(),
      row({
        id: ID_B,
        listDate: "2026-09-28",
        title: null,
        total: "10.50",
        partyCount: 1,
        status: "draft",
        confirmedAt: null,
        updatedAt: null,
        updatedByName: null,
        capabilities: VIEW_ONLY,
      }),
    ];
    serve();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows each list's date, title, parties, total and who last touched it", async () => {
    renderWithAuth(<PayoutListsPage />, { permissions: ["payout.view"] });

    const first = (await screen.findByText("05 Oct 2026")).closest("tr")!;
    expect(within(first).getByText("Weekly payout")).toBeInTheDocument();
    expect(within(first).getByText("2")).toBeInTheDocument();
    expect(within(first).getByText("6,40,000.00")).toBeInTheDocument();
    expect(within(first).getByText("Manish")).toBeInTheDocument();

    const second = screen.getByText("28 Sep 2026").closest("tr")!;
    expect(within(second).getByText("10.50")).toBeInTheDocument();
    // Never edited: it falls back to who created it.
    expect(within(second).getByText("Office")).toBeInTheDocument();
  });

  it("asks for the newest list first, by the day the list is for", async () => {
    renderWithAuth(<PayoutListsPage />, { permissions: ["payout.view"] });
    await screen.findByText("05 Oct 2026");

    const request = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([url]) => new URL(String(url), "http://localhost"))
      .find((url) => url.pathname.endsWith("/payout-lists"))!;
    expect(request.searchParams.get("sortBy")).toBe("listDate");
    expect(request.searchParams.get("sortDir")).toBe("desc");
  });

  it("offers Edit and Delete only where the row's capabilities allow", async () => {
    renderWithAuth(<PayoutListsPage />, { permissions: ["payout.view"] });

    const editable = (await screen.findByText("05 Oct 2026")).closest("tr")!;
    expect(within(editable).getByRole("button", { name: /^Edit/ })).toBeInTheDocument();
    expect(within(editable).getByRole("button", { name: /^Delete/ })).toBeInTheDocument();
    expect(within(editable).queryByRole("button", { name: /^Open/ })).not.toBeInTheDocument();

    const locked = screen.getByText("28 Sep 2026").closest("tr")!;
    expect(within(locked).queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
    expect(within(locked).queryByRole("button", { name: /^Delete/ })).not.toBeInTheDocument();
    // A reader can still open it.
    expect(within(locked).getByRole("button", { name: /^Open/ })).toBeInTheDocument();
  });

  it("offers New payout list only to someone who may add one", async () => {
    const { unmount } = renderWithAuth(<PayoutListsPage />, { permissions: ["payout.view"] });
    await screen.findByText("05 Oct 2026");
    expect(screen.queryByRole("button", { name: /new payout list/i })).not.toBeInTheDocument();
    unmount();

    renderWithAuth(<PayoutListsPage />, { permissions: ["payout.view", "payout.add"] });
    expect(await screen.findByRole("button", { name: /new payout list/i })).toBeInTheDocument();
  });

  it("says so when there are no lists", async () => {
    rows = [];
    renderWithAuth(<PayoutListsPage />, { permissions: ["payout.view"] });
    expect(await screen.findByText("No payout lists match this search")).toBeInTheDocument();
  });

  it("has an image button and no WhatsApp button", async () => {
    renderWithAuth(<PayoutListsPage />, { permissions: ["payout.view"] });
    const first = (await screen.findByText("05 Oct 2026")).closest("tr")!;
    expect(within(first).getByRole("button", { name: /as image/ })).toBeInTheDocument();
    expect(within(first).queryByRole("button", { name: /whatsapp/i })).not.toBeInTheDocument();
  });

  it("copies the list's text and says so", async () => {
    // userEvent installs its own clipboard on setup, so read back what was written.
    const user = userEvent.setup();
    renderWithAuth(<PayoutListsPage />, { permissions: ["payout.view"] });

    const first = (await screen.findByText("05 Oct 2026")).closest("tr")!;
    await user.click(within(first).getByRole("button", { name: /^Copy/ }));

    expect(await screen.findByText(/List copied/)).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toContain("Total: Rs 6,40,000.00");
  });

  it("names the list before deleting it, and deletes only after the confirm", async () => {
    const user = userEvent.setup();
    renderWithAuth(<PayoutListsPage />, { permissions: ["payout.view", "payout.delete"] });

    const first = (await screen.findByText("05 Oct 2026")).closest("tr")!;
    await user.click(within(first).getByRole("button", { name: /^Delete/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Weekly payout - 05 Oct 2026/)).toBeInTheDocument();
    const deletes = () =>
      vi.mocked(globalThis.fetch).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
    expect(deletes()).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(String(deletes()[0]![0])).toMatch(new RegExp(`/payout-lists/${ID_A}$`));
  });
});
