import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsPage } from "./PaymentsPage";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * The Payment Actions panel of `/Report/ReportDetails`, as its own screen.
 */

const EMPTY = { rows: [], nextCursor: null, total: 0 };

const payment = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  direction: "out",
  kind: "payment",
  partyId: "p1",
  partyName: "AL BURHAN PIPES",
  companyId: "c1",
  companyName: "DH PATEL",
  siteId: "s1",
  siteName: "Akwada Lake Front",
  siteGroupId: null,
  siteGroupName: null,
  paymentDate: "2026-08-11T00:00:00.000Z",
  amount: "25000.00",
  description: "Part settlement",
  method: "Cheque",
  referenceNo: "CHQ-4471",
  createdAt: "2026-08-11T09:00:00.000Z",
  capabilities: { canEdit: true, canDelete: true, canApprove: false },
  ...overrides,
});

const list = (rows: unknown[]) => ({ rows, nextCursor: null, total: rows.length });

const withPayments = (rows: unknown[]) =>
  routeFetch([
    [/\/payments$/, list(rows)],
    [/\/suppliers/, EMPTY],
    [/\/companies/, EMPTY],
    [/\/sites/, { scope: "all", sites: [{ id: "s1", name: "Akwada Lake Front" }] }],
  ]);

/** The URL the list request actually went to, so the direction can be asserted. */
const listUrls = () =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.map((call) => String(call[0]))
    .filter((url) => url.includes("/payments"));

describe("the payments screen", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists a payment with its party, method and amount", async () => {
    withPayments([payment()]);
    renderWithAuth(<PaymentsPage />, { permissions: ["reports-payments.view"] });

    expect(await screen.findByText("AL BURHAN PIPES")).toBeInTheDocument();
    expect(screen.getByText("Cheque")).toBeInTheDocument();
    expect(screen.getByText("CHQ-4471")).toBeInTheDocument();
    expect(screen.getByText("25,000.00")).toBeInTheDocument();
  });

  /**
   * An opening balance has no site by design — the legacy validation skips the
   * site check on that branch. The cell says which of the two it is rather than
   * leaving a blank that reads as missing data.
   */
  it("marks an opening balance and says why it has no site", async () => {
    withPayments([payment({ kind: "opening_balance", siteId: null, siteName: null })]);
    renderWithAuth(<PaymentsPage />, { permissions: ["reports-payments.view"] });

    expect(await screen.findByText("Opening balance")).toBeInTheDocument();
    expect(screen.getByText("Not site-specific")).toBeInTheDocument();
  });

  it("asks the API for the direction the toggle is on", async () => {
    const user = userEvent.setup();
    withPayments([payment()]);
    renderWithAuth(<PaymentsPage />, { permissions: ["reports-payments.view"] });

    await screen.findByText("AL BURHAN PIPES");
    expect(listUrls().some((url) => url.includes("direction=out"))).toBe(true);

    await user.click(screen.getByRole("button", { name: "Received" }));
    await waitFor(() => expect(listUrls().some((url) => url.includes("direction=in"))).toBe(true));
  });

  it("hides Record payments from someone who may only view", async () => {
    withPayments([]);
    renderWithAuth(<PaymentsPage />, { permissions: ["reports-payments.view"] });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Record payments/ })).not.toBeInTheDocument();
  });

  it("offers Record payments to someone who may add", async () => {
    withPayments([]);
    renderWithAuth(<PaymentsPage />, {
      permissions: ["reports-payments.view", "reports-payments.add"],
    });

    expect(await screen.findByRole("button", { name: /Record payments/ })).toBeInTheDocument();
  });

  /**
   * The legacy delete is a hard delete: `DeletePayoutDetails` calls `Remove()`
   * and the row is gone, taking a supplier balance with it. The confirmation
   * says what happens instead, because a payment is a financial record.
   */
  it("says the balance changes and the record is kept, before deleting", async () => {
    const user = userEvent.setup();
    withPayments([payment()]);
    renderWithAuth(<PaymentsPage />, {
      permissions: ["reports-payments.view", "reports-payments.delete"],
    });

    await user.click(await screen.findByRole("button", { name: /^Delete payment of/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/changes the party's balance/)).toBeInTheDocument();
    expect(within(dialog).getByText(/marked deleted rather than removed/)).toBeInTheDocument();
  });

  it("renders an empty state naming the direction", async () => {
    withPayments([]);
    renderWithAuth(<PaymentsPage />, { permissions: ["reports-payments.view"] });

    expect(await screen.findByText("No payments to suppliers yet")).toBeInTheDocument();
  });
});
