import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayoutListFormDialog } from "./PayoutListFormDialog";
import { json, renderWithAuth } from "../../test/render";

/**
 * THE BILLS UNDER A PARTY (client request, 6 Oct 2026): a party row opens to the
 * bills still to be paid; the owner ticks the party for all of them, or ticks
 * single bills, and the party's amount is the sum of what is ticked.
 */

const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const bill = (documentId: string, displayNo: string, pending: string, date: string) => ({
  source: "invoice" as const,
  documentId,
  displayNo,
  documentDate: date,
  siteName: "SURAT",
  amount: pending,
  pending,
});

const OWED = {
  rows: [
    {
      partyId: P1,
      partyName: "Ambica Steel Traders",
      outstanding: "100000.00",
      invoices: [bill("d1", "BE-1", "60000.00", "2026-08-01"), bill("d2", "BE-2", "40000.00", "2026-09-01")],
    },
  ],
  total: "100000.00",
};

/** The date-filter popup, found by its title: the payout dialog under it is a dialog too. */
const filterPopup = async () => {
  const title = await screen.findByText("Filter bills · Ambica Steel Traders");
  return title.closest('[role="dialog"]') as HTMLElement;
};

const sent = () => {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
  return call ? (JSON.parse(String((call[1] as RequestInit).body)) as { lines: unknown[] }) : null;
};

describe("PayoutListFormDialog - bills", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(json(/outstanding$/.test(String(input)) ? OWED : { id: "x", listDate: "2026-10-06", title: null, budget: null, companyId: null, companyName: null, total: "0.00", partyCount: 0, status: "draft", confirmedAt: null, confirmedByName: null, createdByName: null, createdAt: "2026-10-06T00:00:00.000Z", updatedAt: null, updatedByName: null, note: null, lines: [] })),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const open = () =>
    renderWithAuth(<PayoutListFormDialog open listId={null} onClose={() => {}} />, {
      permissions: ["payout.view", "payout.add"],
    });

  it("shows the bills under a party only when it is opened", async () => {
    const user = userEvent.setup();
    open();
    expect(await screen.findByText("2 bills")).toBeInTheDocument();
    expect(screen.queryByText("BE-1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show the bills of ambica/i }));
    expect(screen.getByText("BE-1")).toBeInTheDocument();
    expect(screen.getByText("BE-2")).toBeInTheDocument();
  });

  it("opens the supplier's ledger in a popup from the eye beside the party, without ticking it", async () => {
    const user = userEvent.setup();
    open();
    vi.mocked(globalThis.fetch).mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(
        json(
          /reports\/ledger/.test(String(input))
            ? {
                rows: [
                  {
                    id: "invoice:d1", documentId: "d1", source: "invoice", displayNo: "BE-1", label: "Purchase",
                    documentDate: "2026-08-01", partyId: P1, partyName: "Ambica Steel Traders", siteId: null,
                    siteName: "SURAT", siteLocationId: null, siteLocationName: null, companyId: "c", companyName: "DH",
                    effect: "credit", credit: "60000.00", debit: "0.00", balance: "60000.00",
                  },
                ],
                total: 1, nextCursor: null, totalCredit: "60000.00", totalDebit: "0.00", closingBalance: "60000.00",
              }
            : /outstanding$/.test(String(input))
              ? OWED
              : {},
        ),
      ),
    );

    await user.click(await screen.findByRole("button", { name: /show the bills of ambica/i }));
    await user.click(screen.getByRole("button", { name: /^see ledger of ambica steel traders$/i }));

    expect(await screen.findByText("Ledger · Ambica Steel Traders")).toBeInTheDocument();
    expect(await screen.findByText("Purchase")).toBeInTheDocument();
    const asked = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input));
    expect(asked.some((url) => url.includes("/reports/ledger") && url.includes(`partyId=${P1}`) && url.includes("direction=out"))).toBe(true);
    expect(screen.getByLabelText("Pay bill BE-1 of Ambica Steel Traders")).not.toBeChecked();
  });

  it("ticks every bill for the party, in full, and the party's amount is their sum", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByLabelText("Pay Ambica Steel Traders"));

    expect(screen.getByText("2 of 2 bills")).toBeInTheDocument();
    expect(screen.getByLabelText("Pay bill BE-1 of Ambica Steel Traders")).toBeChecked();
    expect(screen.getByLabelText("Amount for bill BE-2")).toHaveValue("40,000.00");
    expect(screen.getByText("Total").parentElement).toHaveTextContent("1,00,000.00");
  });

  it("lets single bills be ticked, and a bill part-paid", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /show the bills of ambica/i }));
    await user.click(screen.getByLabelText("Pay bill BE-2 of Ambica Steel Traders"));

    expect(screen.getByText("1 of 2 bills")).toBeInTheDocument();
    expect(screen.getByLabelText("Pay Ambica Steel Traders")).toBePartiallyChecked?.();
    const box = screen.getByLabelText("Amount for bill BE-2");
    await user.clear(box);
    await user.type(box, "15000");
    expect(screen.getByText("Total").parentElement).toHaveTextContent("15,000.00");

    await user.click(screen.getByRole("button", { name: /save list/i }));
    await waitFor(() => expect(sent()).not.toBeNull());
    expect(sent()!.lines).toEqual([
      {
        partyId: P1,
        amount: "15000.00",
        invoices: [
          {
            source: "invoice",
            documentId: "d2",
            displayNo: "BE-2",
            documentDate: "2026-09-01",
            siteName: "SURAT",
            amount: "15000",
            pending: "40000.00",
          },
        ],
      },
    ]);
  });

  it("unticks the party and all its bills with one click", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByLabelText("Pay Ambica Steel Traders"));
    await user.click(screen.getByLabelText("Pay Ambica Steel Traders"));
    expect(screen.getByText("0 parties ticked")).toBeInTheDocument();
    expect(screen.getByText("2 bills")).toBeInTheDocument();
  });

  // Client, 17 Oct 2026: a filter beside the party, with a date range; OK ticks what falls inside it.
  it("filters a party's bills by date, and OK ticks only the bills inside the dates", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /^filter the bills of ambica steel traders by date$/i }));

    const dialog = await filterPopup();
    // Both bills at first.
    expect(within(dialog).getByText("BE-1")).toBeInTheDocument();
    expect(within(dialog).getByText("BE-2")).toBeInTheDocument();

    // 1 Sep onwards: only BE-2.
    await user.type(within(dialog).getByLabelText("From date"), "2026-09-01");
    expect(within(dialog).queryByText("BE-1")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/1 of 2 bills will be ticked/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /^ok$/i }));

    expect(screen.getByText("1 of 2 bills")).toBeInTheDocument();
    expect(screen.getByLabelText("Pay bill BE-2 of Ambica Steel Traders")).toBeChecked();
    expect(screen.getByLabelText("Pay bill BE-1 of Ambica Steel Traders")).not.toBeChecked();
    expect(screen.getByText("Total").parentElement).toHaveTextContent("40,000.00");
  });

  // Client, 19 Oct 2026: a wider popup with more ways to choose among many bills.
  it("ticks the oldest bills that fit a sum, and OK ticks only those", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /^filter the bills of ambica steel traders by date$/i }));
    const dialog = await filterPopup();

    await user.type(within(dialog).getByLabelText(/pay up to/i), "70,000");
    await user.click(within(dialog).getByRole("button", { name: /^tick to fit$/i }));
    // BE-1 (60,000, oldest) fits; BE-2 would go over.
    expect(within(dialog).getByLabelText("Pay bill BE-1")).toBeChecked();
    expect(within(dialog).getByLabelText("Pay bill BE-2")).not.toBeChecked();
    expect(within(dialog).getByText(/1 of 2 bills will be ticked/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /^ok$/i }));
    expect(screen.getByLabelText("Pay bill BE-1 of Ambica Steel Traders")).toBeChecked();
    expect(screen.getByLabelText("Pay bill BE-2 of Ambica Steel Traders")).not.toBeChecked();
  });

  it("finds bills by number and pending amount, and ticks or unticks all shown at once", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /^filter the bills of ambica steel traders by date$/i }));
    const dialog = await filterPopup();

    await user.click(within(dialog).getByRole("button", { name: /^untick all shown$/i }));
    expect(within(dialog).getByText(/0 of 2 bills will be ticked/i)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/bill no\. contains/i), "be-2");
    expect(within(dialog).queryByText("BE-1")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^tick all shown$/i }));
    expect(within(dialog).getByText(/1 of 2 bills will be ticked/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /^clear filters$/i }));
    await user.type(within(dialog).getByLabelText(/pending from/i), "50000");
    expect(within(dialog).getByText("BE-1")).toBeInTheDocument();
    expect(within(dialog).queryByText("BE-2")).not.toBeInTheDocument();
  });

  it("shift-click ticks every bill between two clicks", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /^filter the bills of ambica steel traders by date$/i }));
    const dialog = await filterPopup();
    await user.click(within(dialog).getByRole("button", { name: /^untick all shown$/i }));

    await user.click(within(dialog).getByLabelText("Pay bill BE-1"));
    await user.keyboard("{Shift>}");
    await user.click(within(dialog).getByLabelText("Pay bill BE-2"));
    await user.keyboard("{/Shift}");
    expect(within(dialog).getByText(/2 of 2 bills will be ticked/i)).toBeInTheDocument();
  });

  it("Cancel on the filter changes nothing", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /^filter the bills of ambica steel traders by date$/i }));
    await user.click(within(await filterPopup()).getByRole("button", { name: /^cancel$/i }));
    expect(screen.getByText("0 parties ticked")).toBeInTheDocument();
  });
});
